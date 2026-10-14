import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import api
from .config import Config, get_config
from .db import connect
from .models import Account
from .schemas import LLMSettings
from .services import auth
from .services.accounts import AccountError
from .services.auth import AuthError
from .services.crypto import Cipher
from .services.llm import LOCAL_PROVIDERS, LLMError, Runtime
from .services.settings_store import SettingsStore

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    config: Config = app.state.config
    database = connect(config)
    database.migrate()

    runtime = Runtime(local_models=config.local_models, allow_private_urls=config.allow_private_urls)
    store = SettingsStore(Cipher.from_config(config), default_provider=runtime.default_provider)
    app.state.db, app.state.runtime, app.state.store = database, runtime, store

    with database.sessions() as session:
        auth.forget_expired_sessions(session)
        startup_llm = _startup_model(session, store) if config.local_models else None
    if startup_llm is not None:
        try:
            await runtime.load(startup_llm)
        except LLMError as exc:
            log.warning("Skipping load on startup: %s", exc)

    yield
    database.engine.dispose()


def _startup_model(session: Session, store: SettingsStore) -> LLMSettings | None:
    """The first account that asked for its local model to load on startup.

    One model is held in memory for the whole process, so at most one account
    gets this. On your own machine there is normally only one account anyway.
    """
    for account_id in session.scalars(select(Account.id).order_by(Account.id)):
        llm = store.load(session, account_id).llm
        if llm.auto_load and llm.provider in LOCAL_PROVIDERS:
            return llm
    return None


def create_app(config: Config | None = None) -> FastAPI:
    config = config or get_config()
    app = FastAPI(title=config.app_name, lifespan=lifespan)
    app.state.config = config
    app.include_router(api.router)

    @app.exception_handler(LLMError)
    async def llm_error(request: Request, exc: LLMError) -> JSONResponse:
        # A conflict with the current model state or configuration, not a server fault.
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(AuthError)
    @app.exception_handler(AccountError)
    async def refused(request: Request, exc: Exception) -> JSONResponse:
        # Something the person asked for that the rules do not allow. The message says why.
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    return app


app = create_app()
