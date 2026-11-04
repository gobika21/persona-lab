"""Web API, public-mode safety and demo-site serving."""
import pytest

from personalab import guard
from personalab.evals import serve_sites
from personalab.journey import explain_error
from personalab.server import create_app
from tests.helpers import HAVE_BROWSER, Scripted, tool


def finisher(persona, n, seen, kw):
    if n == 0:
        return [tool("report_barrier", title="Demo barrier", detail="d", severity="serious", fix="f")]
    if persona == "screen_reader":  # a model can send junk: worked must end up a clean list
        return [tool("finish", success=True, summary="done", worked="not a list")]
    return [tool("finish", success=persona != "keyboard", summary="done", worked=["Headings were clear", " ", "Phone number in the footer"])]


def fake_web(tmp_path):
    """A stand-in for the Next.js static export (web/out), so tests don't need Node."""
    for name, body in {"index.html": "home", "evals.html": "evals", "history.html": "history", "404.html": "missing",
                       "_next/static/chunks/app.js": "js"}.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(body)
    return tmp_path


def test_web_app_routes(tmp_path):
    c = create_app(web_dir=fake_web(tmp_path)).test_client()
    assert c.get("/").get_data(as_text=True) == "home"
    assert c.get("/history").get_data(as_text=True) == "history" and c.get("/history/").status_code == 200
    js = c.get("/_next/static/chunks/app.js")
    assert js.status_code == 200 and "immutable" in js.headers["Cache-Control"]
    r = c.get("/no-such-page")
    assert r.status_code == 404 and r.get_data(as_text=True) == "missing"
    assert c.get("/../personalab/server.py").status_code == 404
    assert c.get("/api/nope").status_code == 404 and c.get("/api/nope").json["error"]
    assert c.get("/").headers["X-Frame-Options"] == "DENY"
    assert create_app(web_dir=tmp_path / "unbuilt").test_client().get("/").status_code == 503


def test_pages_and_meta(monkeypatch, tmp_path):
    monkeypatch.delenv("PUBLIC_MODE", raising=False)
    c = create_app(web_dir=fake_web(tmp_path)).test_client()
    assert c.get("/").status_code == 200 and c.get("/evals").status_code == 200
    assert c.get("/bench/hotel/index.html").status_code == 200
    assert c.get("/bench/../personalab/server.py").status_code == 404
    assert len(c.get("/api/personas").json) == 4
    assert {d["id"] for d in c.get("/api/demos").json} >= {"hotel-book", "library-hours"}
    assert isinstance(c.get("/api/evals").json, list)
    assert c.get("/").headers["X-Frame-Options"] == "DENY"


def test_run_needs_a_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    c = create_app().test_client()
    r = c.post("/api/run", json={"url": "example.com", "goal": "x"})
    assert r.status_code == 503 and "API key" in r.json["error"]
    assert c.post("/api/run", json={"url": "x.com", "goal": "g"}, headers={"X-Anthropic-Key": "nope"}).status_code == 503


@pytest.mark.skipif(not HAVE_BROWSER, reason="Playwright Chromium not installed")
def test_run_end_to_end_and_report():
    app = create_app(agent_client=Scripted(finisher))
    app.config["SYNC"] = True
    c = app.test_client()
    with serve_sites() as base:
        g = c.post("/api/run", json={"url": f"{base}/hotel/index.html", "goal": "Find the phone number"}).json
    assert g["finished"] and g["total"] == 4 and g["completed"] == 3
    assert all(m["barrier_list"] for m in g["members"]) and all(m["tokens"] > 0 for m in g["members"])
    assert g["cost_usd"] == round(sum(m["cost_usd"] for m in g["members"]), 4) and g["cost_usd"] > 0
    worked = {m["persona"]: m["worked"] for m in g["members"]}
    assert worked["keyboard"] == ["Headings were clear", "Phone number in the footer"] and worked["screen_reader"] == []
    rep = c.get(f"/api/run/{g['id']}/report.html")
    assert rep.headers["Content-Disposition"].startswith("attachment") and "3 of 4 people" in rep.get_data(as_text=True)
    j = c.get(f"/api/journey/{g['journeys'][0]}").json
    assert j["usage"]["llm_calls"] == 2
    assert "beforeprint" in rep.get_data(as_text=True)  # Save as PDF expands the step logs
    assert "What worked" in rep.get_data(as_text=True) and "Phone number in the footer" in rep.get_data(as_text=True)

    # JSON export: what the browser stores in History and what users download / import
    ex = c.get(f"/api/run/{g['id']}/export.json")
    assert ex.headers["Content-Disposition"].startswith("attachment")
    rec = ex.json
    assert rec["format"] == "persona-lab-run" and rec["version"] == 1 and rec["exported_at"]
    assert rec["run"]["id"] == g["id"] and rec["run"]["completed"] == 3 and len(rec["run"]["members"]) == 4
    assert {j["id"] for j in rec["journeys"]} == set(g["journeys"]) and all(j["steps"] for j in rec["journeys"])
    assert "shots" not in str(rec.keys()) and "base64" not in ex.get_data(as_text=True)
    assert c.get("/api/run/nope/export.json").status_code == 404


class FakeAPIError(Exception):
    def __init__(self, status_code, message):
        super().__init__(f"Error code: {status_code} - {{'type': 'error', 'error': {{'message': '{message}'}}}}")
        self.status_code = status_code


def test_account_errors_are_explained():
    """A key with no credits (or a bad key) is about the account, not the site: say so in plain words."""
    def broke(persona, n, seen, kw):
        raise FakeAPIError(400, "Your credit balance is too low to access the Anthropic API.")
    app = create_app(agent_client=Scripted(broke))
    app.config["SYNC"] = True
    with serve_sites() as base:
        g = app.test_client().post("/api/run", json={"url": f"{base}/hotel/index.html", "goal": "Find the phone number"}).json
    assert g["finished"] and g["completed"] == 0
    assert {m["status"] for m in g["members"]} == {"error"}
    assert {m["error"] for m in g["members"]} == {explain_error(FakeAPIError(400, "Your credit balance is too low"))}
    assert "no credits" in g["members"][0]["error"] and "Error code" not in g["members"][0]["error"]

    assert "rejected the API key" in explain_error(FakeAPIError(401, "invalid x-api-key"))
    assert "rate limit" in explain_error(FakeAPIError(429, "rate_limit_error"))
    assert "busy" in explain_error(FakeAPIError(529, "Overloaded"))
    assert explain_error(ValueError("Couldn't open https://x.test: net::ERR_NAME_NOT_RESOLVED\nmore")) == \
        "Couldn't open https://x.test: net::ERR_NAME_NOT_RESOLVED"


def test_public_mode_guard_and_limits(monkeypatch):
    monkeypatch.setenv("PUBLIC_MODE", "1")
    monkeypatch.setenv("LIMIT_JOURNEY", "4")
    for bad in ("http://127.0.0.1/", "http://localhost:3000/", "http://10.0.0.5/", "http://169.254.169.254/latest/",
                "http://[::1]/", "http://example.com:22/", "http://intranet.local/"):
        with pytest.raises(guard.BlockedURL):
            guard.check_url(bad)
    monkeypatch.setenv("PORT", "8000")
    guard.check_url("http://127.0.0.1:8000/bench/hotel/index.html?booking=1")  # built-in demos stay reachable
    for bad in ("http://127.0.0.1:8000/api/evals", "http://127.0.0.1:8000/bench/../api/evals",
                "http://127.0.0.1:8000/bench/%2e%2e/api/evals", "http://127.0.0.1:8001/bench/hotel/"):
        with pytest.raises(guard.BlockedURL):
            guard.check_url(bad)
    app = create_app(agent_client=Scripted(finisher))
    started = []
    app.config["JOURNEYS"].start_group = lambda *a, **k: started.append(1) or {"id": "x", "members": []}
    c = app.test_client()
    r = c.post("/api/run", json={"url": "http://192.168.1.1", "goal": "g"})
    assert r.status_code == 400 and "private" in r.json["error"]
    assert c.post("/api/run", json={"url": "https://8.8.8.8", "goal": "g"}).status_code == 200
    r = c.post("/api/run", json={"url": "https://8.8.8.8", "goal": "g"})
    assert r.status_code == 429 and "own Claude API key" in r.json["error"]
    assert len(started) == 1

    # The site-wide cap stops everyone once it's spent, whatever their own allowance; own keys aren't counted.
    monkeypatch.setenv("LIMIT_JOURNEY", "12")
    monkeypatch.setenv("LIMIT_SITE_JOURNEY", "8")
    app = create_app(agent_client=Scripted(finisher))
    app.config["JOURNEYS"].start_group = lambda *a, **k: {"id": "x", "members": []}
    c = app.test_client()
    for ip in ("1.1.1.1", "2.2.2.2"):
        assert c.post("/api/run", json={"url": "https://8.8.8.8", "goal": "g"}, environ_base={"REMOTE_ADDR": ip}).status_code == 200
    r = c.post("/api/run", json={"url": "https://8.8.8.8", "goal": "g"}, environ_base={"REMOTE_ADDR": "3.3.3.3"})
    assert r.status_code == 429 and "for everyone" in r.json["error"]
    assert c.get("/api/health", environ_base={"REMOTE_ADDR": "3.3.3.3"}).json["remaining"]["journey"] == 0
    r = c.post("/api/run", json={"url": "https://8.8.8.8", "goal": "g"}, environ_base={"REMOTE_ADDR": "3.3.3.3"},
               headers={"X-Anthropic-Key": "sk-ant-" + "x" * 40})
    assert r.status_code == 200
