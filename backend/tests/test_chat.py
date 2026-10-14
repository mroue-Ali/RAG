"""A chat turn end to end, with a stand-in for the model."""

import json

import pytest

from app.services.llm import Chunk, LLMError, LLMProvider, Usage, registry

from .conftest import signed_up


class FakeProvider(LLMProvider):
    kind = "openai"

    def __init__(self, replies=("Hello", " there"), fail_with=None):
        self.model = "fake-model"
        self.seen = None
        self.closed = False
        self._replies, self._fail_with = replies, fail_with

    async def load(self):
        return {}

    async def close(self):
        self.closed = True

    async def stream(self, messages, params):
        self.seen = (messages, params)
        for piece in self._replies:
            yield Chunk(text=piece)
        if self._fail_with:
            raise LLMError(self._fail_with)
        yield Chunk(finish_reason="stop", usage=Usage(prompt_tokens=7, completion_tokens=2))


@pytest.fixture
def fake(monkeypatch):
    """Whatever provider the settings ask for, hand back the stand-in."""
    provider = FakeProvider()
    monkeypatch.setattr(registry, "create_provider", lambda llm, follow_redirects=True: provider)
    return provider


def _ready(app, username):
    client = signed_up(app, username)
    settings = client.get("/api/settings").json()
    settings["llm"]["openai"].update(base_url="https://1.1.1.1/v1", model="fake-model")
    assert client.put("/api/settings", json=settings).status_code == 200
    return client, settings


def _events(response):
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def _ask(client, *contents):
    roles = ["user", "assistant"]
    messages = [{"role": roles[index % 2], "content": content} for index, content in enumerate(contents)]
    return client.post("/api/chat/stream", json={"messages": messages})


def test_a_reply_streams_as_events(server, fake):
    client, _ = _ready(server, "salma")
    response = _ask(client, "Hi")

    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response)
    assert [event["type"] for event in events] == ["start", "delta", "delta", "done"]
    assert "".join(event["content"] for event in events if event["type"] == "delta") == "Hello there"
    assert events[0]["model"] == "fake-model"
    assert (events[-1]["finish_reason"], events[-1]["completion_tokens"]) == ("stop", 2)


def test_the_users_own_prompt_and_limits_reach_the_model(server, fake):
    client, settings = _ready(server, "yara")
    settings["prompt"] = {"system_template": "You help {{user_name}}.", "user_template": "Q: {{question}}"}
    settings["generation"].update(temperature=0.2, max_tokens=64, history_messages=2)
    client.put("/api/settings", json=settings)

    _ask(client, "one", "two", "three", "four", "five")

    messages, params = fake.seen
    assert messages == [
        {"role": "system", "content": "You help yara."},
        # history_messages=2 keeps only the last exchange before the new question
        {"role": "user", "content": "three"},
        {"role": "assistant", "content": "four"},
        {"role": "user", "content": "Q: five"},
    ]
    assert (params.temperature, params.max_tokens) == (0.2, 64)


def test_with_streaming_off_the_reply_arrives_whole(server, fake):
    client, settings = _ready(server, "jad")
    settings["generation"]["stream"] = False
    client.put("/api/settings", json=settings)

    deltas = [event for event in _events(_ask(client, "Hi")) if event["type"] == "delta"]
    assert deltas == [{"type": "delta", "content": "Hello there"}]


def test_a_failure_mid_reply_is_reported_in_the_stream(server, monkeypatch):
    provider = FakeProvider(replies=("Partial",), fail_with="The provider hung up.")
    monkeypatch.setattr(registry, "create_provider", lambda llm, follow_redirects=True: provider)
    client, _ = _ready(server, "nadia")

    events = _events(_ask(client, "Hi"))
    assert [event["type"] for event in events] == ["start", "delta", "error"]
    assert events[-1]["message"] == "The provider hung up."


def test_the_per_request_client_is_closed_afterwards(server, fake):
    client, _ = _ready(server, "bilal")
    _ask(client, "Hi")

    assert fake.closed


def test_chat_needs_a_configured_model(server):
    client = signed_up(server, "walid")
    response = _ask(client, "Hi")

    assert response.status_code == 409
    assert "No model is selected" in response.json()["detail"]


def test_the_last_message_must_be_the_users(server, fake):
    client, _ = _ready(server, "rana")

    assert _ask(client, "Hi", "Hello").status_code == 409
