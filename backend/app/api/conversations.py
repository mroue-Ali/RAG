"""The signed-in user's saved conversations. Asking a question in one is in chat.py."""

from fastapi import APIRouter, Response

from ..schemas import ConversationDetail, ConversationInfo, ConversationUpdate
from ..services import conversations
from ..services.roles import Permission
from .deps import ConversationDep, SessionDep, UserDep, require

router = APIRouter(prefix="/conversations", tags=["conversations"], dependencies=[require(Permission.CHAT)])


@router.get("")
def list_conversations(user: UserDep, session: SessionDep) -> list[ConversationInfo]:
    """Most recent activity first."""
    return [conversations.info(conversation) for conversation in conversations.of_user(session, user)]


@router.get("/{conversation_id}")
def get_conversation(conversation: ConversationDep, session: SessionDep) -> ConversationDetail:
    return conversations.detail(session, conversation)


@router.patch("/{conversation_id}")
def rename_conversation(body: ConversationUpdate, conversation: ConversationDep, session: SessionDep) -> ConversationInfo:
    return conversations.info(conversations.rename(session, conversation, body.title))


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation: ConversationDep, session: SessionDep) -> Response:
    conversations.delete(session, conversation)
    return Response(status_code=204)
