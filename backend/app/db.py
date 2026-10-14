import logging
from collections.abc import Iterator
from dataclasses import dataclass

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import Request
from sqlalchemy import MetaData, create_engine, event, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import BACKEND_DIR, Config

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    # Named constraints, so a later migration can refer to them on every database.
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


@dataclass(frozen=True)
class DatabaseInfo:
    backend: str
    location: str
    fallback: bool = False
    error: str | None = None


class Database:
    def __init__(self, engine: Engine, info: DatabaseInfo) -> None:
        self.engine = engine
        self.info = info
        self.sessions = sessionmaker(engine, expire_on_commit=False)

    def migrate(self) -> None:
        """Bring the schema up to the newest migration. Safe to run on every start."""
        alembic = AlembicConfig(str(BACKEND_DIR / "alembic.ini"))
        alembic.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
        with self.engine.begin() as connection:
            # migrations/env.py uses this connection instead of opening its own.
            alembic.attributes["connection"] = connection
            command.upgrade(alembic, "head")


def connect(config: Config) -> Database:
    """Open the configured database.

    Outside production, an unreachable DATABASE_URL falls back to a local SQLite
    file so the app still starts; DatabaseInfo.fallback tells the UI to say so.
    In production the failure is raised: a container that silently writes to a
    throwaway SQLite file is worse than one that refuses to start.
    """
    if not config.database_url:
        return _sqlite(config)

    url = _normalize(make_url(config.database_url))
    engine = create_engine(url, pool_pre_ping=True, connect_args=_connect_args(url))
    if url.get_backend_name() == "sqlite":
        _enforce_foreign_keys(engine)
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
    except SQLAlchemyError as exc:
        engine.dispose()
        if config.is_production:
            raise
        reason = _reason(exc)
        log.warning("Database %s is unreachable, using SQLite instead: %s", _describe(url), reason)
        return _sqlite(config, fallback_from=url, error=reason)
    return Database(engine, DatabaseInfo(backend=url.get_backend_name(), location=_describe(url)))


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.db.sessions() as session:
        yield session


def _normalize(url: URL) -> URL:
    # A bare postgresql:// picks psycopg2 on SQLAlchemy 2.0 and psycopg 3 on 2.1.
    # Pin the driver we actually install.
    if url.drivername in {"postgresql", "postgres"}:
        return url.set(drivername="postgresql+psycopg")
    return url


def _connect_args(url: URL) -> dict[str, object]:
    if url.get_backend_name() == "postgresql":
        return {"connect_timeout": 5}
    if url.get_backend_name() == "sqlite":
        return {"check_same_thread": False}
    return {}


def _sqlite(config: Config, fallback_from: URL | None = None, error: str | None = None) -> Database:
    config.data_dir.mkdir(parents=True, exist_ok=True)
    path = config.data_dir / "rag.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False})
    _enforce_foreign_keys(engine)
    info = DatabaseInfo(
        backend="sqlite",
        location=str(path),
        fallback=fallback_from is not None,
        error=f"{_describe(fallback_from)}: {error}" if fallback_from is not None else None,
    )
    return Database(engine, info)


def _enforce_foreign_keys(engine: Engine) -> None:
    # SQLite ignores foreign keys, and so ON DELETE CASCADE, unless asked on each connection.
    @event.listens_for(engine, "connect")
    def enable(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys=ON")


def _describe(url: URL) -> str:
    if url.get_backend_name() == "sqlite":
        return url.database or "in-memory"
    host = url.host or "localhost"
    port = f":{url.port}" if url.port else ""
    return f"{url.database} on {host}{port}"


def _reason(exc: Exception) -> str:
    """The useful tail of a driver error, which otherwise lists every address it tried."""
    cause = getattr(exc, "orig", None) or exc
    lines = [line.strip() for line in str(cause).splitlines() if line.strip()]
    if not lines:
        return type(cause).__name__
    return lines[-1].rsplit("FATAL:", 1)[-1].rsplit("failed:", 1)[-1].strip()
