"""The whole instance, for its superadmins: every account and every user."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Request, Response

from ..schemas import AdminAccount, DatabaseStatus, MemberInfo, SuperadminUpdate
from ..services import accounts
from .deps import SessionDep, SuperadminDep

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/accounts")
def list_accounts(admin: SuperadminDep, session: SessionDep) -> list[AdminAccount]:
    return accounts.all_accounts(session)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, admin: SuperadminDep, session: SessionDep) -> Response:
    try:
        accounts.delete_account(session, admin, account_id)
    except accounts.NotFound as exc:
        raise HTTPException(status_code=404, detail="No such account.") from exc
    return Response(status_code=204)


@router.patch("/users/{user_id}")
def set_superadmin(user_id: int, body: SuperadminUpdate, admin: SuperadminDep, session: SessionDep) -> MemberInfo:
    try:
        return accounts.member_info(accounts.set_superadmin(session, admin, user_id, body.is_superadmin))
    except accounts.NotFound as exc:
        raise HTTPException(status_code=404, detail="No such user.") from exc


@router.get("/database")
def database(request: Request, admin: SuperadminDep) -> DatabaseStatus:
    """Where the data lives. Not part of the public health check, which anyone can call."""
    return DatabaseStatus(**asdict(request.app.state.db.info))
