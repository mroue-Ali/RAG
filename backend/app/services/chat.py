"""One chat turn, from a stored question to a stored reply.

The route checks who is asking and acquires the model. The rest is here:

1. `ask` (or `regenerate`) stores the question and gathers what the model
   needs to answer it into a `Turn`.
2. `answer` builds the prompt from the turn, streams the model's output as
   events, and hands the finished `Reply` to a save function however the turn
   ends: answered, failed, or stopped because the person asking went away.

Retrieval will slot in between the two: find what the question needs in the
documents, and give it to the prompt.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import dataclass, field

import anyio
from sqlalchemy.orm import Session

from ..models import Conversation, Message, User
from ..schemas import (
    AppSettings,
    ChatEvent,
    ChatMessage,
    ConversationInfo,
    DoneEvent,
    MessageInfo,
    MessageStats,
    MessageStatus,
    ProviderKind,
    StartEvent,
    TextEvent,
)
from . import conversations, prompt
from .llm import GenerationParams, LLMError, LLMProvider, Usage

log = logging.getLogger(__name__)


# --- Before the model: the question --------------------------------------------


@dataclass(frozen=True)
class Turn:
    """A stored question about to be answered, and what the model needs to answer it."""

    conversation: ConversationInfo
    question: MessageInfo
    # Earlier exchanges that got an answer, oldest first.
    history: list[ChatMessage]


def ask(session: Session, user: User, conversation: Conversation | None, question: str) -> Turn:
    """Store a question, starting a new conversation when there is none."""
    if conversation is None:
        conversation = conversations.start(session, user, question)
    stored = conversations.add_question(session, conversation, question)
    return _turn(session, conversation, stored)


def regenerate(session: Session, conversation: Conversation) -> Turn:
    """Throw away the last reply, so its question can be answered again."""
    question = conversations.reopen_last_question(session, conversation)
    return _turn(session, conversation, question)


def _turn(session: Session, conversation: Conversation, question: Message) -> Turn:
    earlier = [message for message in conversations.messages(session, conversation) if message.id < question.id]
    return Turn(
        conversation=conversations.info(conversation),
        question=conversations.message_info(question),
        history=answered(earlier),
    )


def answered(messages: list[Message]) -> list[ChatMessage]:
    """The exchanges the model gets to see again.

    A question whose reply failed or came back empty is left out, along with
    that reply, because many chat templates refuse two user turns in a row.
    """
    history: list[ChatMessage] = []
    question: Message | None = None
    for message in messages:
        if message.role == "user":
            question = message
            continue
        if question is not None and message.content.strip():
            history.append(ChatMessage(role="user", content=question.content))
            history.append(ChatMessage(role="assistant", content=message.content))
        question = None
    return history


# --- The model at work: the reply ------------------------------------------------


@dataclass
class Reply:
    """A reply as it arrives, then how it ended. This is what gets stored."""

    provider: ProviderKind
    model: str
    text: str = ""
    # Thinking the provider reported apart from the text.
    reasoning: str = ""
    status: MessageStatus = "complete"
    error: str | None = None
    finish_reason: str | None = None
    usage: Usage | None = None
    started: float = field(default_factory=time.perf_counter)
    first_token: float | None = None
    # Set by finish(). None while the model is still writing.
    finished: float | None = None

    def finish(self, status: MessageStatus = "complete", error: str | None = None) -> None:
        self.status, self.error, self.finished = status, error, time.perf_counter()

    def stats(self) -> MessageStats:
        finished = self.finished or time.perf_counter()
        return MessageStats(
            finish_reason=self.finish_reason,
            prompt_tokens=self.usage.prompt_tokens if self.usage else None,
            completion_tokens=self.usage.completion_tokens if self.usage else None,
            seconds=round(finished - self.started, 2),
            generation_seconds=round(finished - self.first_token, 2) if self.first_token else None,
        )


SaveReply = Callable[[Reply], Awaitable[MessageInfo | None]]


async def answer(
    turn: Turn, provider: LLMProvider, settings: AppSettings, user_name: str, save: SaveReply
) -> AsyncIterator[ChatEvent]:
    """Answer the turn's question as a stream of events, and store the reply however the turn ends.

    The events are start, then reasoning and delta as the model writes, then
    done with the stored reply. A failure is not an exception here: it ends the
    reply with status "error", which is stored and sent like any other.

    If the stream is closed before the end, because the person stopped it or
    went away, the reply is stored as far as it got, as "stopped".
    """
    reply = Reply(provider=provider.kind, model=provider.model)
    try:
        yield StartEvent(
            conversation=turn.conversation, question=turn.question, provider=provider.kind, model=provider.model
        )
        async with aclosing(_generate(turn, provider, settings, user_name, reply)) as events:
            async for event in events:
                yield event
    except (asyncio.CancelledError, GeneratorExit):
        if reply.finished is None:
            reply.finish("stopped")
        # Shielded, because the request around it is being cancelled and this must still happen.
        with anyio.CancelScope(shield=True):
            await save(reply)
        raise
    yield DoneEvent(reply=await save(reply))


async def _generate(
    turn: Turn, provider: LLMProvider, settings: AppSettings, user_name: str, reply: Reply
) -> AsyncIterator[TextEvent]:
    """The model's output as events, recorded on `reply` as it arrives."""
    generation = settings.generation
    question = ChatMessage(role="user", content=turn.question.content)
    messages = prompt.build_messages(settings, user_name, [*turn.history, question], provider.model)
    params = GenerationParams(generation.temperature, generation.top_p, generation.max_tokens)
    try:
        async with aclosing(provider.stream(messages, params)) as chunks:
            async for chunk in chunks:
                if reply.first_token is None and (chunk.text or chunk.reasoning):
                    reply.first_token = time.perf_counter()
                if chunk.reasoning:
                    reply.reasoning += chunk.reasoning
                    yield TextEvent(type="reasoning", content=chunk.reasoning)
                if chunk.text:
                    reply.text += chunk.text
                    if generation.stream:
                        yield TextEvent(type="delta", content=chunk.text)
                reply.finish_reason = chunk.finish_reason or reply.finish_reason
                reply.usage = chunk.usage or reply.usage
    except LLMError as exc:
        reply.finish("error", str(exc))
        return
    except Exception:
        log.exception("Chat generation failed")
        reply.finish("error", "The model stopped unexpectedly. See the server log.")
        return

    reply.finish()
    if not generation.stream and reply.text:
        yield TextEvent(type="delta", content=reply.text)


# --- After the model: storing it -------------------------------------------------


def store(session: Session, conversation_id: int, reply: Reply) -> MessageInfo | None:
    """Store a finished reply, with any thinking the model wrote inline moved out of the answer."""
    inline_reasoning, text = split_thinking(reply.text)
    stored = conversations.add_reply(
        session,
        conversation_id,
        content=text,
        reasoning="\n\n".join(part for part in (reply.reasoning.strip(), inline_reasoning) if part),
        status=reply.status,
        error=reply.error,
        provider=reply.provider,
        model=reply.model,
        stats=reply.stats(),
    )
    return conversations.message_info(stored) if stored else None


_THINK_OPEN, _THINK_CLOSE = "<think>", "</think>"


def split_thinking(text: str) -> tuple[str, str]:
    """Some models write their reasoning inline, in <think> tags ahead of the answer.

    Returns (reasoning, answer). Without a closing tag, all of it is reasoning.
    The frontend does the same while a reply streams: lib/thinking.ts.
    """
    stripped = text.lstrip()
    if not stripped.startswith(_THINK_OPEN):
        return "", text
    end = stripped.find(_THINK_CLOSE)
    if end == -1:
        return stripped[len(_THINK_OPEN) :].strip(), ""
    return stripped[len(_THINK_OPEN) : end].strip(), stripped[end + len(_THINK_CLOSE) :].lstrip()
