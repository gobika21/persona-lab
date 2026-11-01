"""Shared test helpers: a scripted fake Claude client and a local server for the benchmark sites."""
import copy
import re
import threading
from types import SimpleNamespace

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as _pw:
        _pw.chromium.launch().close()
    HAVE_BROWSER = True
except Exception:  # pragma: no cover
    HAVE_BROWSER = False


def tool(name, **inp):
    return SimpleNamespace(type="tool_use", id=f"{name}-{abs(hash(str(inp))) % 10**8}", name=name, input=inp)


def text(t):
    return SimpleNamespace(type="text", text=t)


def last_result_text(kw) -> str:
    last = kw["messages"][-1]["content"]
    out = []
    for b in last if isinstance(last, list) else []:
        if b.get("type") == "text":
            out.append(b.get("text", ""))
        elif b.get("type") == "tool_result":
            c = b.get("content")
            out.append(c if isinstance(c, str) else " ".join(x.get("text", "") for x in c))
    return " ".join(out)


def ref_for(seen: str, label: str) -> int:
    m = re.search(rf"\[(?:ref )?(\d+)\][^\n]*{label}|{label}[^\n]*\[(?:ref )?(\d+)\]", seen)
    assert m, f"no ref for {label!r} in: {seen[:600]}"
    return int(m.group(1) or m.group(2))


class Scripted:
    """Fake Messages API. `script(persona, n, seen)` returns content blocks for the n-th call of a journey."""

    def __init__(self, script):
        self.script = script
        self.messages = self
        self.beta = self  # client.beta.messages.create(...) lands in create() too
        self.calls = []
        self._lock = threading.Lock()

    def create(self, **kw):
        kw = copy.deepcopy(kw)
        with self._lock:
            self.calls.append(kw)
        system = kw.get("system", "")
        persona = next((p for p, key in (("keyboard", "Keyboard"), ("screen_reader", "screen-reader"),
                                          ("color_blind", "Color-blind"), ("low_vision", "Low-vision")) if key in system.split("GOAL:")[0]), None)
        n = sum(1 for m in kw["messages"] if m["role"] == "assistant")
        blocks = self.script(persona, n, last_result_text(kw), kw)
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100, cache_read_input_tokens=400 * n, cache_creation_input_tokens=300)
        if blocks == "refuse":  # a safety-filter decline
            details = SimpleNamespace(type="refusal", category="cyber", explanation="")
            return SimpleNamespace(content=[], stop_reason="refusal", stop_details=details, usage=usage)
        return SimpleNamespace(content=blocks, stop_reason="tool_use" if any(b.type == "tool_use" for b in blocks) else "end_turn", usage=usage)
