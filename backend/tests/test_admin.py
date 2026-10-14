"""Superadmins: the people who run the instance, above every account."""

from sqlalchemy import select

from app.models import Setting

from .conftest import added, browser, set_up, signed_up


def _operator(server):
    client = browser(server)
    client.post("/api/auth/login", json={"username": "operator", "password": "correct horse battery"})
    return client


def test_only_superadmins_get_in(server):
    owner = signed_up(server, "nadine")

    assert owner.get("/api/admin/accounts").status_code == 403
    assert owner.get("/api/admin/database").status_code == 403


def test_a_superadmin_sees_every_account_and_its_users(server):
    operator = _operator(server)
    owner = signed_up(server, "nadine")
    added(server, owner, "kid")

    accounts = operator.get("/api/admin/accounts").json()
    assert [(account["name"], [user["username"] for user in account["users"]]) for account in accounts] == [
        ("Home", ["operator"]),
        ("nadine", ["nadine", "kid"]),
    ]


def test_deleting_an_account_takes_its_users_and_data_with_it(server):
    operator = _operator(server)
    owner = signed_up(server, "nadine")
    owner.put("/api/settings", json=owner.get("/api/settings").json())
    account_id = owner.get("/api/auth/session").json()["account"]["id"]

    assert operator.delete(f"/api/admin/accounts/{account_id}").status_code == 204
    assert owner.get("/api/settings").status_code == 401
    assert browser(server).post("/api/auth/login", json={"username": "nadine", "password": "correct horse battery"}).status_code == 400
    with server.state.db.sessions() as db:
        assert db.scalars(select(Setting).where(Setting.account_id == account_id)).first() is None


def test_a_superadmin_cannot_delete_their_own_account(server):
    operator = _operator(server)
    own = operator.get("/api/auth/session").json()["account"]["id"]

    assert operator.delete(f"/api/admin/accounts/{own}").status_code == 400


def test_superadmin_can_be_shared_but_not_given_up(server):
    operator = _operator(server)
    helper = signed_up(server, "helper")
    helper_id = helper.get("/api/auth/session").json()["user"]["id"]
    operator_id = operator.get("/api/auth/session").json()["user"]["id"]

    granted = operator.patch(f"/api/admin/users/{helper_id}", json={"is_superadmin": True})
    assert granted.json()["is_superadmin"] is True
    assert helper.get("/api/admin/accounts").status_code == 200

    assert operator.patch(f"/api/admin/users/{operator_id}", json={"is_superadmin": False}).status_code == 400
    # Another superadmin can take it away, though.
    assert helper.patch(f"/api/admin/users/{operator_id}", json={"is_superadmin": False}).status_code == 200


def test_a_superadmin_sees_where_the_database_is(fresh):
    owner = set_up(fresh)

    assert owner.get("/api/admin/database").json()["location"].endswith(".db")
