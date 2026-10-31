"""Website accessibility checker.

1. Playwright opens the URL in headless Chromium and takes a screenshot.
2. axe-core (the industry-standard WCAG engine) runs inside the page.
   It is downloaded once to personalab/vendor/axe.min.js. If that's not possible,
   a smaller set of built-in checks (page_scan.js) is used instead.
3. Personal checks re-test the page *as this user sees it*, using their
   vision profile (e.g. text that passes WCAG but fails after a red-green
   color-blindness simulation).
"""

from __future__ import annotations

import io
import os
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import colorlab as cl
from .guard import check_url, install_route_guard

HERE = Path(__file__).resolve().parent
AXE_PATH = HERE / "vendor" / "axe.min.js"
AXE_VERSION = "4.10.2"
AXE_URLS = [
    f"https://cdn.jsdelivr.net/npm/axe-core@{AXE_VERSION}/axe.min.js",
    f"https://unpkg.com/axe-core@{AXE_VERSION}/axe.min.js",
]
PAGE_SCAN_JS = (HERE / "page_scan.js").read_text()

VIEWPORT = {"width": 1280, "height": 900}
MAX_SHOT_HEIGHT = 5000
NAV_TIMEOUT_MS = 30000
IMPACT_ORDER = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
IMPACT_WEIGHT = {"critical": 12, "serious": 7, "moderate": 3, "minor": 1}

# Plain-language fixes for the most common rules. Anything else falls back to axe's own help text.
FIXES = {
    "color-contrast": "Darken the text or lighten the background (or the reverse) until the ratio is at least 4.5:1, or 3:1 for large text. A suggested color is shown for each element.",
    "image-alt": "Add alt text that says what the image shows or does. Use alt=\"\" only for purely decorative images.",
    "button-name": "Give icon-only buttons a name, e.g. <button aria-label=\"Close\">.",
    "link-name": "Put readable text inside the link, or add aria-label describing where it goes.",
    "label": "Add a <label for=\"fieldId\"> for each field (placeholders disappear and aren't read reliably).",
    "select-name": "Add a <label> for the dropdown.",
    "html-has-lang": "Add the page language: <html lang=\"en\">.",
    "html-lang-valid": "Use a valid language code in <html lang>, e.g. \"en\" or \"ar\".",
    "document-title": "Add a descriptive <title> to the page.",
    "heading-order": "Don't skip heading levels (h2 → h4). Use CSS for size, and headings for structure.",
    "page-has-heading-one": "Add one <h1> describing the page.",
    "link-in-text-block": "Underline links inside text (or add another non-color cue), so they don't depend on color alone.",
    "region": "Put all content inside landmarks: <header>, <nav>, <main>, <footer>.",
    "landmark-one-main": "Wrap the main content in a single <main> element.",
    "meta-viewport": "Don't disable zoom: remove user-scalable=no and maximum-scale=1 from the viewport meta tag.",
    "aria-hidden-focus": "Elements inside aria-hidden=\"true\" must not be focusable; add tabindex=\"-1\" or remove aria-hidden.",
    "list": "Only <li> elements should be direct children of <ul>/<ol>.",
    "listitem": "<li> must be inside a <ul> or <ol>.",
    "duplicate-id-aria": "IDs referenced by ARIA attributes must be unique.",
    "frame-title": "Give each <iframe> a title describing its content.",
    "svg-img-alt": "Give meaningful SVG images a <title> or aria-label.",
    "nested-interactive": "Don't put buttons or links inside other buttons or links.",
    "scrollable-region-focusable": "Make scrollable areas keyboard reachable with tabindex=\"0\".",
    "target-size": "Make touch targets at least 24×24 px.",
}


# --------------------------------------------------------------------------
# axe-core


def load_axe() -> str | None:
    if os.environ.get("PERSONALAB_DISABLE_AXE"):
        return None
    if AXE_PATH.exists() and AXE_PATH.stat().st_size > 100_000:
        return AXE_PATH.read_text(encoding="utf-8")
    for url in AXE_URLS:
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310 (fixed https URLs)
                src = resp.read().decode("utf-8")
            if "axe" in src[:2000] and len(src) > 100_000:
                AXE_PATH.parent.mkdir(parents=True, exist_ok=True)
                AXE_PATH.write_text(src, encoding="utf-8")
                return src
        except Exception:
            continue
    return None


AXE_RUN_JS = """async () => {
  const r = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    resultTypes: ['violations'],
  });
  return {
    version: axe.version,
    violations: r.violations.map(v => ({
      id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl, tags: v.tags,
      total: v.nodes.length,
      nodes: v.nodes.slice(0, 25).map(n => ({
        target: n.target, html: n.html, failureSummary: n.failureSummary,
        data: (n.any && n.any[0] && n.any[0].data) || null,
      })),
    })),
  };
}"""

RECTS_JS = """(selectors) => selectors.map(sel => {
  try {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  } catch (e) { return null; }
})"""


def _flatten_target(target) -> str:
    if isinstance(target, list):
        return " >>> ".join(_flatten_target(t) for t in target)
    return str(target)


# --------------------------------------------------------------------------
# URL handling


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        raise ValueError("Enter a website address.")
    has_scheme = re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)", url)  # "localhost:3000" has no scheme
    if has_scheme and not re.match(r"^https?://", url, re.I):
        raise ValueError("Only http:// and https:// addresses can be checked.")
    if not has_scheme:
        local = re.match(r"^(localhost|127\.|0\.0\.0\.0|\[::1\])", url)
        url = ("http://" if local else "https://") + url
    if not re.match(r"^https?://", url, re.I):
        raise ValueError("Only http:// and https:// addresses can be checked.")
    if re.match(r"^https?://[^/]*@", url):
        raise ValueError("Addresses with embedded usernames/passwords aren't supported.")
    return url


# --------------------------------------------------------------------------
# main entry


def check_site(url: str, profile: dict, browser_factory=None) -> tuple[dict, Image.Image]:
    """Returns (report, screenshot image)."""
    url = normalize_url(url)
    check_url(url)
    axe_src = load_axe()

    from playwright.sync_api import Error as PWError
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = browser_factory(pw) if browser_factory else pw.chromium.launch()
        try:
            ctx = browser.new_context(viewport=VIEWPORT, bypass_csp=True, device_scale_factor=1)
            install_route_guard(ctx)
            page = ctx.new_page()
            try:
                resp = page.goto(url, wait_until="load", timeout=NAV_TIMEOUT_MS)
            except PWError as exc:
                raise ValueError(f"Couldn't open {url}: {str(exc).splitlines()[0]}") from exc
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except PWError:
                pass  # busy pages never go idle; that's fine
            status = resp.status if resp else None

            scan = page.evaluate(PAGE_SCAN_JS)

            engine = "built-in checks"
            violations = scan["builtin_violations"]
            if axe_src:
                try:
                    page.add_script_tag(content=axe_src)
                    ax = page.evaluate(AXE_RUN_JS)
                    for v in ax["violations"]:
                        for n in v["nodes"]:
                            n["target"] = [_flatten_target(n["target"])]
                        rects = page.evaluate(RECTS_JS, [n["target"][0] for n in v["nodes"]])
                        for n, r in zip(v["nodes"], rects):
                            n["rect"] = r
                    violations = ax["violations"]
                    engine = f"axe-core {ax.get('version', AXE_VERSION)}"
                except PWError:
                    pass  # fall back to built-in results

            page_h = min(int(scan.get("page_height") or VIEWPORT["height"]), MAX_SHOT_HEIGHT)
            png = page.screenshot(
                full_page=True, clip={"x": 0, "y": 0, "width": VIEWPORT["width"], "height": max(page_h, 1)}
            )
            final_url = page.url
        finally:
            browser.close()

    shot = Image.open(io.BytesIO(png)).convert("RGB")
    report = build_report(url, final_url, status, scan, violations, engine, shot, profile)
    return report, shot


# --------------------------------------------------------------------------
# report building (pure python; unit-testable without a browser)


def _rect_pct(rect, size) -> dict | None:
    if not rect:
        return None
    if rect["w"] >= 0.95 * size[0] and rect["h"] >= 0.9 * size[1]:
        return None  # whole-page element: nothing useful to highlight
    w, h = size
    if rect["y"] >= h or rect["w"] <= 0 or rect["h"] <= 0:
        return None
    return {
        "x": round(100 * rect["x"] / w, 3),
        "y": round(100 * rect["y"] / h, 3),
        "w": round(100 * min(rect["w"], w - rect["x"]) / w, 3),
        "h": round(100 * min(rect["h"], h - rect["y"]) / h, 3),
    }


def _contrast_suggestion(data: dict | None) -> dict | None:
    if not data or not data.get("fgColor") or not data.get("bgColor"):
        return None
    try:
        target = float(str(data.get("expectedContrastRatio", "4.5")).split(":")[0])
        fixed = cl.suggest_accessible_color(data["fgColor"], data["bgColor"], target)
    except (ValueError, TypeError):
        return None
    if not fixed:
        return None
    return {
        "foreground": data["fgColor"],
        "background": data["bgColor"],
        "ratio": data.get("contrastRatio"),
        "needs": data.get("expectedContrastRatio"),
        "suggested_foreground": fixed,
        "suggested_ratio": cl.contrast_ratio(fixed, data["bgColor"])["ratio"],
    }


def build_report(url, final_url, status, scan, violations, engine, shot: Image.Image, profile: dict) -> dict:
    size = shot.size
    issues = []
    for v in violations:
        impact = v.get("impact") or "minor"
        nodes = []
        for n in v.get("nodes", []):
            node = {
                "selector": (n.get("target") or [""])[0],
                "html": (n.get("html") or "")[:300],
                "summary": (n.get("failureSummary") or "").strip(),
                "rect_pct": _rect_pct(n.get("rect"), size),
            }
            if v["id"] == "color-contrast":
                node["suggestion"] = _contrast_suggestion(n.get("data"))
            nodes.append(node)
        issues.append(
            {
                "id": v["id"],
                "impact": impact,
                "help": v.get("help", v["id"]),
                "description": v.get("description", ""),
                "help_url": v.get("helpUrl", ""),
                "fix": FIXES.get(v["id"], v.get("help", "")),
                "count": int(v.get("total") or len(nodes)),
                "nodes": nodes,
            }
        )
    issues.sort(key=lambda i: (IMPACT_ORDER.get(i["impact"], 9), -i["count"]))

    summary = {k: sum(1 for i in issues if i["impact"] == k) for k in IMPACT_ORDER}
    summary["total_issues"] = len(issues)
    summary["elements_affected"] = sum(i["count"] for i in issues)
    penalty = sum(IMPACT_WEIGHT.get(i["impact"], 1) + min(i["count"], 20) * 0.25 for i in issues)
    score = max(0, round(100 - penalty))
    grade = "Good" if score >= 90 else "Needs work" if score >= 70 else "Poor" if score >= 40 else "Very poor"

    return {
        "url": url,
        "final_url": final_url,
        "http_status": status,
        "title": scan.get("title", ""),
        "engine": engine,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "screenshot": {"width": size[0], "height": size[1], "truncated": (scan.get("page_height") or 0) > size[1]},
        "score": score,
        "grade": grade,
        "summary": summary,
        "issues": issues,
        "personal": personal_checks(scan, issues, shot, profile),
        "page_counts": scan.get("counts", {}),
    }


def personal_checks(scan: dict, issues: list[dict], shot: Image.Image, profile: dict) -> dict:
    cvd = profile.get("cvd_type", "none") or "none"
    sev = float(profile.get("severity", 1.0))
    size = shot.size
    items = []

    texts = scan.get("texts", [])
    if cvd != "none":
        hidden = []
        for t in texts:
            need = 3.0 if t.get("large") else 4.5
            try:
                fg_y = cl.rgb01_to_hex(cl.simulate(cl.hex_to_rgb01(t["fg"]), cvd, sev))
                bg_y = cl.rgb01_to_hex(cl.simulate(cl.hex_to_rgb01(t["bg"]), cvd, sev))
            except ValueError:
                continue
            yours = cl.contrast_ratio(fg_y, bg_y)["ratio"]
            if t["ratio"] >= need > yours:
                hidden.append({
                    "selector": t["selector"], "text": t["text"], "html": t.get("html", ""),
                    "summary": f"Contrast {t['ratio']}:1 for most people, about {yours}:1 for you. "
                               f"{cl.name_color(t['fg'])['name']} text on {cl.name_color(t['bg'])['name']}.",
                    "rect_pct": _rect_pct(t.get("rect"), size),
                })
        if hidden:
            items.append({
                "kind": "contrast-for-you", "severity": "serious",
                "title": f"{len(hidden)} text element(s) pass WCAG but are hard for you to read",
                "detail": "These meet the standard for typical vision, but lose contrast with your color vision.",
                "nodes": hidden[:25],
            })

        palette = cl.key_colors(shot, k=10)
        pairs = cl.find_confusable_pairs([c["hex"] for c in palette], cvd, sev)
        if pairs:
            items.append({
                "kind": "confusable-colors", "severity": "moderate",
                "title": f"{len(pairs)} color pair(s) on this page may look the same to you",
                "detail": "; ".join(f"{p['a']['name']} vs {p['b']['name']}" for p in pairs[:5])
                          + ". If the site uses these to mean different things (status, charts, tags), check the labels.",
                "pairs": pairs[:5],
            })

        color_only = next((i for i in issues if i["id"] == "link-in-text-block"), None)
        if color_only:
            items.append({
                "kind": "color-only-links", "severity": "serious",
                "title": "Some links are marked by color only, so you may not notice them",
                "detail": "They aren't underlined and differ from the surrounding text mainly by hue.",
                "nodes": color_only["nodes"],
            })

    if profile.get("light_sensitive"):
        arr = cl.image_to_array(shot.resize((max(1, size[0] // 8), max(1, size[1] // 8))))
        lum = cl.srgb_to_linear(arr) @ np.array([0.2126, 0.7152, 0.0722])
        bright = float((lum > 0.75).mean())
        if bright > 0.6:
            items.append({
                "kind": "bright-page", "severity": "moderate",
                "title": f"Mostly bright background ({round(bright * 100)}% of the page)",
                "detail": "This may be uncomfortable for you. Look for a dark mode, or use the 'Fixed for you' view with glare softening on.",
            })

    if float(profile.get("contrast_boost", 0)) >= 0.3 or profile.get("preferred_text_size") in ("large", "extra-large"):
        low = [t for t in texts if t["ratio"] < 7 and not t.get("large")]
        small = [t for t in texts if t.get("font_size_px", 16) < 14]
        if low:
            items.append({
                "kind": "below-aaa", "severity": "moderate",
                "title": f"{len(low)} text element(s) below enhanced contrast (7:1)",
                "detail": "You asked for extra contrast; these may still be hard to read.",
                "nodes": [{"selector": t["selector"], "text": t["text"], "html": t.get("html", ""),
                           "summary": f"{t['ratio']}:1", "rect_pct": _rect_pct(t.get("rect"), size)} for t in low[:25]],
            })
        if small:
            items.append({
                "kind": "small-text", "severity": "minor",
                "title": f"{len(small)} text element(s) smaller than 14px",
                "detail": "Use browser zoom (Ctrl/Cmd +) on this site.",
                "nodes": [{"selector": t["selector"], "text": t["text"], "html": t.get("html", ""),
                           "summary": f"{t['font_size_px']}px", "rect_pct": _rect_pct(t.get("rect"), size)} for t in small[:25]],
            })

    if cvd == "none" and not items:
        note = "Set your color vision and needs in 'Your vision' to see problems specific to you."
    elif not items:
        note = "Nothing on this page stood out as a problem for your vision profile."
    else:
        note = ""
    return {"vision_type": cl.CVD_LABELS.get(cvd, cvd), "items": items, "note": note}


def report_for_agent(report: dict, max_issues: int = 15) -> dict:
    """A compact version of the report for Claude (keeps tokens down)."""
    return {
        "url": report["final_url"],
        "title": report["title"],
        "engine": report["engine"],
        "score": report["score"],
        "grade": report["grade"],
        "summary": report["summary"],
        "issues": [
            {
                "id": i["id"], "impact": i["impact"], "help": i["help"], "fix": i["fix"], "count": i["count"],
                "examples": [
                    {k: v for k, v in n.items() if k in ("selector", "html", "summary", "suggestion") and v}
                    for n in i["nodes"][:3]
                ],
            }
            for i in report["issues"][:max_issues]
        ],
        "personal": {
            "vision_type": report["personal"]["vision_type"],
            "note": report["personal"]["note"],
            "items": [
                {"title": it["title"], "detail": it["detail"],
                 "examples": [n.get("text") or n.get("selector") for n in it.get("nodes", [])[:3]]}
                for it in report["personal"]["items"]
            ],
        },
    }
