import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..schemas import AppSettings, ChatRequest
from ..services import prompt
from ..services.llm import GenerationParams, LLMError, LLMProvider, Runtime
from ..services.roles import Permission
from .deps import RuntimeDep, SettingsDep, UserDep, require

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/stream", dependencies=[require(Permission.CHAT)])
async def stream(
    request: ChatRequest, runtime: RuntimeDep, settings: SettingsDep, user: UserDep
) -> StreamingResponse:
    """Answer the last user message as server-sent events.

    Events are JSON objects with a `type`: start, delta, reasoning, then exactly
    one of done or error. The conversation is sent whole each turn; the server
    keeps none of it.
    """
    if request.messages[-1].role != "user":
        raise LLMError("The last message must come from the user.")
    provider = await runtime.acquire(settings.llm)
    return StreamingResponse(
        _events(runtime, provider, settings, user.display_name, request),
        media_type="text/event-stream",
        # X-Accel-Buffering keeps nginx from holding tokens back when deployed behind it.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _events(
    runtime: Runtime, provider: LLMProvider, settings: AppSettings, user_name: str, request: ChatRequest
) -> AsyncIterator[str]:
    try:
        # aclosing: when the client disconnects, stop the generation first, then release.
        async with aclosing(_reply(provider, settings, user_name, request)) as reply:
            async for event in reply:
                yield event
    finally:
        await runtime.release(provider)


async def _reply(
    provider: LLMProvider, settings: AppSettings, user_name: str, request: ChatRequest
) -> AsyncIterator[str]:
    generation = settings.generation
    messages = prompt.build_messages(settings, user_name, request.messages, provider.model)
    params = GenerationParams(generation.temperature, generation.top_p, generation.max_tokens)

    started = time.perf_counter()
    first_token: float | None = None
    text, finish_reason, usage = "", None, None
    yield _event(type="start", provider=provider.kind, model=provider.model)
    try:
        async with aclosing(provider.stream(messages, params)) as chunks:
            async for chunk in chunks:
                if first_token is None and (chunk.text or chunk.reasoning):
                    first_token = time.perf_counter()
                if chunk.reasoning:
                    yield _event(type="reasoning", content=chunk.reasoning)
                if chunk.text:
                    text += chunk.text
                    if generation.stream:
                        yield _event(type="delta", content=chunk.text)
                finish_reason = chunk.finish_reason or finish_reason
                usage = chunk.usage or usage
    except LLMError as exc:
        yield _event(type="error", message=str(exc))
        return
    except Exception:
        log.exception("Chat generation failed")
        yield _event(type="error", message="The model stopped unexpectedly. See the server log.")
        return

    if not generation.stream and text:
        yield _event(type="delta", content=text)
    finished = time.perf_counter()
    yield _event(
        type="done",
        finish_reason=finish_reason,
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        seconds=round(finished - started, 2),
        # Time spent generating, without the wait for the first token, for a fair tokens/s.
        generation_seconds=round(finished - first_token, 2) if first_token else None,
    )


def _event(**payload: Any) -> str:
    return f"data: {json.dumps(payload)}\n\n"
