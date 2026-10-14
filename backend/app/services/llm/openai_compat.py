"""Any server that speaks the OpenAI chat completions API."""

from collections.abc import AsyncIterator
from typing import Any

import openai
from openai import AsyncOpenAI

from ...schemas import ModelInfo
from .base import Chunk, GenerationParams, LLMError, LLMProvider, Message, Usage


class OpenAICompatProvider(LLMProvider):
    kind = "openai"

    def __init__(
        self, base_url: str, model: str, api_key: str = "", timeout: float = 120, follow_redirects: bool = True
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = _client(self.base_url, api_key, timeout, max_retries=1, follow_redirects=follow_redirects)

    async def close(self) -> None:
        await self._client.close()

    async def load(self) -> dict[str, str]:
        # Nothing to load for a hosted API: confirm we can reach it and it has the model.
        models = await list_models(self.base_url, client=self._client)
        if models and self.model not in {model.id for model in models}:
            raise LLMError(f"{self.base_url} does not offer a model called {self.model!r}.")
        return {"endpoint": self.base_url}

    async def stream(self, messages: list[Message], params: GenerationParams) -> AsyncIterator[Chunk]:
        request: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": params.temperature,
            "top_p": params.top_p,
            "max_tokens": params.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        usage = None
        try:
            async with await self._create(request) as response:
                async for event in response:
                    if event.usage:
                        usage = Usage(event.usage.prompt_tokens, event.usage.completion_tokens)
                    if not event.choices:
                        continue
                    choice = event.choices[0]
                    yield Chunk(
                        text=choice.delta.content or "",
                        reasoning=_reasoning(choice.delta),
                        finish_reason=choice.finish_reason,
                    )
        except openai.OpenAIError as exc:
            raise LLMError(describe_error(exc, self.base_url)) from exc
        yield Chunk(usage=usage)

    async def _create(self, request: dict[str, Any]):
        # Servers disagree on the optional parameters (newer OpenAI models want
        # max_completion_tokens and reject temperature, some servers reject
        # stream_options), so drop whatever a 400 complains about and try again.
        while True:
            try:
                return await self._client.chat.completions.create(**request)
            except openai.BadRequestError as exc:
                if not relax(request, exc):
                    raise


def relax(request: dict[str, Any], error: openai.BadRequestError) -> bool:
    """Adjust the request to get past a rejected parameter. False if nothing applies."""
    complaint = f"{getattr(error, 'param', None) or ''} {error}"
    if "max_tokens" in request and "max_tokens" in complaint:
        request["max_completion_tokens"] = request.pop("max_tokens")
        return True
    for name in ("stream_options", "temperature", "top_p"):
        if name in request and name in complaint:
            del request[name]
            return True
    return False


async def list_models(
    base_url: str, api_key: str = "", client: AsyncOpenAI | None = None, follow_redirects: bool = True
) -> list[ModelInfo]:
    own = client is None
    client = client or _client(base_url.rstrip("/"), api_key, 15, max_retries=0, follow_redirects=follow_redirects)
    try:
        page = await client.models.list()
    except openai.NotFoundError:
        # Some gateways have no /models route. That says nothing about chat working.
        return []
    except openai.OpenAIError as exc:
        raise LLMError(describe_error(exc, base_url)) from exc
    finally:
        if own:
            await client.close()
    return sorted((ModelInfo(id=model.id) for model in page.data), key=lambda model: model.id.lower())


def _client(base_url: str, api_key: str, timeout: float, max_retries: int, follow_redirects: bool) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=base_url,
        # Local servers ignore the key, but the SDK refuses to start without one.
        api_key=api_key or "not-needed",
        timeout=timeout,
        max_retries=max_retries,
        http_client=openai.DefaultAsyncHttpx2Client(timeout=timeout, follow_redirects=follow_redirects),
    )


def describe_error(exc: openai.OpenAIError, base_url: str) -> str:
    if isinstance(exc, openai.APITimeoutError):
        return f"{base_url} did not answer in time."
    if isinstance(exc, openai.APIConnectionError):
        return f"Could not reach {base_url}. Check the address and that the server is running."
    if isinstance(exc, openai.AuthenticationError):
        return f"{base_url} rejected the API key."
    if isinstance(exc, openai.APIStatusError):
        return f"{base_url} answered {exc.status_code}: {_message(exc)}"
    return str(exc)


def _message(exc: openai.APIStatusError) -> str:
    body = exc.body
    if isinstance(body, dict):
        detail = body.get("error", body)
        if isinstance(detail, dict) and detail.get("message"):
            return str(detail["message"])
        if isinstance(detail, str):
            return detail
    return exc.message


def _reasoning(delta: Any) -> str:
    # Not part of the OpenAI schema; servers put it in one of two extra fields.
    return getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None) or ""
