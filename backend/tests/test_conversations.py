"""Saved conversations: listing, reading, renaming, deleting, and keeping them private."""

from sqlalchemy import func, select

from app.models import Conversation

from .chatting import ask, ready, start, stored
from .conftest import added


def _ids(client) -> list[int]:
    return [conversation["id"] for conversation in client.get("/api/conversations").json()]


def test_the_first_question_starts_a_conversation_titled_after_it(server, fake):
    client, _ = ready(server, "salma")
    question = "What is retrieval augmented generation, and why would anyone need it in practice?"
    conversation = start(client, question)

    [listed] = client.get("/api/conversations").json()
    assert listed["id"] == conversation
    assert listed["title"] == "What is retrieval augmented generation, and why would anyone…"
    assert stored(client, conversation) == [("user", question), ("assistant", "Hello there")]


def test_a_short_question_is_the_title_as_it_is(server, fake):
    client, _ = ready(server, "sami")
    start(client, "  Hi\n there  ")

    assert client.get("/api/conversations").json()[0]["title"] == "Hi there"


def test_asking_again_continues_a_conversation_and_lists_it_first(server, fake):
    client, _ = ready(server, "yara")
    first = start(client, "First")
    second = start(client, "Second")
    assert _ids(client) == [second, first]

    ask(client, "More", first)

    assert _ids(client) == [first, second]
    assert stored(client, first) == [
        ("user", "First"),
        ("assistant", "Hello there"),
        ("user", "More"),
        ("assistant", "Hello there"),
    ]


def test_a_conversation_can_be_renamed_and_deleted(server, fake):
    client, _ = ready(server, "jad")
    conversation = start(client, "Hi")

    renamed = client.patch(f"/api/conversations/{conversation}", json={"title": "  Notes on RAG  "})
    assert renamed.json()["title"] == "Notes on RAG"
    assert client.patch(f"/api/conversations/{conversation}", json={"title": "   "}).status_code == 422

    assert client.delete(f"/api/conversations/{conversation}").status_code == 204
    assert client.get("/api/conversations").json() == []
    assert client.get(f"/api/conversations/{conversation}").status_code == 404


def test_conversations_are_private_even_inside_an_account(server, fake):
    owner, _ = ready(server, "nour")
    member = added(server, owner, "maya")
    conversation = start(owner, "Mine")
    path = f"/api/conversations/{conversation}"

    assert member.get("/api/conversations").json() == []
    assert member.get(path).status_code == 404
    assert member.patch(path, json={"title": "Taken"}).status_code == 404
    assert member.delete(path).status_code == 404
    assert ask(member, "Hello?", conversation).status_code == 404
    assert member.post("/api/chat/regenerate", json={"conversation_id": conversation}).status_code == 404
    assert stored(owner, conversation) == [("user", "Mine"), ("assistant", "Hello there")]


def test_removing_a_user_removes_their_conversations(server, fake):
    owner, _ = ready(server, "rami")
    member = added(server, owner, "dina")
    start(member, "Something private")
    member_id = member.get("/api/auth/session").json()["user"]["id"]

    assert owner.delete(f"/api/account/users/{member_id}").status_code == 204

    with server.state.db.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Conversation)) == 0
