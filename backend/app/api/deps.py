from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import Config
from ..db import Database, get_session
from ..models import Account, Conversation, User
from ..schemas import AppSettings
from ..services import auth, conversations, roles
from ..services.llm import Runtime
from ..services.roles import Permission
from ..services.settings_store import SettingsStore


def get_config(request: Request) -> Config:
    return request.app.state.config


def get_database(request: Request) -> Database:
    """For work that outlives the request's own session, such as storing a streamed reply."""
    return request.app.state.db


def get_runtime(request: Request) -> Runtime:
    return request.app.state.runtime


def get_store(request: Request) -> SettingsStore:
    return request.app.state.store


SessionDep = Annotated[Session, Depends(get_session)]
ConfigDep = Annotated[Config, Depends(get_config)]
DatabaseDep = Annotated[Database, Depends(get_database)]
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
StoreDep = Annotated[SettingsStore, Depends(get_store)]


def get_signed_in_user(request: Request, session: SessionDep) -> User | None:
    token = request.cookies.get(auth.COOKIE)
    return auth.user_for_token(session, token) if token else None


MaybeUserDep = Annotated[User | None, Depends(get_signed_in_user)]


def get_user(user: MaybeUserDep) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


UserDep = Annotated[User, Depends(get_user)]


def get_account(user: UserDep, session: SessionDep) -> Account:
    account = session.get(Account, user.account_id)
    assert account is not None  # users are deleted with their account
    return account


AccountDep = Annotated[Account, Depends(get_account)]


def require(permission: Permission) -> Any:
    """A dependency that lets the request through only if the user's role allows it.

    Use as `dependencies=[require(Permission.X)]` on a route or router.
    """

    def check(user: UserDep) -> None:
        if not roles.can(user, permission):
            raise HTTPException(status_code=403, detail="Your role in this account does not allow that.")

    return Depends(check)


def get_superadmin(user: UserDep) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Only the people who run this instance can do that.")
    return user


SuperadminDep = Annotated[User, Depends(get_superadmin)]


def get_settings(session: SessionDep, user: UserDep, store: StoreDep) -> AppSettings:
    """The settings of the signed-in user's account."""
    return store.load(session, user.account_id)


SettingsDep = Annotated[AppSettings, Depends(get_settings)]


def find_conversation(session: Session, user: User, conversation_id: int) -> Conversation:
    """The user's own conversation with this id, or a 404."""
    try:
        return conversations.get(session, user, conversation_id)
    except conversations.NotFound as exc:
        raise HTTPException(status_code=404, detail="No such conversation.") from exc


def get_conversation(conversation_id: int, user: UserDep, session: SessionDep) -> Conversation:
    """The conversation named in the path, for routes under /conversations/{conversation_id}."""
    return find_conversation(session, user, conversation_id)


ConversationDep = Annotated[Conversation, Depends(get_conversation)]
