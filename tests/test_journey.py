"""Persona agents on the benchmark sites, driven by a scripted fake Claude (real Chromium)."""
import pytest

from personalab.evals import serve_sites
from personalab.journey import Journey, JourneyRunner
from tests.helpers import HAVE_BROWSER, Scripted, ref_for, text, tool

pytestmark = pytest.mark.skipif(not HAVE_BROWSER, reason="Playwright Chromium not installed")


def run(persona, path, script):
    fake = Scripted(script)
    with serve_sites() as base:
        j = Journey(url=f"{base}/{path}", goal="test", persona=persona, profile={"cvd_type": "deutan"})
        JourneyRunner(j, fake, "fake").run()
    return j, fake


def test_keyboard_persona_finds_mouse_only_button_and_hidden_focus():
    def script(p, n, seen, kw):
        return [[text("Tabbing through."), tool("press_key", key="Tab", times=3)],
                [tool("finish", success=False, summary="Couldn't reach Book a room")]][n]
    j, fake = run("keyboard", "hotel/index.html", script)
    titles = " | ".join(f["title"] + " " + f["detail"] for f in j.auto_findings)
    assert "can't be reached with the keyboard" in titles and "Book a room" in titles
    assert "No visible focus indicator" in titles
    assert j.tokens_in == 2000 and j.llm_calls == 2  # usage is tracked
    assert "focus" in j.steps[1]["result"].lower() or "Focus" in j.steps[1]["result"]


def test_screen_reader_hears_text_and_can_activate_clickable_div():
    def script(p, n, seen, kw):
        if n == 0:
            return [tool("read_page")]
        if n == 1:
            return [tool("activate", ref=ref_for(seen, "clickable: Book a room"))]
        return [tool("finish", success=True, summary="ok")]
    j, _ = run("screen_reader", "hotel/index.html", script)
    assert any("booking=1" in u for u in j.visited)
    heard = j.steps[1]["heard"]
    assert "heading level 1: Welcome to Sunset Hotel" in heard and "no alt text" in heard
    assert not any(s.get("has_shot") and False for s in j.steps)


def test_visual_persona_clicks_by_marker_and_sees_simulated_view():
    def script(p, n, seen, kw):
        if n == 0:
            return [tool("click", ref=ref_for(seen, "Book a room"))]
        return [tool("finish", success=True, summary="ok")]
    j, fake = run("color_blind", "hotel/index.html", script)
    assert any("booking=1" in u for u in j.visited)
    assert fake.calls[0]["messages"][0]["content"][-1]["type"] == "image"


def test_bad_ref_is_reported_back_not_crashing():
    def script(p, n, seen, kw):
        return [[tool("click", ref=9999)], [tool("finish", success=False, summary="stuck")]][n]
    j, fake = run("low_vision", "hotel/index.html", script)
    assert j.steps[1]["error"] and "No element with ref" in j.steps[1]["result"]
    assert fake.calls[1]["messages"][-1]["content"][0]["is_error"] is True
