"""What a shared server keeps apart, keeps secret, and refuses to do."""

import pytest
from sqlalchemy import text

from app.services import net
from app.services.llm import LLMError

from .conftest import set_up, signed_up

SECRET_KEY_VALUE = "sk-test-not-a-real-key"


def _settings_with(client, **openai):
    settings = client.get("/api/settings").json()
    settings["llm"]["openai"].update(openai)
    return settings


# --- One account's settings are its own ----------------------------------------


def test_accounts_do_not_see_each_others_settings(server):
    amal, karim = signed_up(server, "amal"), signed_up(server, "karim")

    settings = _settings_with(amal, base_url="https://1.1.1.1/v1", model="amal-model", api_key=SECRET_KEY_VALUE)
    settings["prompt"]["system_template"] = "Amal's private instructions"
    assert amal.put("/api/settings", json=settings).status_code == 200

    theirs = karim.get("/api/settings").json()
    assert theirs["llm"]["openai"]["model"] == ""
    assert theirs["llm"]["openai"]["api_key_set"] is False
    assert "Amal" not in theirs["prompt"]["system_template"]

    mine = amal.get("/api/settings").json()
    assert mine["llm"]["openai"]["model"] == "amal-model"
    assert mine["prompt"]["system_template"] == "Amal's private instructions"


def test_an_api_key_is_never_sent_back_and_is_encrypted_at_rest(server):
    client = signed_up(server, "dina")
    saved = client.put("/api/settings", json=_settings_with(client, base_url="https://1.1.1.1/v1", api_key=SECRET_KEY_VALUE))

    assert saved.json()["llm"]["openai"] == {
        "base_url": "https://1.1.1.1/v1",
        "model": "",
        "api_key": None,
        "api_key_set": True,
    }
    assert SECRET_KEY_VALUE not in client.get("/api/settings").text

    with server.state.db.sessions() as db:
        stored = " ".join(str(row[0]) for row in db.execute(text("select value from settings")))
    assert SECRET_KEY_VALUE not in stored and "enc:v1:" in stored


def test_saving_without_retyping_the_key_keeps_it(server):
    client = signed_up(server, "fadi")
    client.put("/api/settings", json=_settings_with(client, base_url="https://1.1.1.1/v1", api_key=SECRET_KEY_VALUE))

    # The browser only ever holds null for the key, and sends that back on every later save.
    again = client.put("/api/settings", json=_settings_with(client, model="some-model"))
    assert again.json()["llm"]["openai"]["api_key_set"] is True

    cleared = client.put("/api/settings", json=_settings_with(client, api_key=""))
    assert cleared.json()["llm"]["openai"]["api_key_set"] is False


# --- Providers a shared server will not run ------------------------------------


@pytest.mark.parametrize("provider", ["transformers", "lmstudio"])
def test_local_providers_are_refused(server, provider):
    client = signed_up(server, "maya")
    settings = client.get("/api/settings").json()
    settings["llm"]["provider"] = provider

    response = client.put("/api/settings", json=settings)
    assert response.status_code == 409
    assert "your own machine" in response.json()["detail"]
    assert client.get("/api/settings").json()["llm"]["provider"] == "openai"

    listing = client.post("/api/llm/models", json={"provider": provider})
    assert listing.status_code == 409
    assert client.post("/api/llm/pick-folder", json={}).status_code == 409


def test_local_providers_are_still_listed_so_people_know_they_exist(server):
    providers = signed_up(server, "noor").get("/api/auth/session").json()["providers"]

    assert [(item["kind"], item["available"]) for item in providers] == [
        ("transformers", False),
        ("lmstudio", False),
        ("openai", True),
    ]
    assert "your own machine" in providers[0]["reason"]


def test_there_is_no_shared_model_to_load_or_unload(server):
    client = signed_up(server, "tarek")
    assert client.get("/api/llm/status").json()["status"] == "unloaded"

    client.put("/api/settings", json=_settings_with(client, base_url="https://1.1.1.1/v1", model="my-model"))
    state = client.get("/api/llm/status").json()
    assert (state["status"], state["provider"], state["model"]) == ("ready", "openai", "my-model")

    assert client.post("/api/llm/unload").status_code == 409
    # Another account configuring nothing is not "ready" because of the first one.
    assert signed_up(server, "ziad").get("/api/llm/status").json()["status"] == "unloaded"


# --- Addresses a shared server will not call ----------------------------------

PRIVATE = [
    "http://localhost:1234/v1",
    "http://127.0.0.1:8000/v1",
    "http://10.0.0.5/v1",
    "http://192.168.1.10:1234/v1",
    "http://172.17.0.1/v1",  # the Docker bridge
    "http://169.254.169.254/latest",  # cloud metadata
    "http://[::1]:1234/v1",
    "http://[::ffff:127.0.0.1]/v1",
    "http://0.0.0.0/v1",
]


@pytest.mark.parametrize("url", PRIVATE)
def test_private_addresses_are_refused(url):
    with pytest.raises(LLMError, match="private network"):
        net.ensure_public_url(url)


@pytest.mark.parametrize("url", ["ftp://1.1.1.1/v1", "1.1.1.1/v1", "https://", "file:///etc/passwd"])
def test_only_web_addresses_are_accepted(url):
    with pytest.raises(LLMError, match="http"):
        net.ensure_public_url(url)


def test_public_addresses_pass():
    net.ensure_public_url("https://1.1.1.1/v1")
    net.ensure_public_url("http://8.8.8.8:8080/v1")


def test_a_private_address_cannot_be_saved_or_listed(server):
    client = signed_up(server, "lina")

    saved = client.put("/api/settings", json=_settings_with(client, base_url="http://localhost:1234/v1"))
    assert saved.status_code == 409
    assert client.get("/api/settings").json()["llm"]["openai"]["base_url"] == "https://api.openai.com/v1"

    listing = client.post("/api/llm/models", json={"provider": "openai", "base_url": "http://127.0.0.1:1234/v1"})
    assert listing.status_code == 409


def test_private_addresses_can_be_allowed_for_testing(make_app):
    app = make_app(local_models=False, open_signup=True, allow_private_urls=True)
    set_up(app)
    client = signed_up(app, "tester")

    saved = client.put("/api/settings", json=_settings_with(client, base_url="http://localhost:1234/v1"))
    assert saved.status_code == 200


def test_production_will_not_start_without_a_secret_key(make_app):
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        make_app(app_env="production", secret_key="")
