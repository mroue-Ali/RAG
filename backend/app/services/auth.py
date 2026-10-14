"""Sign-in: who someone is, how they prove it, and the sessions behind the cookie.

Creating users also lives here, because every way in (first-run setup, sign-up,
Google, an admin adding someone) has to apply the same rules to usernames and
passwords. What happens to users after that is in app.services.accounts.
"""

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Account, AuthSession, User
from ..schemas import Role

COOKIE = "rag_session"

_USERNAME = re.compile(r"[a-z0-9][a-z0-9_.-]{2,31}")
_MIN_PASSWORD, _MAX_PASSWORD = 8, 128
_GOOGLE_KEYS = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs")
_GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

_hasher = PasswordHasher()
# Checked against when the username does not exist, so a wrong username takes
# as long to reject as a wrong password and the two cannot be told apart.
_DECOY_HASH = _hasher.hash(secrets.token_urlsafe(16))


class AuthError(Exception):
    """A sign-in or sign-up problem whose message is safe to show."""


# --- Ways in ------------------------------------------------------------------


def needs_setup(session: Session) -> bool:
    """True until the instance has its first user. Until then, only setup() is open."""
    return not session.scalar(select(exists().where(User.id.is_not(None))))


def setup(session: Session, account_name: str, username: str, password: str) -> User:
    """Create the first account and its owner, who also runs the instance."""
    if not needs_setup(session):
        raise AuthError("This instance is already set up. Sign in instead.")
    account = Account(name=account_name.strip())
    session.add(account)
    session.flush()
    return create_user(session, account, username, password, role="owner", is_superadmin=True)


def register(session: Session, username: str, password: str) -> User:
    """Open sign-up: a new account with this person as its owner."""
    account = Account(name=username.strip())
    session.add(account)
    session.flush()
    return create_user(session, account, username, password, role="owner")


def create_user(
    session: Session,
    account: Account,
    username: str,
    password: str,
    role: Role,
    display_name: str = "",
    is_superadmin: bool = False,
) -> User:
    name = username.strip().lower()
    if not _USERNAME.fullmatch(name):
        raise AuthError(
            "Choose a username of 3 to 32 characters: letters, digits, dots, dashes or underscores, "
            "starting with a letter or digit."
        )
    user = User(
        account_id=account.id,
        role=role,
        is_superadmin=is_superadmin,
        username=name,
        display_name=display_name.strip() or username.strip(),
        password_hash=hash_password(password),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AuthError("That username is taken.") from exc
    return user


def hash_password(password: str) -> str:
    if not _MIN_PASSWORD <= len(password) <= _MAX_PASSWORD:
        raise AuthError(f"Choose a password of at least {_MIN_PASSWORD} characters.")
    return _hasher.hash(password)


def password_matches(user: User, password: str) -> bool:
    if user.password_hash is None or len(password) > _MAX_PASSWORD:
        return False
    try:
        return _hasher.verify(user.password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def authenticate(session: Session, username: str, password: str) -> User:
    user = session.scalar(select(User).where(User.username == username.strip().lower()))
    # Users made through Google have no password, and nothing over the limit was ever stored.
    known = user is not None and user.password_hash is not None and len(password) <= _MAX_PASSWORD
    try:
        _hasher.verify(user.password_hash if known else _DECOY_HASH, password if known else "")
    except (VerificationError, InvalidHashError) as exc:
        raise AuthError("Wrong username or password.") from exc
    if not known:
        raise AuthError("Wrong username or password.")
    return user


# --- Google -------------------------------------------------------------------


def verify_google_credential(credential: str, client_id: str) -> dict[str, Any]:
    """Check an ID token from Sign in with Google and return its claims."""
    try:
        key = _GOOGLE_KEYS.get_signing_key_from_jwt(credential)
        return jwt.decode(
            credential, key.key, algorithms=["RS256"], audience=client_id, issuer=_GOOGLE_ISSUERS
        )
    except jwt.PyJWTError as exc:
        raise AuthError("Google sign-in could not be verified. Try again.") from exc


def google_user(session: Session, claims: dict[str, Any], create: bool) -> User:
    """The user for a verified Google identity.

    Someone new gets an account of their own only when sign-up is open. On a
    closed instance Google can sign in only users who have used it there before.
    """
    subject = str(claims["sub"])
    user = session.scalar(select(User).where(User.google_sub == subject))
    if user is not None:
        return user
    if not create:
        raise AuthError("No one here signs in with that Google account. Ask an admin to add you.")
    email = claims.get("email")
    account = Account(name=claims.get("name") or email or "Google user")
    session.add(account)
    session.flush()
    user = User(
        account_id=account.id,
        role="owner",
        username=_free_username(session, (email or "user").split("@")[0]),
        display_name=claims.get("name") or email or "Google user",
        google_sub=subject,
        email=email,
    )
    session.add(user)
    session.commit()
    return user


def _free_username(session: Session, wanted: str) -> str:
    base = re.sub(r"[^a-z0-9_.-]", "", wanted.lower()).lstrip("_.-")[:24] or "user"
    if len(base) < 3:
        base = f"{base}-user"
    candidate, attempt = base, 1
    while session.scalar(select(User.id).where(User.username == candidate)):
        attempt += 1
        candidate = f"{base}{attempt}"
    return candidate


# --- Sessions -----------------------------------------------------------------


def start_session(session: Session, user: User, days: int) -> str:
    """Sign the user in and return the token for their cookie."""
    token = secrets.token_urlsafe(32)
    session.add(
        AuthSession(token_hash=_digest(token), user_id=user.id, expires_at=_now() + timedelta(days=days))
    )
    session.commit()
    return token


def user_for_token(session: Session, token: str) -> User | None:
    record = session.get(AuthSession, _digest(token))
    if record is None:
        return None
    # SQLite hands datetimes back without a timezone; they were stored in UTC.
    expires = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=timezone.utc)
    if expires <= _now():
        session.delete(record)
        session.commit()
        return None
    return session.get(User, record.user_id)


def end_session(session: Session, token: str) -> None:
    session.execute(delete(AuthSession).where(AuthSession.token_hash == _digest(token)))
    session.commit()


def end_sessions_of(session: Session, user: User, keep: str | None = None) -> None:
    """Sign the user out everywhere, except the browser holding `keep`. Used when a password changes."""
    statement = delete(AuthSession).where(AuthSession.user_id == user.id)
    if keep:
        statement = statement.where(AuthSession.token_hash != _digest(keep))
    session.execute(statement)
    session.commit()


def forget_expired_sessions(session: Session) -> None:
    session.execute(delete(AuthSession).where(AuthSession.expires_at <= _now()))
    session.commit()


def _digest(token: str) -> str:
    # The database holds only this, so a leaked table cannot be replayed as cookies.
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)
