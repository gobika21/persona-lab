"""Persona Journey: an AI agent tries to complete a real task on a website
*as a specific person would*, and reports where they get stuck.

Each persona only gets the senses and controls that person has:

- keyboard     : Tab / Enter / arrows only, no mouse. Told where focus is, sees the real page.
- screen_reader: never sees the page. Gets the linear text a screen reader would read.
- color_blind  : sees a color-vision-simulated screenshot, can click and type.
- low_vision   : page zoomed to 200%, blurred and lower contrast; can click and type.

Runs in a background thread; the UI polls for steps as they happen.
"""

from __future__ import annotations

import base64
import io
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from . import colorlab as cl
from .guard import Busy, BusyError, check_url, install_route_guard
from .sitecheck import normalize_url

HERE = Path(__file__).resolve().parent
HELPER_JS = (HERE / "journey_helper.js").read_text()

DEFAULT_MODEL = "claude-opus-5-5"  # override with CLAUDE_MODEL
MAX_ACTIONS = 30
MAX_TOKENS = 16000  # current models always think, and thinking counts toward this

# Effort trades depth for token spend; set it explicitly (Opus 5.5 defaults to medium) and record it with eval runs.
EFFORT = os.environ.get("CLAUDE_EFFORT", "medium")

# History is append-only: the API's preserved-thinking check rejects edited earlier turns (new accounts),
# and edits also break the prompt cache. Old tool results (screenshots, page text) are cleared server-side instead.
CONTEXT_BETA = "context-management-2025-06-27"
CLEAR_OLD_RESULTS = {
    "type": "clear_tool_uses_20250919",
    "trigger": {"type": "input_tokens", "value": 30_000},
    "keep": {"type": "tool_uses", "value": 3},
    "clear_at_least": {"type": "input_tokens", "value": 5_000},  # don't break the cache for a tiny saving
    "exclude_tools": ["report_barrier", "finish"],
}

# On a safety-filter refusal, these models can re-run the request on a fallback model server-side.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
NAV_TIMEOUT_MS = 30000
SR_PAGE_LINES = 70

PERSONAS: dict[str, dict] = {
    "keyboard": {
        "label": "Keyboard-only user",
        "who": "People who can't use a mouse: motor disabilities, tremors, RSI, many blind users, power users.",
        "brief": (
            "You use only the keyboard (Tab, Shift+Tab, Enter, Space, arrow keys, Escape). You cannot click or hover. "
            "After each key press you're told which element has focus and whether a visible focus indicator was detected. "
            "You also see a screenshot of the screen, exactly as the site shows it."
        ),
        "viewport": {"width": 1280, "height": 800},
        "dsf": 1,
    },
    "screen_reader": {
        "label": "Blind screen-reader user",
        "who": "Blind and some low-vision people using screen readers like NVDA, JAWS or VoiceOver.",
        "brief": (
            "You are blind and use a screen reader. You never see the page. You read it as a linear list of lines "
            "(headings, links, buttons, form fields, text). You can jump through it, search it, activate links/buttons "
            "and type into fields using their [ref] numbers, and press keys."
        ),
        "viewport": {"width": 1280, "height": 800},
        "dsf": 1,
    },
    "color_blind": {
        "label": "Color-blind user",
        "who": "About 1 in 12 men and 1 in 200 women have a color-vision deficiency.",
        "brief": (
            "You have a color-vision deficiency. You see the page through a simulation of your color vision, "
            "with numbered markers on things you can click. Don't trust colors you can't tell apart."
        ),
        "viewport": {"width": 1280, "height": 800},
        "dsf": 1,
    },
    "low_vision": {
        "label": "Low-vision user (200% zoom)",
        "who": "People with low vision often zoom to 200% or more and still see a blurry, lower-contrast page.",
        "brief": (
            "You have low vision. You zoom the browser to 200%, and the page still looks blurry with weak contrast. "
            "Small or low-contrast text may be unreadable to you; say so instead of guessing. Numbered markers show "
            "things you can click."
        ),
        "viewport": {"width": 640, "height": 400},  # 200% zoom of a 1280x800 window
        "dsf": 2,
    },
}

KEYS = ["Tab", "Shift+Tab", "Enter", "Space", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageDown", "PageUp"]

COMMON_TOOLS = [
    {
        "name": "report_barrier",
        "description": "Record an accessibility barrier you just hit, in plain words, as this persona experiences it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short, e.g. 'Search button can't be reached with Tab'"},
                "detail": {"type": "string", "description": "What happened and why it blocks this person."},
                "severity": {"type": "string", "enum": ["blocker", "serious", "minor"]},
                "wcag": {"type": "string", "description": "Related WCAG criterion if you know it, e.g. '2.1.1 Keyboard'"},
                "fix": {"type": "string", "description": "Concrete fix for the site's developers."},
            },
            "required": ["title", "detail", "severity"],
        },
    },
    {
        "name": "finish",
        "description": "End the journey: say whether you completed the goal, summarise the experience, and list what worked well.",
        "input_schema": {
            "type": "object",
            "properties": {
                "success": {"type": "boolean"},
                "summary": {"type": "string"},
                "worked": {
                    "type": "array", "items": {"type": "string"}, "maxItems": 5,
                    "description": "Short notes on what worked well for this persona, e.g. 'Skip link went straight to the content'. Empty if nothing did.",
                },
            },
            "required": ["success", "summary"],
        },
    },
]

PRESS_KEY = {
    "name": "press_key",
    "description": "Press a key, optionally several times. Returns where focus moved after each press.",
    "input_schema": {
        "type": "object",
        "properties": {"key": {"type": "string", "enum": KEYS}, "times": {"type": "integer", "minimum": 1, "maximum": 15}},
        "required": ["key"],
    },
}
TYPE_TEXT = {
    "name": "type_text",
    "description": "Type text into the currently focused field.",
    "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
}
REF_TYPE = {
    "name": "type_into",
    "description": "Type text into the field with this ref number.",
    "input_schema": {"type": "object", "properties": {"ref": {"type": "integer"}, "text": {"type": "string"}}, "required": ["ref", "text"]},
}
CLICK = {
    "name": "click",
    "description": "Click the element with this marker number.",
    "input_schema": {"type": "object", "properties": {"ref": {"type": "integer"}}, "required": ["ref"]},
}
SCROLL = {
    "name": "scroll",
    "description": "Scroll the page and look again.",
    "input_schema": {"type": "object", "properties": {"direction": {"type": "string", "enum": ["down", "up"]}}, "required": ["direction"]},
}
LOOK = {"name": "look", "description": "Look at the current screen again.", "input_schema": {"type": "object", "properties": {}}}
BACK = {"name": "go_back", "description": "Browser back button (Alt+Left).", "input_schema": {"type": "object", "properties": {}}}

SR_TOOLS = [
    {
        "name": "read_page",
        "description": f"Read the page from a line number ({SR_PAGE_LINES} lines at a time), like a screen reader's browse mode.",
        "input_schema": {"type": "object", "properties": {"from_line": {"type": "integer", "minimum": 1}}},
    },
    {
        "name": "list_elements",
        "description": "Screen-reader element list: all headings, links, buttons, form fields or landmarks.",
        "input_schema": {
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": ["heading", "link", "button", "field", "landmark"]}},
            "required": ["kind"],
        },
    },
    {
        "name": "find_text",
        "description": "Search the page text (like the screen reader's find command).",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
    {
        "name": "activate",
        "description": "Move to the element with this [ref] and press Enter (follow a link / press a button / toggle).",
        "input_schema": {"type": "object", "properties": {"ref": {"type": "integer"}}, "required": ["ref"]},
    },
    REF_TYPE,
    PRESS_KEY,
    BACK,
]

PERSONA_TOOLS = {
    "keyboard": [PRESS_KEY, TYPE_TEXT, BACK],
    "screen_reader": SR_TOOLS,
    "color_blind": [LOOK, CLICK, REF_TYPE, SCROLL, PRESS_KEY, BACK],
    "low_vision": [LOOK, CLICK, REF_TYPE, SCROLL, PRESS_KEY, BACK],
}

SYSTEM = """You are role-playing a real person using a website, to find accessibility barriers.

PERSONA: {label}
{brief}

GOAL: {goal}
START PAGE: {url}

Rules:
- Stay in character. Only use what this persona can perceive and do (your tools are limited on purpose). Never assume information you couldn't perceive.
- Before each action, write ONE short sentence of what you're thinking or trying (this is shown to the user as your inner monologue).
- When something blocks or seriously slows you, call report_barrier right away, with a concrete fix.
- Try reasonable alternatives (like a real, patient user), but don't loop. If you're stuck after a few attempts, report it and finish with success=false.
- Call finish when the goal is done, impossible, or you've used most of your {max_actions} actions.
- Be honest: if the site works well for this persona, say so, and list what worked in finish's `worked`.
"""


@dataclass
class Journey:
    url: str
    goal: str
    persona: str
    profile: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "starting"  # starting | running | done | error | stopped
    steps: list[dict] = field(default_factory=list)
    barriers: list[dict] = field(default_factory=list)
    auto_findings: list[dict] = field(default_factory=list)
    success: bool | None = None
    summary: str = ""
    worked: list[str] = field(default_factory=list)
    error: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    shots: dict[int, bytes] = field(default_factory=dict)
    stop_requested: bool = False
    current: str = "Opening the browser…"
    model: str = ""
    tokens_in: int = 0  # uncached input
    tokens_cache_read: int = 0
    tokens_cache_write: int = 0
    tokens_out: int = 0
    llm_calls: int = 0
    visited: list[str] = field(default_factory=list)

    def public(self, since: int = 0) -> dict:
        return {
            "id": self.id, "url": self.url, "goal": self.goal, "persona": self.persona,
            "persona_label": PERSONAS[self.persona]["label"], "who": PERSONAS[self.persona]["who"],
            "status": self.status, "current": self.current, "success": self.success, "summary": self.summary,
            "worked": self.worked, "error": self.error, "steps": self.steps[since:], "step_count": len(self.steps),
            "barriers": self.barriers, "auto_findings": self.auto_findings,
            "elapsed_s": round((self.finished_at or time.time()) - self.started_at, 1),
            "usage": {"model": self.model, "effort": EFFORT, "input_tokens": self.tokens_in, "cache_read_input_tokens": self.tokens_cache_read,
                      "cache_creation_input_tokens": self.tokens_cache_write, "output_tokens": self.tokens_out, "llm_calls": self.llm_calls},
        }


# --------------------------------------------------------------------------


def _jpeg(img: Image.Image, width: int = 720) -> bytes:
    im = img.copy()
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=80)
    return buf.getvalue()


def _font(size: int):
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_markers(img: Image.Image, items: list[dict], scale: float) -> Image.Image:
    """Numbered markers ("set of marks") so the model can say which thing to click."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    f = _font(int(13 * scale))
    for it in items:
        r = it["rect"]
        x, y = max(0, r["x"] * scale), max(0, r["y"] * scale)
        d.rectangle([x, y, x + r["w"] * scale, y + r["h"] * scale], outline=(255, 0, 170), width=max(1, int(scale)))
        label = str(it["ref"])
        tw = d.textlength(label, font=f)
        lh = 16 * scale
        lx, ly = (x - tw - 7 * scale, y) if x >= tw + 7 * scale else (x, y - lh if y >= lh else y)
        d.rectangle([lx, ly, lx + tw + 6 * scale, ly + lh], fill=(20, 20, 20))
        d.text((lx + 3 * scale, ly + 1 * scale), label, fill=(255, 255, 0), font=f)
    return out


def draw_focus(img: Image.Image, rect: dict | None, scale: float) -> Image.Image:
    if not rect:
        return img
    out = img.copy()
    d = ImageDraw.Draw(out)
    x, y = rect["x"] * scale, rect["y"] * scale
    for i in range(3):
        d.rectangle([x - 4 - i, y - 4 - i, x + rect["w"] * scale + 4 + i, y + rect["h"] * scale + 4 + i], outline=(255, 0, 170))
    return out


class JourneyRunner:
    """Owns the browser for one journey and executes persona-limited tools."""

    def __init__(self, j: Journey, client: Any, model: str):
        self.j = j
        self.client = client
        self.model = model
        self.p = PERSONAS[j.persona]
        self.page = None
        self.sr_cache: dict | None = None
        self.focus_history: list[str] = []
        self.nofocus: list[str] = []
        self.last_focus_ref: int | None = None
        self._finding_keys: set[str] = set()

    # ---------------- perception helpers ----------------

    def _settle(self):
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        self.page.wait_for_timeout(250)
        self.sr_cache = None
        if not self.j.visited or self.j.visited[-1] != self.page.url:
            self.j.visited.append(self.page.url)

    def _raw_shot(self) -> Image.Image:
        return Image.open(io.BytesIO(self.page.screenshot())).convert("RGB")

    def _persona_view(self, img: Image.Image) -> Image.Image:
        """What this persona's eyes get."""
        if self.j.persona == "color_blind":
            cvd = self.j.profile.get("cvd_type") or "none"
            cvd = cvd if cvd not in ("none", None) else "deutan"
            return cl.simulate_image(img, cvd, float(self.j.profile.get("severity", 1.0)) if cvd == self.j.profile.get("cvd_type") else 1.0)
        if self.j.persona == "low_vision":
            img = img.filter(ImageFilter.GaussianBlur(2.2))
            return ImageEnhance.Contrast(img).enhance(0.6)
        return img

    def _image_block(self, img: Image.Image) -> dict:
        im = img.copy()
        im.thumbnail((1280, 1280))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
        return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}

    def _finding(self, key: str, title: str, detail: str, severity: str = "serious", wcag: str = ""):
        if key in self._finding_keys:
            return
        self._finding_keys.add(key)
        self.j.auto_findings.append({"title": title, "detail": detail, "severity": severity, "wcag": wcag, "step": len(self.j.steps) + 1})

    def _check_unreachable(self):
        if self.j.persona != "keyboard":
            return
        items = self.page.evaluate("window.__siyw.unreachableClickables()")
        if items:
            names = ", ".join(f"“{i['name'][:40]}”" for i in items[:5])
            self._finding(
                f"unreachable:{self.page.url}", f"{len(items)} clickable element(s) can't be reached with the keyboard",
                f"They react to the mouse but can't get keyboard focus: {names}. Use <button>/<a href>, or add tabindex=\"0\" and Enter/Space handlers.",
                "serious", "2.1.1 Keyboard",
            )

    def _sr(self) -> dict:
        if self.sr_cache is None:
            self.sr_cache = self.page.evaluate("window.__siyw.srLines()")
            st = self.sr_cache["stats"]
            if st["unnamed_buttons"] or st["unnamed_links"]:
                self._finding("sr-unnamed", f"{st['unnamed_buttons']} button(s) and {st['unnamed_links']} link(s) have no name",
                              "The screen reader just says “button” or reads a URL, so the user can't tell what they do.", "serious", "4.1.2 Name, Role, Value")
            if st["unlabeled_fields"]:
                self._finding("sr-fields", f"{st['unlabeled_fields']} form field(s) without a proper label",
                              "The user hears “edit text” with no (or placeholder-only) label.", "serious", "1.3.1 / 3.3.2 Labels")
            if st["images_no_alt"]:
                self._finding("sr-alt", f"{st['images_no_alt']} image(s) without alt text",
                              "The screen reader reads the file name instead.", "serious", "1.1.1 Non-text Content")
            if not st["headings"]:
                self._finding("sr-headings", "No headings to navigate by",
                              "Screen-reader users jump between headings to skim; this page has none.", "serious", "1.3.1 Info and Relationships")
            if not st["landmarks"]:
                self._finding("sr-landmarks", "No landmarks (header, nav, main…)",
                              "Users can't jump straight to the main content or navigation.", "minor", "1.3.1 / 2.4.1")
        return self.sr_cache

    def _observe_visual(self) -> tuple[list[dict], Image.Image, Image.Image]:
        """Returns (tool_result content, persona image, human-view image)."""
        info = self.page.evaluate("window.__siyw.interactiveInViewport()")
        raw = self._raw_shot()
        scale = self.p["dsf"]
        seen = draw_markers(self._persona_view(raw), info["items"], scale)
        human = draw_markers(raw, info["items"], scale)
        listing = "\n".join(
            f"[{i['ref']}] {i['role']}: {i['name'] or '(no name)'}" for i in info["items"][:60]
        )
        text = (f"Page: {info['title']} ({info['url']})\nScrolled {info['scroll_y']}px of {info['page_height']}px.\n"
                f"Numbered things you could click (names come from the page code; trust them only if you can also see them):\n{listing or '(none visible)'}")
        return [{"type": "text", "text": text}, self._image_block(seen)], seen, human

    def _focus_text(self, f: dict) -> str:
        if f.get("on_body") and self.last_focus_ref is not None and self.last_focus_ref == self.page.evaluate("window.__siyw.lastTabbableRef()"):
            return "Focus: left the page (you tabbed past the last item, so it went to the browser's address bar). Tab again to start from the top."
        if f.get("on_body"):
            return "Focus: nothing focused (focus is on the page body; you can't tell where you are)."
        e = f["element"]
        vis = "visible focus indicator" if f["focus_indicator"] != "none detected" else "NO visible focus indicator detected"
        return f"Focus: {e['role']} “{e['name'] or '(no name)'}” [{vis}]" + ("" if e["in_viewport"] else " (off-screen)")

    # ---------------- tool execution ----------------

    def run_tool(self, name: str, args: dict) -> tuple[list[dict] | str, Image.Image | None, str]:
        """Returns (content for Claude, image for the timeline, short human-readable result)."""
        pg = self.page
        persona = self.j.persona

        if name == "press_key":
            key, times = args["key"], int(args.get("times", 1) or 1)
            lines = []
            for _ in range(times):
                pg.keyboard.press(key)
                pg.wait_for_timeout(150)
                f = pg.evaluate("window.__siyw.focusInfo()")
                lines.append(self._focus_text(f))
                if key in ("Tab", "Shift+Tab"):
                    self._track_focus(f)
            if key in ("Enter", "Space"):
                self._settle()
                self._check_unreachable()
            f = pg.evaluate("window.__siyw.focusInfo()")
            return self._after_action(f"Pressed {key}" + (f" ×{times}" if times > 1 else ""), lines, f)

        if name == "type_text":
            pg.keyboard.type(args["text"], delay=20)
            f = pg.evaluate("window.__siyw.focusInfo()")
            return self._after_action(f"Typed “{args['text']}”", [], f)

        if name == "go_back":
            try:
                pg.go_back(wait_until="domcontentloaded", timeout=10000)
            except Exception:
                pass
            self._settle()
            self._check_unreachable()
            f = pg.evaluate("window.__siyw.focusInfo()")
            return self._after_action("Went back", [], f)

        if name in ("click", "activate", "type_into"):
            ref = int(args["ref"])
            loc = pg.locator(f'[data-siyw-ref="{ref}"]').first
            if loc.count() == 0:
                raise ValueError(f"No element with ref {ref} on the current page. Look/read again to get fresh numbers.")
            if name == "click":
                loc.scroll_into_view_if_needed(timeout=3000)
                loc.click(timeout=5000)
                self._settle()
                return self._visual_result(f"Clicked [{ref}]")
            if name == "activate":
                focused = pg.evaluate(f"window.__siyw.focusRef({ref})")
                if focused:
                    pg.keyboard.press("Enter")
                else:  # screen readers can still "click" non-focusable things in browse mode
                    loc.click(timeout=5000)
                self._settle()
                sr = self._sr()
                return (f"Activated [{ref}]. Now on: {sr['title']} ({sr['url']}). Use read_page to continue.",
                        self._raw_shot(), f"Activated [{ref}]" + ("" if focused else " (wasn't focusable; used click)"))
            loc.fill("", timeout=5000)
            loc.type(args["text"], delay=20, timeout=10000)
            if persona == "screen_reader":
                self.sr_cache = None
                return f"Typed “{args['text']}” into [{ref}].", self._raw_shot(), f"Typed into [{ref}]"
            return self._visual_result(f"Typed “{args['text']}” into [{ref}]")

        if name == "scroll":
            pg.mouse.wheel(0, 600 if args["direction"] == "down" else -600)
            pg.wait_for_timeout(300)
            return self._visual_result(f"Scrolled {args['direction']}")

        if name == "look":
            return self._visual_result("Looked at the screen")

        if name == "read_page":
            sr = self._sr()
            start = max(1, int(args.get("from_line", 1) or 1))
            chunk = sr["lines"][start - 1 : start - 1 + SR_PAGE_LINES]
            body = "\n".join(f"{start + i}. {l['text']}" + (f" [ref {l['ref']}]" if l.get("ref") else "") for i, l in enumerate(chunk))
            more = len(sr["lines"]) - (start - 1 + len(chunk))
            head = f"Page title: “{sr['title'] or '(no title)'}”, language: {sr['lang'] or '(not set)'}\n" if start == 1 else ""
            text = head + (body or "(nothing more)") + (f"\n…{more} more lines (read_page from_line={start + len(chunk)})" if more > 0 else "\n(end of page)")
            return text, self._raw_shot(), f"Read lines {start}–{start + len(chunk) - 1}"

        if name == "list_elements":
            sr = self._sr()
            kind = args["kind"]
            items = [l for l in sr["lines"] if l.get("kind") == kind]
            text = "\n".join(f"- {l['text']}" + (f" [ref {l['ref']}]" if l.get("ref") else "") for l in items[:80]) or f"(no {kind}s found)"
            return f"{len(items)} {kind}(s):\n{text}", self._raw_shot(), f"Listed {kind}s ({len(items)})"

        if name == "find_text":
            sr = self._sr()
            q = args["query"].lower()
            hits = [(i + 1, l) for i, l in enumerate(sr["lines"]) if q in l["text"].lower()]
            text = "\n".join(f"line {n}: {l['text']}" + (f" [ref {l['ref']}]" if l.get("ref") else "") for n, l in hits[:20]) or "Not found."
            return text, self._raw_shot(), f"Searched for “{args['query']}” ({len(hits)} found)"

        raise ValueError(f"Tool {name} isn't available for this persona.")

    def _track_focus(self, f: dict):
        if f.get("on_body"):
            if self.last_focus_ref is not None and self.last_focus_ref == self.page.evaluate("window.__siyw.lastTabbableRef()"):
                return  # tabbed past the last item: focus wraps to the browser UI, that's normal
            self._finding("focus-lost", "Focus disappeared while tabbing",
                          "After pressing Tab, nothing was focused, so a keyboard user loses their place.", "serious", "2.4.3 Focus Order")
            return
        e = f["element"]
        self.last_focus_ref = e["ref"]
        key = f"{e['ref']}|{f.get('url')}"
        if f["focus_indicator"] == "none detected":
            label = f"{e['role']} “{e['name'][:40] or '(no name)'}”"
            if label not in self.nofocus:
                self.nofocus.append(label)
                existing = next((x for x in self.j.auto_findings if x.get("key") == "nofocus"), None)
                title = f"No visible focus indicator on {len(self.nofocus)} element(s)"
                detail = ("Keyboard users can't see where they are: " + ", ".join(self.nofocus[:6])
                          + ("…" if len(self.nofocus) > 6 else "") + ". Don't remove outlines; style :focus-visible instead.")
                if existing:
                    existing.update(title=title, detail=detail)
                else:
                    self.j.auto_findings.append({"key": "nofocus", "title": title, "detail": detail, "severity": "serious",
                                                 "wcag": "2.4.7 Focus Visible", "step": len(self.j.steps) + 1})
        self.focus_history.append(key)
        h = self.focus_history[-4:]
        if len(h) == 4 and len(set(h)) <= 2:
            self._finding(f"trap:{key}", "Possible keyboard trap",
                          f"Tab keeps returning to the same element(s) (“{e['name'][:40]}”).", "blocker", "2.1.2 No Keyboard Trap")

    def _after_action(self, label: str, lines: list[str], f: dict):
        raw = self._raw_shot()
        rect = None if f.get("on_body") else f["element"]["rect"]
        human = draw_focus(raw, rect, self.p["dsf"])
        text = "\n".join(lines) if lines else self._focus_text(f)
        text += f"\nPage: {self.page.title()} ({self.page.url})"
        content = [{"type": "text", "text": text}, self._image_block(raw)]
        return content, human, label + (f" → {lines[-1].replace('Focus: ', '')}" if lines else "")

    def _visual_result(self, label: str):
        content, seen, _human = self._observe_visual()
        return content, seen, label  # the timeline shows what this persona actually sees

    # ---------------- main loop ----------------

    def initial_observation(self) -> list[dict] | str:
        if self.j.persona == "screen_reader":
            sr = self._sr()
            return (f"The page has loaded. Screen reader announces: “{sr['title'] or 'untitled page'}”. "
                    f"{len(sr['lines'])} lines. Use read_page, list_elements or find_text to explore.")
        if self.j.persona == "keyboard":
            self._check_unreachable()
            raw = self._raw_shot()
            return [{"type": "text", "text": f"The page has loaded: {self.page.title()} ({self.page.url}). Nothing is focused yet. Press Tab to start."},
                    self._image_block(raw)]
        content, _, _ = self._observe_visual()
        return content

    def _record(self, thought: str, tool: str, args: dict, result: str, img: Image.Image | None, error: bool = False,
                heard: str = ""):
        n = len(self.j.steps) + 1
        if img is not None:
            self.j.shots[n] = _jpeg(img)
        step = {"n": n, "thought": thought, "tool": tool, "input": args, "result": result, "error": error, "has_shot": img is not None}
        if heard:
            step["heard"] = heard[:4000]  # what the screen reader said: the UI can play it aloud
        self.j.steps.append(step)

    def _ask(self, system: str, tools: list[dict], messages: list[dict]):
        """One agent step. Cached prefix (tools, system, history so far); old tool results cleared by the API."""
        kw = {
            "model": self.model, "max_tokens": MAX_TOKENS, "system": system, "tools": tools, "messages": messages,
            "cache_control": {"type": "ephemeral"}, "output_config": {"effort": EFFORT},
            "context_management": {"edits": [CLEAR_OLD_RESULTS]}, "betas": [CONTEXT_BETA],
        }
        if self.model in FALLBACK_MODELS:
            kw["betas"] = [CONTEXT_BETA, FALLBACK_BETA]
            kw["fallbacks"] = "default"
        resp = self.client.beta.messages.create(**kw)
        if getattr(resp, "stop_reason", None) == "refusal":
            details = getattr(resp, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise RuntimeError(f"The model declined to continue this test{f' ({category})' if category else ''}.")
        return resp

    def run(self):
        from playwright.sync_api import sync_playwright

        j = self.j
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                ctx = browser.new_context(viewport=self.p["viewport"], device_scale_factor=self.p["dsf"], bypass_csp=True)
                ctx.add_init_script(HELPER_JS)
                install_route_guard(ctx)
                self.page = ctx.new_page()
                ctx.on("page", lambda pg: setattr(self, "page", pg))  # follow links that open new tabs
                j.current = "Opening the page…"
                try:
                    self.page.goto(j.url, wait_until="load", timeout=NAV_TIMEOUT_MS)
                except Exception as exc:
                    raise ValueError(f"Couldn't open {j.url}: {str(exc).splitlines()[0]}") from exc
                self._settle()
                j.status = "running"
                start_img = self._persona_view(self._raw_shot()) if j.persona in ("color_blind", "low_vision") else self._raw_shot()
                obs = self.initial_observation()
                self._record("Opening the page.", "open", {"url": j.url}, f"Loaded “{self.page.title()}”", start_img)

                tools = PERSONA_TOOLS[j.persona] + COMMON_TOOLS
                system = SYSTEM.format(label=self.p["label"], brief=self.p["brief"], goal=j.goal, url=j.url, max_actions=MAX_ACTIONS)
                first = [{"type": "text", "text": f"Your goal: {j.goal}"}]
                first += obs if isinstance(obs, list) else [{"type": "text", "text": obs}]
                messages = [{"role": "user", "content": first}]

                actions = 0
                while actions < MAX_ACTIONS and not j.stop_requested:
                    j.current = "Thinking…"
                    resp = self._ask(system, tools, messages)
                    j.llm_calls += 1
                    usage = getattr(resp, "usage", None)
                    if usage is not None:
                        n = lambda k: int(getattr(usage, k, 0) or 0)  # noqa: E731
                        j.tokens_in += n("input_tokens")
                        j.tokens_cache_read += n("cache_read_input_tokens")
                        j.tokens_cache_write += n("cache_creation_input_tokens")
                        j.tokens_out += n("output_tokens")
                    blocks = [_block(b) for b in resp.content]
                    messages.append({"role": "assistant", "content": blocks})
                    thought = " ".join(b["text"] for b in blocks if b.get("type") == "text").strip()
                    uses = [b for b in blocks if b.get("type") == "tool_use"]
                    if not uses:
                        j.summary = j.summary or thought
                        break

                    results, finished = [], False
                    for tu in uses:
                        name, args = tu["name"], tu.get("input") or {}
                        if name == "report_barrier":
                            j.barriers.append({**args, "step": len(j.steps) + 1})
                            self._record(thought, name, args, f"Barrier: {args.get('title', '')}", None)
                            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": "Recorded."})
                        elif name == "finish":
                            j.success, j.summary = bool(args.get("success")), args.get("summary", "")
                            worked = args.get("worked")
                            j.worked = [str(w)[:200] for w in worked if str(w).strip()][:5] if isinstance(worked, list) else []
                            self._record(thought, name, args, "Completed the goal" if j.success else "Gave up: couldn't complete the goal", None)
                            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": "Journey finished."})
                            finished = True
                        else:
                            actions += 1
                            j.current = f"Step {len(j.steps) + 1}: {name.replace('_', ' ')}…"
                            try:
                                content, img, label = self.run_tool(name, args)
                                heard = content if (j.persona == "screen_reader" and isinstance(content, str)) else ""
                                self._record(thought, name, args, label, img, heard=heard)
                                results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": content})
                            except Exception as exc:
                                msg = str(exc).splitlines()[0][:300]
                                self._record(thought, name, args, f"Failed: {msg}", None, error=True)
                                results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": f"That didn't work: {msg}", "is_error": True})
                        thought = ""  # only attach the thought to the first action of a turn
                    messages.append({"role": "user", "content": results})
                    if finished:
                        break
                    if actions == MAX_ACTIONS - 3:
                        messages[-1]["content"].append({"type": "text", "text": "You have 3 actions left. Wrap up and call finish soon."})
                try:
                    if self.page.url not in j.visited[-1:]:
                        j.visited.append(self.page.url)
                except Exception:
                    pass
                if j.stop_requested and j.success is None:
                    j.status = "stopped"
            finally:
                browser.close()


def _block(b: Any) -> dict:
    if isinstance(b, dict):
        return b
    if b.type == "text":
        return {"type": "text", "text": b.text}
    if b.type == "tool_use":
        return {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
    return b.model_dump(exclude_none=True)


def _last_step(j: Journey) -> dict | None:
    """The most recent step with something to show (for the live grid)."""
    reads = [st for st in j.steps if st.get("heard") and st["tool"] in ("read_page", "list_elements", "find_text")]
    heard = (reads[-1]["heard"] if reads else next((st["heard"] for st in reversed(j.steps) if st.get("heard")), None))
    for st in reversed(j.steps):
        if st.get("thought") or st.get("result"):
            return {k: st.get(k) for k in ("n", "tool", "thought", "result")} | {"heard": heard}
    return None


class JourneyManager:
    def __init__(self, client_factory, model_factory, max_concurrent: int | None = None):
        self._jobs: dict[str, Journey] = {}
        self._groups: dict[str, dict] = {}
        self._client_factory = client_factory
        self._model_factory = model_factory
        self._lock = threading.Lock()
        self._slots = Busy(max_concurrent or int(os.environ.get("MAX_CONCURRENT_BROWSERS", 6)))

    def _make(self, url: str, goal: str, persona: str, profile: dict) -> Journey:
        if persona not in PERSONAS:
            raise ValueError(f"Unknown persona. Choose one of: {', '.join(PERSONAS)}")
        goal = (goal or "").strip()
        if not goal:
            raise ValueError("Describe a goal, e.g. 'Find the contact phone number'.")
        url = normalize_url(url)
        check_url(url)
        return Journey(url=url, goal=goal[:500], persona=persona, profile=dict(profile))

    def _launch(self, j: Journey, client, run_async: bool):
        with self._lock:
            self._jobs[j.id] = j
            while len(self._jobs) > 60:
                self._jobs.pop(next(iter(self._jobs)))
        j.model = self._model_factory()
        runner = JourneyRunner(j, client or self._client_factory(), j.model)

        def go():
            try:
                runner.run()
                if j.status != "stopped":
                    j.status = "done"
                    if j.success is None:
                        j.success = False
                        j.summary = j.summary or "The journey ended before the goal was confirmed."
            except Exception as exc:  # surfaced to the UI
                j.status, j.error = "error", (str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__)
            finally:
                j.finished_at = time.time()
                j.current = ""
                self._slots.release()

        if run_async:
            threading.Thread(target=go, daemon=True, name=f"journey-{j.id}").start()
        else:
            go()

    def _acquire(self, n: int):
        got = 0
        for _ in range(n):
            if not self._slots.try_acquire():
                for _ in range(got):
                    self._slots.release()
                raise BusyError()
            got += 1

    def start(self, url: str, goal: str, persona: str, profile: dict, run_async: bool = True, client=None) -> Journey:
        j = self._make(url, goal, persona, profile)
        self._acquire(1)
        self._launch(j, client, run_async)
        return j

    def start_group(self, url: str, goal: str, profile: dict, run_async: bool = True, client=None, personas=None) -> dict:
        """Inclusion Score: the same task, attempted by every persona at once."""
        js = [self._make(url, goal, p, profile) for p in (personas or list(PERSONAS))]
        self._acquire(len(js))
        gid = uuid.uuid4().hex[:12]
        with self._lock:
            self._groups[gid] = {"id": gid, "url": js[0].url, "goal": js[0].goal, "journeys": [j.id for j in js]}
            while len(self._groups) > 20:
                self._groups.pop(next(iter(self._groups)))
        for j in js:
            self._launch(j, client, run_async)
        return self.group(gid)

    def group(self, gid: str) -> dict | None:
        g = self._groups.get(gid)
        if not g:
            return None
        members = [self._jobs[jid] for jid in g["journeys"] if jid in self._jobs]
        done = [m for m in members if m.status in ("done", "error", "stopped")]
        return {
            **g,
            "members": [
                {"id": m.id, "persona": m.persona, "persona_label": PERSONAS[m.persona]["label"], "status": m.status,
                 "success": m.success, "steps": len(m.steps), "barriers": len(m.barriers) + len(m.auto_findings),
                 "current": m.current, "summary": m.summary, "worked": m.worked, "error": m.error,
                 "last": _last_step(m), "shot": max(m.shots) if m.shots else None,
                 "barrier_list": [{k: b.get(k) for k in ("title", "detail", "severity", "wcag", "fix")} | {"source": src}
                                  for src, bs in (("agent", m.barriers), ("auto", m.auto_findings)) for b in bs],
                 "tokens": m.tokens_in + m.tokens_cache_read + m.tokens_cache_write + m.tokens_out}
                for m in members
            ],
            "finished": len(done) == len(members),
            "completed": sum(1 for m in members if m.success),
            "total": len(members),
        }

    def get(self, jid: str) -> Journey | None:
        return self._jobs.get(jid)

    def stop(self, jid: str) -> Journey | None:
        j = self._jobs.get(jid)
        if j:
            j.stop_requested = True
        return j

    def stop_group(self, gid: str) -> dict | None:
        g = self._groups.get(gid)
        for jid in (g or {}).get("journeys", []):
            self.stop(jid)
        return self.group(gid) if g else None
