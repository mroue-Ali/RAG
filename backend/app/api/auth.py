from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..config import Config
from ..models import Account, User
from ..schemas import AccountInfo, Credentials, GoogleCredential, SessionInfo, SetupRequest
from ..services import accounts, auth, roles
from ..services.llm import Runtime
from .deps import ConfigDep, MaybeUserDep, RuntimeDep, SessionDep

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/session")
def read_session(user: MaybeUserDep, session: SessionDep, config: ConfigDep, runtime: RuntimeDep) -> SessionInfo:
    """Public on purpose: the client asks this first to learn what to show."""
    return describe(session, user, config, runtime)


@router.post("/setup")
def setup(
    body: SetupRequest, response: Response, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    """Create the first account and its owner. Open only while the instance has no users."""
    user = auth.setup(session, body.account_name, body.username, body.password)
    _sign_in(response, session, user, config)
    return describe(session, user, config, runtime)


@router.post("/register")
def register(
    credentials: Credentials, response: Response, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    if _signup(session, config) != "open":
        raise HTTPException(status_code=403, detail="Sign-up is closed here. Ask an admin to add you.")
    user = auth.register(session, credentials.username, credentials.password)
    _sign_in(response, session, user, config)
    return describe(session, user, config, runtime)


@router.post("/login")
def login(
    credentials: Credentials, response: Response, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    user = auth.authenticate(session, credentials.username, credentials.password)
    _sign_in(response, session, user, config)
    return describe(session, user, config, runtime)


@router.post("/google")
def google(
    body: GoogleCredential, response: Response, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    if not config.google_client_id:
        raise HTTPException(status_code=404, detail="Sign in with Google is not set up on this instance.")
    if auth.needs_setup(session):
        raise HTTPException(status_code=403, detail="Set this instance up first.")
    claims = auth.verify_google_credential(body.credential, config.google_client_id)
    user = auth.google_user(session, claims, create=config.open_signup)
    _sign_in(response, session, user, config)
    return describe(session, user, config, runtime)


@router.post("/logout")
def logout(
    request: Request, response: Response, session: SessionDep, config: ConfigDep, runtime: RuntimeDep
) -> SessionInfo:
    token = request.cookies.get(auth.COOKIE)
    if token:
        auth.end_session(session, token)
    response.delete_cookie(auth.COOKIE, path="/")
    return describe(session, None, config, runtime)


def describe(session: Session, user: User | None, config: Config, runtime: Runtime) -> SessionInfo:
    account = session.get(Account, user.account_id) if user else None
    return SessionInfo(
        app=config.app_name,
        user=accounts.user_info(user) if user else None,
        account=AccountInfo(id=account.id, name=account.name) if account else None,
        permissions=sorted(roles.permissions(user)) if user else [],
        signup=_signup(session, config),
        providers=runtime.providers(),
        google_client_id=config.google_client_id or None,
    )


def _signup(session: Session, config: Config) -> str:
    if auth.needs_setup(session):
        return "setup"
    return "open" if config.open_signup else "closed"


def _sign_in(response: Response, session: Session, user: User, config: Config) -> None:
    token = auth.start_session(session, user, config.session_days)
    response.set_cookie(
        auth.COOKIE,
        token,
        max_age=config.session_days * 24 * 3600,
        path="/",
        # Out of reach of page scripts, and not sent along with requests other sites make.
        httponly=True,
        samesite="lax",
        secure=config.is_production,
    )
