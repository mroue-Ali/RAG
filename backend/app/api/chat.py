"""Asking the model. Each reply streams back as server-sent events, one JSON object per
event; app.services.chat says which events come and in what order."""

from collections.abc import AsyncIterator, Callable
from contextlib import aclosing

import anyio
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from ..db import Database
from ..models import User
from ..schemas import AppSettings, AskRequest, MessageInfo, RegenerateRequest
from ..services import chat
from ..services.llm import Runtime
from ..services.roles import Permission
from .deps import DatabaseDep, RuntimeDep, SessionDep, SettingsDep, UserDep, find_conversation, require

router = APIRouter(prefix="/chat", tags=["chat"], dependencies=[require(Permission.CHAT)])


@router.post("")
async def ask(
    body: AskRequest,
    user: UserDep,
    session: SessionDep,
    settings: SettingsDep,
    runtime: RuntimeDep,
    database: DatabaseDep,
) -> StreamingResponse:
    """Ask a question and stream the reply. Without a conversation_id, the question starts a new conversation."""
    conversation = None
    if body.conversation_id is not None:
        conversation = await run_in_threadpool(find_conversation, session, user, body.conversation_id)
    return await _answer(lambda: chat.ask(session, user, conversation, body.content), user, settings, runtime, database)


@router.post("/regenerate")
async def regenerate(
    body: RegenerateRequest,
    user: UserDep,
    session: SessionDep,
    settings: SettingsDep,
    runtime: RuntimeDep,
    database: DatabaseDep,
) -> StreamingResponse:
    """Throw away the conversation's last reply and stream a new one."""
    conversation = await run_in_threadpool(find_conversation, session, user, body.conversation_id)
    return await _answer(lambda: chat.regenerate(session, conversation), user, settings, runtime, database)


async def _answer(
    prepare: Callable[[], chat.Turn], user: User, settings: AppSettings, runtime: Runtime, database: Database
) -> StreamingResponse:
    """Acquire the model, store the question with `prepare`, then stream the reply."""
    # First, so a model that is not ready refuses the request (409) before anything is stored.
    provider = await runtime.acquire(settings.llm)
    try:
        turn = await run_in_threadpool(prepare)
    except BaseException:
        await runtime.release(provider)
        raise
    user_name = user.display_name

    async def save(reply: chat.Reply) -> MessageInfo | None:
        # The request's own database session may already be closed by now, so use a fresh one.
        def store() -> MessageInfo | None:
            with database.sessions() as session:
                return chat.store(session, turn.conversation.id, reply)

        return await anyio.to_thread.run_sync(store)

    async def events() -> AsyncIterator[str]:
        try:
            async with aclosing(chat.answer(turn, provider, settings, user_name, save)) as stream:
                async for event in stream:
                    yield f"data: {event.model_dump_json()}\n\n"
        finally:
            # Released even when the client went away and the request is being cancelled.
            with anyio.CancelScope(shield=True):
                await runtime.release(provider)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # X-Accel-Buffering keeps nginx from holding tokens back when deployed behind it.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
