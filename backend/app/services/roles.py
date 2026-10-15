"""Who may do what inside an account. Roles and their permissions are defined here and nowhere else.

Routes ask for a permission (deps.require), never for a role, so a new role or
a change to what one may do is an edit to GRANTS alone.

Superadmin is not a role: it sits above every account and is checked separately.
"""

from enum import StrEnum

from ..models import User
from ..schemas import Role


class Permission(StrEnum):
    # Talk to the account's model, and keep your own conversations with it.
    CHAT = "chat"
    # Change the account's model, prompt and generation settings; load and unload models.
    MANAGE_MODEL = "model.manage"
    # Add, change and remove the account's users.
    MANAGE_USERS = "users.manage"
    # Rename the account. Later: its subscription, and deleting it.
    MANAGE_ACCOUNT = "account.manage"


GRANTS: dict[Role, frozenset[Permission]] = {
    "owner": frozenset(Permission),
    "admin": frozenset({Permission.CHAT, Permission.MANAGE_MODEL, Permission.MANAGE_USERS}),
    "member": frozenset({Permission.CHAT}),
}


def permissions(user: User) -> frozenset[Permission]:
    return GRANTS.get(user.role, frozenset())  # type: ignore[call-overload]


def can(user: User, permission: Permission) -> bool:
    return permission in permissions(user)
