"""Persona Lab's own accessibility, checked in a real browser against the built frontend (web/out).

axe-core only catches part of WCAG, so this also covers what it can't: keyboard order and visible focus,
focus hidden under the sticky header, reflow at 320px (= 400% zoom), target size, text spacing,
reduced motion and pausable motion. Needs `cd web && npm install && npm run build`; skipped otherwise.
"""
import shutil
import threading
from pathlib import Path

import pytest
from werkzeug.serving import make_server

from personalab.evals import serve_sites
from personalab.replay import save as save_replay
from personalab.server import create_app
from tests.helpers import HAVE_BROWSER, Scripted, tool

ROOT = Path(__file__).resolve().parent.parent
WEB_OUT = ROOT / "web" / "out"
AXE = ROOT / "web" / "node_modules" / "axe-core" / "axe.min.js"

pytestmark = pytest.mark.skipif(not (HAVE_BROWSER and (WEB_OUT / "index.html").exists() and AXE.exists()),
                                reason="needs Playwright Chromium and a built frontend (cd web && npm install && npm run build)")

WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]


def script(persona, n, seen, kw):
    if n == 0:
        return [tool("report_barrier", title="Book button can't be reached", detail="A div with a click handler.", severity="blocker", fix="Use a button.")]
    return [tool("finish", success=persona != "keyboard", summary="Done", worked=["Headings were clear"])]


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    web = tmp_path_factory.mktemp("web") / "out"
    shutil.copytree(WEB_OUT, web, ignore=shutil.ignore_patterns("replays"))
    app = create_app(agent_client=Scripted(script), web_dir=web)
    app.config["SYNC"] = True
    client = app.test_client()
    with serve_sites() as bench:
        gid = client.post("/api/run", json={"url": f"{bench}/hotel/index.html", "goal": "Book a room"}).json["id"]
    save_replay(gid, "demo", lambda path: client.get(path).data, web / "replays")
    srv = make_server("127.0.0.1", 0, app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", gid
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def pages(gid):
    return ["/", "/history", "/evals", f"/run?id={gid}", "/replay", "/replay?id=demo", "/compare?a=demo&b=demo", "/accessibility", "/no-such-page"]


def open_page(browser, url, width=1280, scheme="light", motion="reduce"):
    ctx = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme, reduced_motion=motion)
    page = ctx.new_page()
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(300)
    return ctx, page


def axe(page):
    page.add_script_tag(path=str(AXE))
    res = page.evaluate("t => axe.run(document, {runOnly: {type: 'tag', values: t}})", WCAG_TAGS)
    return [f"{v['id']}: {v['help']} -> {[n['target'] for n in v['nodes'][:3]]}" for v in res["violations"]]


@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("width", [1280, 320])
def test_axe_clean_and_reflows(site, browser, scheme, width):
    base, gid = site
    problems = {}
    for path in pages(gid):
        ctx, page = open_page(browser, base + path, width, scheme)
        found = axe(page)
        if page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"):
            found.append(f"page scrolls sideways at {width}px")
        if found:
            problems[path] = found
        ctx.close()
    assert not problems, problems


def test_keyboard_order_and_visible_focus(site, browser):
    """Tab through each page: every stop must show a focus indicator, sit in the viewport and not be
    hidden under the sticky header (WCAG 2.4.7, 2.4.11). The first stop is the skip link and it works."""
    base, gid = site
    problems = []
    for path in ["/", "/history", "/evals", f"/run?id={gid}", "/replay?id=demo", "/compare?a=demo&b=demo"]:
        ctx, page = open_page(browser, base + path)
        page.keyboard.press("Tab")
        assert page.evaluate("document.activeElement.textContent.trim()") == "Skip to content", path
        page.keyboard.press("Enter")
        assert page.evaluate("document.activeElement.closest('main') !== null || location.hash === '#main'"), path
        page.goto(base + path, wait_until="networkidle")
        stops = 0
        for i in range(80):
            page.keyboard.press("Tab")
            info = page.evaluate("""() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                const cs = getComputedStyle(el), r = el.getBoundingClientRect();
                const header = document.querySelector('header');
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 8));
                if (el.dataset.tabbed) return {again: true};
                el.dataset.tabbed = '1';
                return {
                  id: el.outerHTML.slice(0, 90),
                  ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none',
                  onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
                  underHeader: !!(hit && header && !el.contains(hit) && !el.closest('header') && header.contains(hit)),
                };
            }""")
            if info is None or info.get("again"):
                break
            stops += 1
            for k, msg in (("ring", "no visible focus"), ("onScreen", "focused off screen")):
                if not info[k]:
                    problems.append(f"{path}: {msg}: {info['id']}")
            if info["underHeader"]:
                problems.append(f"{path}: focus hidden under sticky header: {info['id']}")
        assert stops > 5, f"{path}: too few tab stops ({stops})"
        ctx.close()
    assert not problems, problems


def test_target_size(site, browser):
    """WCAG 2.5.8: controls are at least 24x24 CSS px (links inside running text are exempt)."""
    base, gid = site
    small = []
    for path in pages(gid):
        ctx, page = open_page(browser, base + path, width=390)
        small += [f"{path}: {s}" for s in page.evaluate("""() => [...document.querySelectorAll(
              'button, a[href], input, select, summary, [role=button], [tabindex="0"]')]
            .filter(el => !el.closest('p, li > span, td, th, .sr-only') && getComputedStyle(el).visibility !== 'hidden')
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24) && !el.matches('.sr-only, [href="#main"]'); })
            .map(el => el.outerHTML.slice(0, 100))""")]
        ctx.close()
    assert not small, small


def test_text_spacing_does_not_clip(site, browser):
    """WCAG 1.4.12: with the text-spacing overrides applied, no text is cut off or overflows the page."""
    base, gid = site
    problems = []
    for path in ["/", f"/run?id={gid}", "/replay?id=demo", "/history", "/evals"]:
        ctx, page = open_page(browser, base + path, width=390)
        page.add_style_tag(content="* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }"
                                   " p { margin-bottom: 2em !important; }")
        page.wait_for_timeout(100)
        clipped = page.evaluate("""() => [...document.querySelectorAll('main *, header *')].filter(el => {
              const cs = getComputedStyle(el);
              if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
              const hidden = ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY);
              return hidden && cs.webkitLineClamp === 'none' && !el.closest('.sr-only, [aria-hidden=true]')
                && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
            }).map(el => el.outerHTML.slice(0, 100))""")
        if page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"):
            clipped.append("page scrolls sideways")
        problems += [f"{path}: {c}" for c in clipped]
        ctx.close()
    assert not problems, problems


def test_reduced_motion_stops_everything(site, browser):
    base, gid = site
    for path in ["/", f"/run?id={gid}", "/replay?id=demo"]:
        ctx, page = open_page(browser, base + path, motion="reduce")
        running = page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length")
        hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity !== '1').length")
        assert running == 0 and hidden == 0, (path, running, hidden)
        if "replay" in path:  # a replay waits for Play instead of starting on its own
            assert page.get_by_role("button", name="Play").is_visible()
        ctx.close()


def test_moving_content_can_be_paused(site, browser):
    """WCAG 2.2.2: anything that keeps moving for more than 5 seconds has a pause control."""
    base, _ = site
    ctx, page = open_page(browser, base + "/", motion="no-preference")
    page.wait_for_timeout(6000)
    endless = page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running')
        .map(a => a.effect.target.closest('[data-pausable]') ? 'pausable' : a.effect.target.outerHTML.slice(0, 100))""")
    assert set(endless) <= {"pausable"}, endless
    page.get_by_role("button", name="Pause the scrolling banner").click()
    assert page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length") == 0
    ctx.close()


def test_replay_plays_to_the_real_result(site, browser):
    base, _ = site
    ctx, page = open_page(browser, base + "/replay?id=demo")
    assert "trying to book a room" in page.inner_text("main")
    page.get_by_role("button", name="Play").click()
    page.get_by_role("button", name="4× speed").click()
    assert page.get_by_role("button", name="4× speed").get_attribute("aria-pressed") == "true"
    page.get_by_role("button", name="Skip to result").click()
    text = page.inner_text("main")
    assert "3 of 4" in text and "Stuck: keyboard-only user" in text and "Book button can't be reached" in text
    assert page.get_by_role("button", name="Replay").is_visible()
    assert page.get_by_role("link", name="Download").count() == 0 and page.get_by_role("button", name="Download").count() == 0
    ctx.close()


def test_form_errors_are_announced_and_linked(site, browser):
    """WCAG 3.3.1 / 4.1.3: an empty submit moves focus to the field, marks it invalid and ties the message to it."""
    base, _ = site
    ctx, page = open_page(browser, base + "/")
    page.get_by_role("button", name="Run test").click()
    state = page.evaluate("""() => { const el = document.activeElement, d = el.getAttribute('aria-describedby');
        return { label: el.labels?.[0]?.textContent, invalid: el.getAttribute('aria-invalid'),
                 described: d ? document.getElementById(d)?.textContent : null }; }""")
    assert state["label"].startswith("Website") and state["invalid"] == "true" and "website" in (state["described"] or "").lower(), state
    ctx.close()
