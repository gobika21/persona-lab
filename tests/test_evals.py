"""The evaluation harness: matching, scoring, a scripted agent run and the rules baseline."""
import pytest

from personalab import evals
from tests.helpers import HAVE_BROWSER, Scripted, ref_for, text, tool

BENCH = evals.load_benchmark()
B = {b["id"]: b for b in BENCH["barriers"]}


def test_benchmark_is_consistent():
    sites = {t["site"] for t in BENCH["tasks"]}
    assert {b["site"] for b in BENCH["barriers"]} <= sites
    for t in BENCH["tasks"]:
        assert set(t["possible"]) == set(BENCH["personas"])
    for b in BENCH["barriers"]:
        assert set(b["personas"]) <= set(BENCH["personas"]) and b["anchors"] and b["kinds"]


def test_matcher_needs_element_and_problem_kind():
    assert evals.matches({"title": "'Book a room' can't be reached with Tab", "detail": ""}, B["hotel-book-div"])
    assert not evals.matches({"title": "Book a room looks great", "detail": ""}, B["hotel-book-div"])
    assert not evals.matches({"title": "Keyboard trap in footer", "detail": ""}, B["hotel-book-div"])
    ids = evals.match_findings([{"title": "Mug variants differ only by color", "detail": ""}, {"title": "Nice site", "detail": ""}],
                               [b for b in BENCH["barriers"] if b["site"] == "shop"])
    assert ids == ["shop-color-only-variants", None]


def test_verified_success_checks():
    t_url = next(t for t in BENCH["tasks"] if t["id"] == "hotel-book")
    t_ans = next(t for t in BENCH["tasks"] if t["id"] == "library-hours")
    assert evals.verified(t_url, {"visited": ["http://x/hotel/contact.html?booking=1"]})
    assert not evals.verified(t_url, {"visited": ["http://x/hotel/index.html"]})
    assert evals.verified(t_ans, {"success": True, "summary": "It opens at 10:00 on Saturday."})
    assert not evals.verified(t_ans, {"success": True, "summary": "It opens at 8:00."})


def test_score_counts_false_success_and_recall():
    rows = [
        {"task": "hotel-book", "persona": "keyboard", "possible": False, "claimed": True, "verified": False, "steps": 3, "seconds": 1,
         "findings": [{"title": "x", "matched": "hotel-book-div"}, {"title": "y", "matched": None}]},
        {"task": "hotel-book", "persona": "screen_reader", "possible": True, "claimed": True, "verified": True, "steps": 3, "seconds": 1,
         "findings": []},
    ]
    s = evals.score(BENCH, rows)
    m = s["metrics"]
    assert m["outcome_accuracy"] == 0.5 and m["false_success_rate"] == 0.5 and m["precision"] == 0.5
    assert m["barrier_recall"] == round(1 / len(BENCH["barriers"]), 3)
    assert s["per_persona"]["keyboard"]["recall"] > 0
    assert next(b for b in s["barriers"] if b["id"] == "hotel-book-div")["detected_by"] == ["keyboard"]


def _script(persona, n, seen, kw):
    hotel = "Book a room" in kw["system"]
    if persona == "keyboard":
        return [[tool("press_key", key="Tab", times=4)],
                [tool("finish", success=not hotel, summary="Opens at 10:00 on Saturday" if not hotel else "Can't reach the Book button")]][min(n, 1)]
    if persona == "screen_reader":
        if n == 0:
            return [tool("read_page")]
        if hotel and n == 1:
            return [tool("activate", ref=ref_for(seen, "clickable: Book a room"))]
        return [tool("finish", success=True, summary="Saturday: 10:00 – 18:00" if not hotel else "Booking started")]
    if hotel and persona == "low_vision" and n == 0:  # at 200% zoom the button is below the fold
        return [text("Zoomed in, I need to scroll."), tool("scroll", direction="down")]
    if hotel and n == (1 if persona == "low_vision" else 0):
        return [text("I see the button."), tool("click", ref=ref_for(seen, "Book a room"))]
    return [tool("finish", success=True, summary="Saturday 10:00 – 18:00" if not hotel else "Booking started")]


@pytest.mark.skipif(not HAVE_BROWSER, reason="Playwright Chromium not installed")
def test_scripted_agent_run_end_to_end():
    r = evals.run_agents(Scripted(_script), "fake-model", "test", task_ids=["hotel-book", "library-hours"], concurrency=4,
                         save=False, progress=lambda *_: None)
    m = r["metrics"]
    assert m["journeys"] == 8 and m["errors"] == 0
    assert m["outcome_accuracy"] == 1.0 and m["false_success_rate"] == 0.0 and m["verified_success_rate"] == 1.0
    found = {b["id"] for b in r["barriers"] if b["detected"]}
    assert {"hotel-book-div", "hotel-focus-hidden", "hotel-img-alt", "hotel-send-unnamed", "hotel-email-unlabeled"} <= found
    assert m["precision"] >= 0.8  # the accessible library site produced no false alarms
    lib = [j for j in r["journeys"] if j["task"] == "library-hours"]
    assert all(not j["findings"] for j in lib if j["persona"] != "keyboard") 
    assert m["input_tokens"] > 0


@pytest.mark.skipif(not HAVE_BROWSER, reason="Playwright Chromium not installed")
def test_rules_baseline_finds_only_page_level_barriers(monkeypatch):
    monkeypatch.setenv("PERSONALAB_DISABLE_AXE", "1")
    r = evals.run_baseline(save=False, progress=lambda *_: None)
    found = {b["id"] for b in r["barriers"] if b["detected"]}
    assert {"hotel-img-alt", "hotel-send-unnamed", "shop-cart-unnamed"} <= found
    # experience-level barriers are invisible to page rules
    assert not found & {"hotel-book-div", "shop-color-only-variants", "clinic-datepicker-mouse-only"}
    assert r["metrics"]["precision"] == 1.0


def test_cost_uses_known_prices_or_env(monkeypatch):
    from personalab.pricing import cost_usd
    for k in ("PRICE_INPUT_PER_MTOK", "PRICE_OUTPUT_PER_MTOK", "PRICE_CACHE_READ_PER_MTOK", "PRICE_CACHE_WRITE_PER_MTOK"):
        monkeypatch.delenv(k, raising=False)
    # Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per million tokens
    assert cost_usd("claude-opus-5-5", 1_000_000, 100_000, 1_000_000, 100_000) == 4 + 2 + 0.2 + 0.5
    assert cost_usd("some-unknown-model", 1000, 1000) is None
    monkeypatch.setenv("PRICE_INPUT_PER_MTOK", "1")
    monkeypatch.setenv("PRICE_OUTPUT_PER_MTOK", "2")
    assert cost_usd("some-unknown-model", 1_000_000, 1_000_000, 1_000_000) == 1 + 2 + 0.1
