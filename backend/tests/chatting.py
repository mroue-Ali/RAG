"""Talking to a stand-in for the model, for the chat and conversation tests."""

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response

from app.services.llm import Chunk, LLMError, LLMProvider, Usage

from .conftest import signed_up


class FakeProvider(LLMProvider):
    """Answers every question with `replies`, then fails if `fail_with` is set."""

    kind = "openai"

    def __init__(self, replies=("Hello", " there"), fail_with=None):
        self.model = "fake-model"
        self.replies, self.fail_with = replies, fail_with
        # What the last request sent: (messages, params).
        self.seen = None
        self.closed = False

    async def load(self):
        return {}

    async def close(self):
        self.closed = True

    async def stream(self, messages, params):
        self.seen = (messages, params)
        for piece in self.replies:
            yield Chunk(text=piece)
        if self.fail_with:
            raise LLMError(self.fail_with)
        yield Chunk(finish_reason="stop", usage=Usage(prompt_tokens=7, completion_tokens=2))


def ready(app: FastAPI, username: str) -> tuple[TestClient, dict]:
    """Someone with an account of their own whose model is set up. Returns them and their settings."""
    client = signed_up(app, username)
    settings = client.get("/api/settings").json()
    settings["llm"]["openai"].update(base_url="https://1.1.1.1/v1", model="fake-model")
    assert client.put("/api/settings", json=settings).status_code == 200
    return client, settings


def ask(client: TestClient, content: str, conversation_id: int | None = None) -> Response:
    return client.post("/api/chat", json={"conversation_id": conversation_id, "content": content})


def start(client: TestClient, question: str) -> int:
    """Start a conversation with one question, and return its id."""
    return events(ask(client, question))[0]["conversation"]["id"]


def events(response: Response) -> list[dict]:
    assert response.status_code == 200, response.text
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def stored(client: TestClient, conversation_id: int) -> list[tuple[str, str]]:
    """The conversation's messages as (role, content), as the server has them."""
    messages = client.get(f"/api/conversations/{conversation_id}").json()["messages"]
    return [(message["role"], message["content"]) for message in messages]
