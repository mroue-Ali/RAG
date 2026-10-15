"""A chat turn end to end, with a stand-in for the model."""

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.models import Conversation, User
from app.schemas import AppSettings, ConversationInfo, MessageInfo
from app.services import chat

from .chatting import FakeProvider, ask, events, ready, start, stored
from .conftest import signed_up


def test_a_reply_streams_as_events(server, fake):
    client, _ = ready(server, "salma")
    response = ask(client, "Hi")

    assert response.headers["content-type"].startswith("text/event-stream")
    sent = events(response)
    assert [event["type"] for event in sent] == ["start", "delta", "delta", "done"]
    assert "".join(event["content"] for event in sent if event["type"] == "delta") == "Hello there"

    start_event, done = sent[0], sent[-1]
    assert (start_event["question"]["content"], start_event["model"]) == ("Hi", "fake-model")
    reply = done["reply"]
    assert (reply["role"], reply["content"], reply["status"]) == ("assistant", "Hello there", "complete")
    assert (reply["stats"]["finish_reason"], reply["stats"]["completion_tokens"]) == ("stop", 2)


def test_the_conversation_so_far_and_the_users_settings_reach_the_model(server, fake):
    client, settings = ready(server, "yara")
    settings["prompt"] = {"system_template": "You help {{user_name}}.", "user_template": "Q: {{question}}"}
    settings["generation"].update(temperature=0.2, max_tokens=64, history_messages=2)
    client.put("/api/settings", json=settings)

    conversation = start(client, "one")
    ask(client, "two", conversation)
    ask(client, "three", conversation)

    messages, params = fake.seen
    assert messages == [
        {"role": "system", "content": "You help yara."},
        # history_messages=2 keeps only the last exchange before the new question
        {"role": "user", "content": "two"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": "Q: three"},
    ]
    assert (params.temperature, params.max_tokens) == (0.2, 64)


def test_with_streaming_off_the_reply_arrives_whole(server, fake):
    client, settings = ready(server, "jad")
    settings["generation"]["stream"] = False
    client.put("/api/settings", json=settings)

    deltas = [event for event in events(ask(client, "Hi")) if event["type"] == "delta"]
    assert deltas == [{"type": "delta", "content": "Hello there"}]


def test_a_failure_mid_reply_is_stored_with_what_came_before_it(server, fake):
    fake.replies, fake.fail_with = ("Partial",), "The provider hung up."
    client, _ = ready(server, "nadia")

    sent = events(ask(client, "Hi"))
    assert [event["type"] for event in sent] == ["start", "delta", "done"]
    reply = sent[-1]["reply"]
    assert (reply["content"], reply["status"], reply["error"]) == ("Partial", "error", "The provider hung up.")
    assert stored(client, sent[0]["conversation"]["id"]) == [("user", "Hi"), ("assistant", "Partial")]


def test_a_question_whose_reply_failed_is_left_out_of_the_next_prompt(server, fake):
    client, _ = ready(server, "omar")
    fake.replies, fake.fail_with = (), "Down for a moment."
    conversation = start(client, "lost")

    fake.replies, fake.fail_with = ("Fine",), None
    ask(client, "again", conversation)

    messages, _ = fake.seen
    assert [message["content"] for message in messages[1:]] == ["again"]


def test_thinking_written_inline_is_stored_apart_from_the_answer(server, fake):
    fake.replies = ("<think>Let me see.", "</think>", "Paris.")
    client, _ = ready(server, "hiba")

    conversation = start(client, "Capital of France?")
    reply = client.get(f"/api/conversations/{conversation}").json()["messages"][-1]
    assert (reply["reasoning"], reply["content"]) == ("Let me see.", "Paris.")

    ask(client, "And Italy?", conversation)
    messages, _ = fake.seen
    assert messages[-2] == {"role": "assistant", "content": "Paris."}


def test_regenerating_replaces_the_last_reply(server, fake):
    client, _ = ready(server, "karim")
    conversation = start(client, "Hi")

    fake.replies = ("Second", " try")
    sent = events(client.post("/api/chat/regenerate", json={"conversation_id": conversation}))

    assert sent[0]["question"]["content"] == "Hi"
    assert sent[-1]["reply"]["content"] == "Second try"
    assert stored(client, conversation) == [("user", "Hi"), ("assistant", "Second try")]
    messages, _ = fake.seen
    assert messages[-1] == {"role": "user", "content": "Hi"}


def test_regenerating_needs_a_question(server, fake):
    client, _ = ready(server, "lina")
    with server.state.db.sessions() as session:
        user = session.scalar(select(User).where(User.username == "lina"))
        empty = Conversation(user_id=user.id, title="Empty")
        session.add(empty)
        session.commit()

    response = client.post("/api/chat/regenerate", json={"conversation_id": empty.id})
    assert response.status_code == 400
    assert "no question" in response.json()["detail"]


def test_the_per_request_client_is_closed_afterwards(server, fake):
    client, _ = ready(server, "bilal")
    ask(client, "Hi")

    assert fake.closed


def test_chat_needs_a_configured_model_and_stores_nothing_without_one(server):
    client = signed_up(server, "walid")

    response = ask(client, "Hi")
    assert response.status_code == 409
    assert "No model is selected" in response.json()["detail"]
    assert client.get("/api/conversations").json() == []


def test_a_blank_question_is_refused(server, fake):
    client, _ = ready(server, "rana")

    assert ask(client, "   ").status_code == 422


def test_a_reply_cut_short_is_kept_as_far_as_it_got():
    """Stopping a reply closes its stream. What was written by then is still stored."""
    now = datetime.now(timezone.utc)
    turn = chat.Turn(
        conversation=ConversationInfo(id=1, title="t", created_at=now, updated_at=now),
        question=MessageInfo(id=1, role="user", content="Hi", created_at=now),
        history=[],
    )
    saved: list[chat.Reply] = []

    async def save(reply):
        saved.append(reply)
        return None

    async def stop_after_first_piece():
        stream = chat.answer(turn, FakeProvider(), AppSettings(), "you", save)
        assert (await anext(stream)).type == "start"
        assert (await anext(stream)).content == "Hello"
        await stream.aclose()

    asyncio.run(stop_after_first_piece())
    [reply] = saved
    assert (reply.status, reply.text) == ("stopped", "Hello")
