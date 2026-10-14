"""A new instance on your own machine: first-run setup, closed sign-up, local models."""

import pytest

from .conftest import PASSWORD, browser, set_up


def test_a_new_instance_asks_to_be_set_up(fresh):
    session = browser(fresh).get("/api/auth/session").json()

    assert session["signup"] == "setup"
    assert session["user"] is None
    assert browser(fresh).get("/api/settings").status_code == 401


def test_setup_makes_the_first_account_its_owner_and_the_instance_superadmin(fresh):
    client = browser(fresh)
    response = client.post(
        "/api/auth/setup", json={"account_name": "Home", "username": "Ali", "password": PASSWORD}
    )

    assert response.status_code == 200
    session = client.get("/api/auth/session").json()
    assert session["user"]["username"] == "ali"
    assert (session["user"]["role"], session["user"]["is_superadmin"]) == ("owner", True)
    assert session["account"]["name"] == "Home"
    assert session["signup"] == "closed"


def test_setup_happens_once(machine):
    again = browser(machine).post(
        "/api/auth/setup", json={"account_name": "Mine now", "username": "intruder", "password": PASSWORD}
    )

    assert again.status_code == 400
    assert "already set up" in again.json()["detail"]


def test_bad_setup_details_leave_the_instance_unset(fresh):
    response = browser(fresh).post("/api/auth/setup", json={"account_name": "Home", "username": "x", "password": PASSWORD})

    assert response.status_code == 400
    assert browser(fresh).get("/api/auth/session").json()["signup"] == "setup"
    set_up(fresh)


def test_sign_up_is_closed_unless_opened(fresh):
    body = {"username": "someone", "password": PASSWORD}
    # Not before setup either: the first person in has to go through setup.
    assert browser(fresh).post("/api/auth/register", json=body).status_code == 403

    set_up(fresh)
    response = browser(fresh).post("/api/auth/register", json=body)
    assert response.status_code == 403
    assert "Ask an admin" in response.json()["detail"]


def test_every_provider_runs_here(machine):
    owner = browser(machine)
    owner.post("/api/auth/login", json={"username": "owner", "password": PASSWORD})
    session = owner.get("/api/auth/session").json()

    assert [(item["kind"], item["available"]) for item in session["providers"]] == [
        ("transformers", True),
        ("lmstudio", True),
        ("openai", True),
    ]
    assert owner.get("/api/settings").json()["llm"]["provider"] == "lmstudio"


@pytest.fixture
def owner(machine):
    client = browser(machine)
    client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD})
    return client


def test_settings_survive_a_round_trip(owner):
    settings = owner.get("/api/settings").json()
    settings["llm"]["provider"] = "transformers"
    settings["general"]["assistant_name"] = "Sage"
    assert owner.put("/api/settings", json=settings).status_code == 200

    saved = owner.get("/api/settings").json()
    assert saved["llm"]["provider"] == "transformers"
    assert saved["general"]["assistant_name"] == "Sage"


def test_an_api_on_this_machine_may_be_used(owner):
    # LM Studio and friends live on localhost. That is only refused on a shared server.
    settings = owner.get("/api/settings").json()
    settings["llm"]["provider"] = "openai"
    settings["llm"]["openai"].update(base_url="http://localhost:1234/v1", model="local-model")

    assert owner.put("/api/settings", json=settings).status_code == 200


def test_nothing_is_loaded_until_asked(owner):
    assert owner.get("/api/llm/status").json()["status"] == "unloaded"

    reply = owner.post("/api/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]})
    assert reply.status_code == 409
    assert "No model is loaded" in reply.json()["detail"]
