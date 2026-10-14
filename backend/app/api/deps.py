from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import Config
from ..db import get_session
from ..models import Account, User
from ..schemas import AppSettings
from ..services import auth, roles
from ..services.llm import Runtime
from ..services.roles import Permission
from ..services.settings_store import SettingsStore


def get_config(request: Request) -> Config:
    return request.app.state.config


def get_runtime(request: Request) -> Runtime:
    return request.app.state.runtime


def get_store(request: Request) -> SettingsStore:
    return request.app.state.store


SessionDep = Annotated[Session, Depends(get_session)]
ConfigDep = Annotated[Config, Depends(get_config)]
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
