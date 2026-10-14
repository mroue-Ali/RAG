from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Config
from app.main import create_app

# Made up for the tests. Nothing real is protected by it.
PASSWORD = "correct horse battery"


@pytest.fixture
def make_app(tmp_path) -> Iterator[Callable[..., FastAPI]]:
    """Build an app on its own empty database, already started."""
    started: list[TestClient] = []

    def make(**overrides) -> FastAPI:
        config = Config(
            _env_file=None,  # never the developer's real backend/.env
            database_url=f"sqlite:///{(tmp_path / f'rag-{len(started)}.db').as_posix()}",
            data_dir=tmp_path,
            secret_key=overrides.pop("secret_key", "test-secret"),
            **overrides,
        )
        app = create_app(config)
        runner = TestClient(app)
        runner.__enter__()  # runs startup: migrations, runtime, store
        started.append(runner)
        return app

    yield make
    for runner in started:
        runner.__exit__(None, None, None)


@pytest.fixture
def fresh(make_app) -> FastAPI:
    """Your own machine, before anyone has set it up."""
    return make_app()


@pytest.fixture
def machine(fresh) -> FastAPI:
    """Your own machine, set up: local models, closed sign-up, one account owned by "owner"."""
    set_up(fresh)
    return fresh


@pytest.fixture
def server(make_app) -> FastAPI:
    """A shared server, set up by its operator: no local models, open sign-up."""
    app = make_app(local_models=False, open_signup=True)
    set_up(app, "operator")
    return app


def browser(app: FastAPI) -> TestClient:
    """A separate visitor: its own cookie jar against the same running app."""
    return TestClient(app)


def set_up(app: FastAPI, username: str = "owner", account_name: str = "Home") -> TestClient:
    client = browser(app)
    body = {"account_name": account_name, "username": username, "password": PASSWORD}
    response = client.post("/api/auth/setup", json=body)
    assert response.status_code == 200, response.text
    return client


def signed_up(app: FastAPI, username: str) -> TestClient:
    """Someone who made an account of their own through open sign-up."""
    client = browser(app)
    response = client.post("/api/auth/register", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client


def signed_in(app: FastAPI, username: str, password: str = PASSWORD) -> TestClient:
    client = browser(app)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return client


def added(app: FastAPI, admin: TestClient, username: str, role: str = "member") -> TestClient:
    """A user an admin added to their account, signed in."""
    response = admin.post("/api/account/users", json={"username": username, "password": PASSWORD, "role": role})
    assert response.status_code == 200, response.text
    return signed_in(app, username)
