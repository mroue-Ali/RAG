"""Users inside one account, and what each role lets them do."""

import pytest

from app.services.roles import GRANTS, Permission

from .conftest import PASSWORD, added, browser, set_up, signed_in, signed_up


@pytest.fixture
def owner(fresh):
    return set_up(fresh)


@pytest.fixture
def admin(fresh, owner):
    return added(fresh, owner, "adel", role="admin")


@pytest.fixture
def member(fresh, owner):
    return added(fresh, owner, "maha")


def _user_id(client) -> int:
    return client.get("/api/auth/session").json()["user"]["id"]


def test_roles_grant_what_the_map_says(owner, admin, member):
    for client, role in [(owner, "owner"), (admin, "admin"), (member, "member")]:
        session = client.get("/api/auth/session").json()
        assert session["user"]["role"] == role
        assert session["permissions"] == sorted(GRANTS[role])
    assert set(GRANTS["owner"]) == set(Permission)


def test_users_of_one_account_share_its_settings(owner, member):
    settings = owner.get("/api/settings").json()
    settings["prompt"]["system_template"] = "House rules"
    assert owner.put("/api/settings", json=settings).status_code == 200

    assert member.get("/api/settings").json()["prompt"]["system_template"] == "House rules"


@pytest.mark.parametrize(
    "method, path",
    [
        ("put", "/api/settings"),
        ("post", "/api/llm/load"),
        ("post", "/api/llm/unload"),
        ("post", "/api/llm/models"),
        ("get", "/api/account/users"),
        ("post", "/api/account/users"),
        ("patch", "/api/account"),
        ("get", "/api/admin/accounts"),
    ],
)
def test_a_member_can_chat_but_not_change_anything(member, method, path):
    body = member.get("/api/settings").json() if path == "/api/settings" else {"provider": "lmstudio", "name": "x"}

    assert member.request(method, path, json=body).status_code == 403


def test_a_member_still_reaches_chat(member):
    # Refused for having no model loaded, not for the role.
    reply = member.post("/api/chat", json={"content": "hi"})
    assert reply.status_code == 409


def test_an_admin_manages_users_and_the_model_but_not_the_account(admin):
    assert admin.get("/api/account/users").status_code == 200
    settings = admin.get("/api/settings").json()
    assert admin.put("/api/settings", json=settings).status_code == 200
    assert admin.patch("/api/account", json={"name": "Taken over"}).status_code == 403


def test_the_owner_renames_the_account(owner):
    response = owner.patch("/api/account", json={"name": "Family"})

    assert response.json()["account"]["name"] == "Family"


def test_the_users_list_starts_with_the_owner(owner, admin, member):
    users = owner.get("/api/account/users").json()

    assert [(user["username"], user["role"]) for user in users] == [
        ("owner", "owner"),
        ("adel", "admin"),
        ("maha", "member"),
    ]


def test_nobody_hands_out_ownership(owner):
    response = owner.post("/api/account/users", json={"username": "second", "password": PASSWORD, "role": "owner"})

    assert response.status_code == 422


def test_an_admin_cannot_touch_the_owner(owner, admin):
    owner_id = _user_id(owner)

    assert admin.patch(f"/api/account/users/{owner_id}", json={"role": "member"}).status_code == 400
    assert admin.patch(f"/api/account/users/{owner_id}", json={"password": "taken over now"}).status_code == 400
    assert admin.delete(f"/api/account/users/{owner_id}").status_code == 400


def test_nobody_changes_their_own_role_or_removes_themselves(owner, admin):
    admin_id = _user_id(admin)

    assert admin.patch(f"/api/account/users/{admin_id}", json={"role": "member"}).status_code == 400
    assert admin.delete(f"/api/account/users/{admin_id}").status_code == 400
    assert owner.delete(f"/api/account/users/{_user_id(owner)}").status_code == 400


def test_an_admin_promotes_and_removes_members(fresh, admin, member):
    member_id = _user_id(member)

    promoted = admin.patch(f"/api/account/users/{member_id}", json={"role": "admin"})
    assert promoted.json()["role"] == "admin"
    assert member.get("/api/account/users").status_code == 200

    assert admin.delete(f"/api/account/users/{member_id}").status_code == 204
    # Removed means signed out too.
    assert member.get("/api/settings").status_code == 401


def test_a_password_reset_signs_the_user_out(fresh, admin, member):
    member_id = _user_id(member)
    admin.patch(f"/api/account/users/{member_id}", json={"password": "a fresh password"})

    assert member.get("/api/settings").status_code == 401
    signed_in(fresh, "maha", "a fresh password")


def test_another_accounts_users_are_out_of_reach(make_app):
    app = make_app(local_models=False, open_signup=True)
    set_up(app, "operator")
    first, second = signed_up(app, "first"), signed_up(app, "second")
    second_id = _user_id(second)

    assert first.patch(f"/api/account/users/{second_id}", json={"display_name": "Mine"}).status_code == 404
    assert first.delete(f"/api/account/users/{second_id}").status_code == 404
    assert [user["username"] for user in first.get("/api/account/users").json()] == ["first"]


def test_added_users_join_the_admins_account(owner, member):
    assert member.get("/api/auth/session").json()["account"] == owner.get("/api/auth/session").json()["account"]


def test_the_prompt_uses_the_name_of_whoever_is_chatting(owner, member):
    member.patch("/api/me", json={"display_name": "Maha S"})
    body = {
        "prompt": {"system_template": "Hello {{user_name}}", "user_template": "{{question}}"},
        "general": {"assistant_name": "Assistant"},
    }

    assert member.post("/api/prompt/preview", json=body).json()["system"] == "Hello Maha S"
    assert owner.post("/api/prompt/preview", json=body).json()["system"] == "Hello owner"


def test_a_new_user_without_a_session_sees_nothing(fresh, owner):
    owner.post("/api/account/users", json={"username": "later", "password": PASSWORD})

    assert browser(fresh).get("/api/account/users").status_code == 401
