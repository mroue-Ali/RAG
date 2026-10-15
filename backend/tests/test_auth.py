"""Sign-up, sign-in and sessions, on a server with open sign-up."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from app.models import Account, AuthSession, User
from app.services import auth

from .conftest import PASSWORD, browser, set_up, signed_up

PROTECTED = [
    ("patch", "/api/account"),
    ("get", "/api/account/users"),
    ("post", "/api/account/users"),
    ("patch", "/api/me"),
    ("put", "/api/me/password"),
    ("get", "/api/admin/accounts"),
    ("get", "/api/admin/database"),
    ("get", "/api/settings"),
    ("put", "/api/settings"),
    ("get", "/api/settings/defaults"),
    ("get", "/api/llm/status"),
    ("post", "/api/llm/load"),
    ("post", "/api/llm/unload"),
    ("post", "/api/llm/models"),
    ("get", "/api/prompt/variables"),
    ("post", "/api/prompt/preview"),
    ("get", "/api/conversations"),
    ("get", "/api/conversations/1"),
    ("patch", "/api/conversations/1"),
    ("delete", "/api/conversations/1"),
    ("post", "/api/chat"),
    ("post", "/api/chat/regenerate"),
]


@pytest.mark.parametrize("method, path", PROTECTED)
def test_everything_but_the_front_door_needs_a_session(server, method, path):
    assert browser(server).request(method, path, json={}).status_code == 401


def test_a_visitor_learns_how_to_sign_in_and_nothing_else(server):
    visitor = browser(server)
    session = visitor.get("/api/auth/session").json()

    assert {key: session[key] for key in ("user", "account", "permissions", "signup", "google_client_id")} == {
        "user": None,
        "account": None,
        "permissions": [],
        "signup": "open",
        "google_client_id": None,
    }
    database = visitor.get("/api/health").json()["database"]
    assert database["location"] == "" and database["error"] is None


def test_signing_up_makes_an_account_of_your_own(server):
    client = browser(server)
    response = client.post("/api/auth/register", json={"username": "Layla", "password": PASSWORD})

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "layla"
    assert response.json()["user"]["display_name"] == "Layla"
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie

    session = client.get("/api/auth/session").json()
    assert session["user"]["username"] == "layla"
    # They own it. Running the server stays with the operator who set it up.
    assert (session["user"]["role"], session["user"]["is_superadmin"]) == ("owner", False)
    assert session["account"]["name"] == "Layla"
    assert "account.manage" in session["permissions"]
    assert client.get("/api/settings").json()["llm"]["provider"] == "openai"


def test_usernames_are_unique_whatever_the_case(server):
    signed_up(server, "omar")
    response = browser(server).post("/api/auth/register", json={"username": "OMAR", "password": PASSWORD})

    assert response.status_code == 400
    assert "taken" in response.json()["detail"]


@pytest.mark.parametrize(
    "username, password",
    [
        ("ab", PASSWORD),  # too short
        ("has space", PASSWORD),
        ("-leading", PASSWORD),
        ("fine_name", "short"),
        ("fine_name", "x" * 129),
    ],
)
def test_bad_sign_up_details_are_refused(server, username, password):
    response = browser(server).post("/api/auth/register", json={"username": username, "password": password})

    assert response.status_code == 400
    assert browser(server).get("/api/auth/session").json()["user"] is None
    # A refused sign-up leaves no empty account behind.
    with server.state.db.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Account)) == 1


def test_signing_in_needs_the_right_password(server):
    signed_up(server, "nour")
    client = browser(server)

    wrong = client.post("/api/auth/login", json={"username": "nour", "password": "not the password"})
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": PASSWORD})
    # The same answer for both, so the form cannot be used to find out who has an account.
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json() == unknown.json()
    assert client.get("/api/settings").status_code == 401

    assert client.post("/api/auth/login", json={"username": " Nour ", "password": PASSWORD}).status_code == 200
    assert client.get("/api/settings").status_code == 200


def test_signing_out_ends_the_session_for_good(server):
    client = signed_up(server, "sami")
    token = client.cookies.get(auth.COOKIE)

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/settings").status_code == 401

    # Putting the old cookie back must not work: the session is gone on the server too.
    thief = browser(server)
    thief.cookies.set(auth.COOKIE, token)
    assert thief.get("/api/settings").status_code == 401


def test_sessions_expire(server):
    client = signed_up(server, "hana")
    with server.state.db.sessions() as db:
        db.execute(update(AuthSession).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        db.commit()

    assert client.get("/api/settings").status_code == 401


def test_neither_passwords_nor_session_tokens_are_stored_readable(server):
    client = signed_up(server, "rami")
    token = client.cookies.get(auth.COOKIE)

    with server.state.db.sessions() as db:
        user = db.scalar(select(User).where(User.username == "rami"))
        stored_tokens = set(db.scalars(select(AuthSession.token_hash)))

    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$argon2")
    assert token not in stored_tokens


def test_changing_your_password_signs_out_your_other_browsers(server):
    here = signed_up(server, "mona")
    elsewhere = browser(server)
    elsewhere.post("/api/auth/login", json={"username": "mona", "password": PASSWORD})

    wrong = here.put("/api/me/password", json={"current_password": "not it", "new_password": "a new password"})
    assert wrong.status_code == 400

    changed = here.put("/api/me/password", json={"current_password": PASSWORD, "new_password": "a new password"})
    assert changed.status_code == 200
    assert here.get("/api/settings").status_code == 200
    assert elsewhere.get("/api/settings").status_code == 401
    login = browser(server).post("/api/auth/login", json={"username": "mona", "password": "a new password"})
    assert login.status_code == 200


def test_you_can_rename_yourself(server):
    client = signed_up(server, "adam")
    response = client.patch("/api/me", json={"display_name": "Adam K"})

    assert response.json()["user"]["display_name"] == "Adam K"


# --- Google -------------------------------------------------------------------


def test_google_sign_in_is_off_until_configured(server):
    response = browser(server).post("/api/auth/google", json={"credential": "anything"})

    assert response.status_code == 404


def test_a_forged_google_credential_is_refused(make_app):
    app = make_app(local_models=False, open_signup=True, google_client_id="test-client.apps.googleusercontent.com")
    set_up(app)
    client = browser(app)

    assert client.get("/api/auth/session").json()["google_client_id"] == "test-client.apps.googleusercontent.com"
    response = client.post("/api/auth/google", json={"credential": "not.a.token"})
    assert response.status_code == 400
    assert client.get("/api/auth/session").json()["user"] is None


def test_a_google_identity_maps_to_one_user(server):
    claims = {"sub": "1001", "email": "layla@example.com", "name": "Layla H"}
    with server.state.db.sessions() as db:
        first = auth.google_user(db, claims, create=True)
        again = auth.google_user(db, claims, create=True)
        # Someone else whose address starts the same way still gets a username of their own.
        other = auth.google_user(db, {"sub": "1002", "email": "layla@example.org"}, create=True)

    assert first.id == again.id
    assert (first.username, first.display_name, first.password_hash, first.role) == ("layla", "Layla H", None, "owner")
    assert other.id != first.id and other.username == "layla2"
    assert other.account_id != first.account_id


def test_on_a_closed_instance_google_only_signs_in_people_it_knows(machine):
    with machine.state.db.sessions() as db:
        with pytest.raises(auth.AuthError, match="Ask an admin"):
            auth.google_user(db, {"sub": "3001", "email": "new@example.com"}, create=False)


def test_a_google_user_cannot_be_entered_with_a_password(server):
    with server.state.db.sessions() as db:
        auth.google_user(db, {"sub": "2001", "email": "zein@example.com"}, create=True)

    response = browser(server).post("/api/auth/login", json={"username": "zein", "password": ""})
    assert response.status_code == 400
