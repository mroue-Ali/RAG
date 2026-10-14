from fastapi import APIRouter

from ..schemas import AppSettings
from ..services.roles import Permission
from .deps import RuntimeDep, SessionDep, SettingsDep, StoreDep, UserDep, require

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def read_settings(settings: SettingsDep, store: StoreDep) -> AppSettings:
    """The account's settings. Everyone in it can read them; the API key never leaves the server."""
    return store.public(settings)


@router.put("", dependencies=[require(Permission.MANAGE_MODEL)])
def update_settings(
    incoming: AppSettings, session: SessionDep, user: UserDep, store: StoreDep, runtime: RuntimeDep
) -> AppSettings:
    runtime.check(incoming.llm)
    return store.public(store.save(session, user.account_id, incoming))


@router.get("/defaults")
def default_settings(user: UserDep, store: StoreDep) -> AppSettings:
    return store.defaults()
