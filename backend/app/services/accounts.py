"""Accounts and the users inside them, after sign-up.

Routes have already checked the actor's permission. What is left here are the
rules that depend on who the target is: the owner cannot be changed or removed
by anyone else, nobody changes their own role or removes themselves, and no
one reaches a user in another account.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, User
from ..schemas import AdminAccount, MemberInfo, NewUser, UserInfo, UserUpdate
from . import auth


class AccountError(Exception):
    """A request the rules refuse. The message is safe to show."""


class NotFound(Exception):
    """No such user or account, or none the actor can see."""


def user_info(user: User) -> UserInfo:
    return UserInfo(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        is_superadmin=user.is_superadmin,
        has_password=user.password_hash is not None,
    )


def member_info(user: User) -> MemberInfo:
    return MemberInfo(**user_info(user).model_dump(), created_at=user.created_at)


# --- Inside one account -------------------------------------------------------


def members(session: Session, account_id: int) -> list[User]:
    # The owner first, then everyone else in the order they joined.
    order = (User.role != "owner", User.created_at, User.id)
    return list(session.scalars(select(User).where(User.account_id == account_id).order_by(*order)))


def add_user(session: Session, account: Account, new: NewUser) -> User:
    return auth.create_user(session, account, new.username, new.password, role=new.role, display_name=new.display_name)


def update_user(session: Session, actor: User, target_id: int, change: UserUpdate) -> User:
    target = _in_account(session, actor, target_id)
    if target.role == "owner" and target.id != actor.id:
        raise AccountError("Only the owner can change the owner's details.")
    if change.role is not None and change.role != target.role:
        if target.id == actor.id:
            raise AccountError("You cannot change your own role. Ask another admin.")
        if target.role == "owner":
            raise AccountError("An account always has its owner.")
        target.role = change.role
    if change.display_name is not None:
        target.display_name = change.display_name.strip()
    if change.password is not None:
        target.password_hash = auth.hash_password(change.password)
    session.commit()
    if change.password is not None and target.id != actor.id:
        # A reset is often because someone else had it: whoever is signed in with it is signed out.
        auth.end_sessions_of(session, target)
    return target


def remove_user(session: Session, actor: User, target_id: int) -> None:
    target = _in_account(session, actor, target_id)
    if target.id == actor.id:
        raise AccountError("You cannot remove yourself.")
    if target.role == "owner":
        raise AccountError("The owner cannot be removed.")
    session.delete(target)
    session.commit()


def rename(session: Session, account: Account, name: str) -> Account:
    account.name = name.strip()
    session.commit()
    return account


def _in_account(session: Session, actor: User, target_id: int) -> User:
    target = session.get(User, target_id)
    # Someone in another account is reported missing, not forbidden, so ids cannot be probed.
    if target is None or target.account_id != actor.account_id:
        raise NotFound
    return target


# --- Across the instance, for superadmins --------------------------------------


def all_accounts(session: Session) -> list[AdminAccount]:
    accounts = session.scalars(select(Account).order_by(Account.created_at, Account.id))
    return [
        AdminAccount(
            id=account.id,
            name=account.name,
            created_at=account.created_at,
            users=[member_info(user) for user in members(session, account.id)],
        )
        for account in accounts
    ]


def delete_account(session: Session, actor: User, account_id: int) -> None:
    account = session.get(Account, account_id)
    if account is None:
        raise NotFound
    if account.id == actor.account_id:
        raise AccountError("You cannot delete the account you are signed in to.")
    # Its users, their sessions and its settings go with it (ON DELETE CASCADE).
    session.delete(account)
    session.commit()


def set_superadmin(session: Session, actor: User, target_id: int, value: bool) -> User:
    target = session.get(User, target_id)
    if target is None:
        raise NotFound
    if target.id == actor.id and not value:
        # Otherwise the last superadmin could leave the instance with nobody running it.
        raise AccountError("You cannot remove your own superadmin access. Ask another superadmin.")
    target.is_superadmin = value
    session.commit()
    return target

