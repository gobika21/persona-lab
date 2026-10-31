"""Web API, public-mode safety and demo-site serving."""
import pytest

from personalab import guard
from personalab.evals import serve_sites
from personalab.server import create_app
from tests.helpers import HAVE_BROWSER, Scripted, tool


def finisher(persona, n, seen, kw):
    if n == 0:
        return [tool("report_barrier", title="Demo barrier", detail="d", severity="serious", fix="f")]
    return [tool("finish", success=persona != "keyboard", summary="done")]


def test_pages_and_meta(monkeypatch):
    monkeypatch.delenv("PUBLIC_MODE", raising=False)
    c = create_app().test_client()
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
    rep = c.get(f"/api/run/{g['id']}/report.html")
    assert rep.headers["Content-Disposition"].startswith("attachment") and "3 of 4 people" in rep.get_data(as_text=True)
    j = c.get(f"/api/journey/{g['journeys'][0]}").json
    assert j["usage"]["llm_calls"] == 2


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
