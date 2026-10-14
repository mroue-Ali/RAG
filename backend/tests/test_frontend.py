"""Serving the built web client from the backend, as a deployment does."""

import pytest

from .conftest import browser


@pytest.fixture
def site(make_app, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>rag</html>")
    (dist / "favicon.svg").write_text("<svg/>")
    (dist / "assets" / "app-1234.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("not for the web")
    return browser(make_app(static_dir=dist))


def test_pages_of_the_app_get_the_index(site):
    for path in ("/", "/settings/model", "/admin"):
        response = site.get(path)
        assert response.status_code == 200 and "rag" in response.text
    assert site.get("/").headers["cache-control"] == "no-cache"


def test_files_are_served_as_themselves(site):
    assert site.get("/favicon.svg").text == "<svg/>"
    assert site.get("/assets/app-1234.js").text == "console.log(1)"


def test_the_api_is_not_swallowed_by_the_app(site):
    assert site.get("/api/health").json()["status"] == "ok"
    assert site.get("/api/nothing-here").status_code == 404


def test_nothing_outside_the_build_is_reachable(site):
    assert "not for the web" not in site.get("/../secret.txt").text
    assert "not for the web" not in site.get("/%2e%2e/secret.txt").text
