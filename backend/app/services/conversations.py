"""The signed-in user's conversations and the messages in them.

This module only stores and finds things. How a question becomes a reply is in
app.services.chat.

Conversations are personal. Every lookup goes through the user, and someone
else's conversation is reported missing rather than forbidden, so ids cannot
be probed.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Conversation, Message, User, utcnow
from ..schemas import ConversationDetail, ConversationInfo, MessageInfo, MessageStats

# A new conversation is titled after its first question, cut to about this many characters.
TITLE_LENGTH = 60


class NotFound(Exception):
    """No such conversation, or not one of this user's."""


class ConversationError(Exception):
    """Something the conversation's state does not allow. The message is safe to show."""


# --- Finding ------------------------------------------------------------------


def of_user(session: Session, user: User) -> list[Conversation]:
    """Most recent activity first."""
    query = (
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
    )
    return list(session.scalars(query))


def get(session: Session, user: User, conversation_id: int) -> Conversation:
    conversation = session.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise NotFound
    return conversation


def messages(session: Session, conversation: Conversation) -> list[Message]:
    """Oldest first."""
    query = select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id)
    return list(session.scalars(query))


# --- Changing -----------------------------------------------------------------


def start(session: Session, user: User, first_question: str) -> Conversation:
    conversation = Conversation(user_id=user.id, title=title_for(first_question))
    session.add(conversation)
    session.flush()  # assigns the id
    return conversation


def rename(session: Session, conversation: Conversation, title: str) -> Conversation:
    conversation.title = title
    session.commit()
    return conversation


def delete(session: Session, conversation: Conversation) -> None:
    # Its messages go with it (ON DELETE CASCADE).
    session.delete(conversation)
    session.commit()


def add_question(session: Session, conversation: Conversation, content: str) -> Message:
    question = Message(conversation_id=conversation.id, role="user", content=content)
    session.add(question)
    conversation.updated_at = utcnow()
    session.commit()
    return question


def add_reply(
    session: Session,
    conversation_id: int,
    *,
    content: str,
    reasoning: str,
    status: str,
    error: str | None,
    provider: str,
    model: str,
    stats: MessageStats,
) -> Message | None:
    """Store a finished reply. None when the conversation was deleted in the meantime."""
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        return None
    reply = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=content,
        reasoning=reasoning,
        status=status,
        error=error,
        provider=provider,
        model=model,
        stats=stats.model_dump(),
    )
    session.add(reply)
    conversation.updated_at = utcnow()
    session.commit()
    return reply


def reopen_last_question(session: Session, conversation: Conversation) -> Message:
    """Remove the last reply, if there is one, and return the question it answered."""
    query = select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id.desc()).limit(2)
    latest = list(session.scalars(query))
    if latest and latest[0].role == "assistant":
        session.delete(latest.pop(0))
    if not latest or latest[0].role != "user":
        raise ConversationError("There is no question in this conversation to answer again.")
    session.commit()
    return latest[0]


# --- Shapes for the API ---------------------------------------------------------


def info(conversation: Conversation) -> ConversationInfo:
    return ConversationInfo(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def detail(session: Session, conversation: Conversation) -> ConversationDetail:
    return ConversationDetail(
        **info(conversation).model_dump(),
        messages=[message_info(message) for message in messages(session, conversation)],
    )


def message_info(message: Message) -> MessageInfo:
    return MessageInfo(
        id=message.id,
        role=message.role,
        content=message.content,
        reasoning=message.reasoning,
        status=message.status,
        error=message.error,
        provider=message.provider,
        model=message.model,
        stats=MessageStats.model_validate(message.stats) if message.stats else None,
        created_at=message.created_at,
    )


def title_for(question: str) -> str:
    """The question on one line, cut at a word boundary if it is long."""
    text = " ".join(question.split())
    if len(text) <= TITLE_LENGTH:
        return text
    # One character more, so a word that ends right at the limit is kept whole.
    cut = text[: TITLE_LENGTH + 1].rsplit(" ", 1)[0][:TITLE_LENGTH]
    return cut.rstrip(".,;:!?") + "…"
