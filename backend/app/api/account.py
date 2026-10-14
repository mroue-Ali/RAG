from fastapi import APIRouter, HTTPException, Request, Response

from ..schemas import AccountUpdate, MemberInfo, NewUser, PasswordChange, ProfileUpdate, SessionInfo, UserUpdate
from ..services import accounts, auth
from ..services.roles import Permission
from .auth import describe
from .deps import AccountDep, ConfigDep, RuntimeDep, SessionDep, UserDep, require

router = APIRouter(tags=["account"])


# --- The account ----------------------------------------------------------------


@router.patch("/account", dependencies=[require(Permission.MANAGE_ACCOUNT)])
def rename_account(
    body: AccountUpdate, account: AccountDep, user: UserDep, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    accounts.rename(session, account, body.name)
    return describe(session, user, config, runtime)


@router.get("/account/users", dependencies=[require(Permission.MANAGE_USERS)])
def list_users(user: UserDep, session: SessionDep) -> list[MemberInfo]:
    return [accounts.member_info(member) for member in accounts.members(session, user.account_id)]


@router.post("/account/users", dependencies=[require(Permission.MANAGE_USERS)])
def add_user(body: NewUser, account: AccountDep, session: SessionDep) -> MemberInfo:
    return accounts.member_info(accounts.add_user(session, account, body))


@router.patch("/account/users/{user_id}", dependencies=[require(Permission.MANAGE_USERS)])
def update_user(user_id: int, body: UserUpdate, user: UserDep, session: SessionDep) -> MemberInfo:
    try:
        return accounts.member_info(accounts.update_user(session, user, user_id, body))
    except accounts.NotFound as exc:
        raise HTTPException(status_code=404, detail="No such user in this account.") from exc


@router.delete("/account/users/{user_id}", status_code=204, dependencies=[require(Permission.MANAGE_USERS)])
def remove_user(user_id: int, user: UserDep, session: SessionDep) -> Response:
    try:
        accounts.remove_user(session, user, user_id)
    except accounts.NotFound as exc:
        raise HTTPException(status_code=404, detail="No such user in this account.") from exc
    return Response(status_code=204)


# --- The signed-in user ---------------------------------------------------------


@router.patch("/me")
def update_profile(
    body: ProfileUpdate, user: UserDep, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    user.display_name = body.display_name.strip()
    session.commit()
    return describe(session, user, config, runtime)


@router.put("/me/password")
def change_password(
    body: PasswordChange,
    request: Request,
    user: UserDep,
    session: SessionDep,
    config: ConfigDep,
    runtime: RuntimeDep,
) -> SessionInfo:
    if user.password_hash is not None and not auth.password_matches(user, body.current_password):
        raise auth.AuthError("Your current password is not right.")
    user.password_hash = auth.hash_password(body.new_password)
    session.commit()
    # Anyone else signed in with the old password is signed out; this browser stays in.
    auth.end_sessions_of(session, user, keep=request.cookies.get(auth.COOKIE))
    return describe(session, user, config, runtime)
