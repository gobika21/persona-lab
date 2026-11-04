"""Evaluation harness: how good are the persona agents, measured against ground truth?

The benchmark (benchmark/) is a set of small websites with *planted* barriers and
tasks whose outcome per persona is known. A run sends every persona through every
task and scores:

  outcome_accuracy  did the agent correctly conclude whether this person can do the task?
  verified_success  did it actually do it (checked objectively: page reached / answer given)?
  false_success     claimed success, but the objective check says it didn't happen
  barrier_recall    planted (barrier, persona) pairs the agents reported
  precision         share of reported findings that correspond to a planted barrier
  cost              steps, LLM calls, tokens, wall time (and $ if prices are configured)

A rules-only baseline (the same deterministic checks a typical linter runs) is
scored on the same barriers, to show what the agents add.

    python -m personalab.evals agents   --label v1-prompt          # needs ANTHROPIC_API_KEY
    python -m personalab.evals baseline                             # no API key needed
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .pricing import cost_usd

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "benchmark"
RESULTS = ROOT / "evals" / "results"


# --------------------------------------------------------------------------
# benchmark


def load_benchmark() -> dict:
    return json.loads((BENCH / "ground_truth.json").read_text())


@contextlib.contextmanager
def serve_sites():
    """Serve benchmark/sites on a free localhost port for the duration of a run."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(BENCH / "sites"))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()


# --------------------------------------------------------------------------
# matching findings to planted barriers


def _text(f: dict) -> str:
    return f"{f.get('title', '')} {f.get('detail', '')}".lower()


def matches(finding: dict, barrier: dict) -> bool:
    t = _text(finding)
    return any(a.lower() in t for a in barrier["anchors"]) and any(k.lower() in t for k in barrier["kinds"])


def match_findings(findings: list[dict], barriers: list[dict]) -> list[str | None]:
    """For each finding, the id of the first planted barrier it matches (or None = false positive)."""
    out = []
    for f in findings:
        hit = next((b["id"] for b in barriers if matches(f, b)), None)
        out.append(hit)
    return out


def run_cost(m: dict, model: str | None = None) -> float | None:
    """$ for a run: built-in prices for known models, or PRICE_* env vars (see pricing.py)."""
    c = cost_usd(model, m.get("input_tokens", 0), m.get("output_tokens", 0),
                 m.get("cache_read_tokens", 0), m.get("cache_write_tokens", 0))
    return None if c is None else round(c, 3)


def judge_findings(client, model: str, findings: list[dict], barriers: list[dict]) -> list[str | None]:
    """Optional LLM-as-judge matcher (more lenient with wording than keywords)."""
    if not findings:
        return []
    prompt = (
        "Map each reported accessibility finding to the ONE planted barrier it describes, or null if none.\n"
        "Planted barriers:\n" + "\n".join(f"- {b['id']}: {b['summary']}" for b in barriers)
        + "\n\nFindings:\n" + "\n".join(f"{i}. {f.get('title', '')}: {f.get('detail', '')}" for i, f in enumerate(findings))
        + '\n\nAnswer with JSON only: {"0": "barrier-id or null", ...}'
    )
    # Thinking counts toward max_tokens on current models; a short mapping task needs little effort.
    resp = client.messages.create(model=model, max_tokens=8000, output_config={"effort": "low"},
                                  messages=[{"role": "user", "content": prompt}])
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        data = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
    except Exception:
        return match_findings(findings, barriers)
    ids = {b["id"] for b in barriers}
    return [data.get(str(i)) if data.get(str(i)) in ids else None for i in range(len(findings))]


def verified(task: dict, j_public: dict) -> bool:
    s = task["success"]
    if "url_contains" in s:
        return any(any(x in u for x in s["url_contains"]) for u in j_public.get("visited", []))
    if "answer_contains" in s:
        ans = (j_public.get("summary") or "").lower().replace(" ", " ")
        return bool(j_public.get("success")) and any(x.lower() in ans for x in s["answer_contains"])
    return False


# --------------------------------------------------------------------------
# scoring


def _ratio(n: int, d: int) -> float | None:
    return round(n / d, 3) if d else None


def score(bench: dict, journeys: list[dict], kind: str = "agents", model: str | None = None) -> dict:
    """journeys: [{task, persona, possible, claimed, verified, findings:[{title,detail,matched}], ...}]"""
    personas = bench["personas"]
    pairs = [(b["id"], p) for b in bench["barriers"] for p in b["personas"]]
    found_pairs = {(f["matched"], j["persona"]) for j in journeys for f in j["findings"] if f.get("matched")}
    found_barriers = {f["matched"] for j in journeys for f in j["findings"] if f.get("matched")}
    findings = [f for j in journeys for f in j["findings"]]
    ok = [j for j in journeys if not j.get("error")]

    def outcome_stats(js):
        return {
            "outcome_accuracy": _ratio(sum(1 for j in js if j["claimed"] == j["possible"]), len(js)),
            "verified_success_rate": _ratio(sum(1 for j in js if j["verified"]), sum(1 for j in js if j["possible"])),
            "false_success_rate": _ratio(sum(1 for j in js if j["claimed"] and not j["verified"]), sum(1 for j in js if j["claimed"])),
        }

    metrics: dict[str, Any] = {
        "barrier_recall": _ratio(len(found_barriers), len(bench["barriers"])),
        "precision": _ratio(sum(1 for f in findings if f.get("matched")), len(findings)),
        "findings": len(findings),
    }
    per_persona = {}
    if kind == "agents":
        metrics["pair_recall"] = _ratio(len(found_pairs & set(pairs)), len(pairs))
        metrics.update(outcome_stats(ok))
        metrics.update({
            "journeys": len(journeys),
            "errors": len(journeys) - len(ok),
            "avg_steps": round(sum(j["steps"] for j in ok) / len(ok), 1) if ok else None,
            "avg_seconds": round(sum(j["seconds"] for j in ok) / len(ok), 1) if ok else None,
            "input_tokens": sum(j.get("input_tokens", 0) for j in journeys),
            "cache_read_tokens": sum(j.get("cache_read_tokens", 0) for j in journeys),
            "cache_write_tokens": sum(j.get("cache_write_tokens", 0) for j in journeys),
            "output_tokens": sum(j.get("output_tokens", 0) for j in journeys),
            "llm_calls": sum(j.get("llm_calls", 0) for j in journeys),
        })
        cost = run_cost(metrics, model)
        if cost is not None:
            metrics["cost_usd"] = cost
        for p in personas:
            pj = [j for j in ok if j["persona"] == p]
            pp = [x for x in pairs if x[1] == p]
            per_persona[p] = {
                "recall": _ratio(len({x for x in found_pairs if x[1] == p} & set(pp)), len(pp)),
                "journeys": len(pj), **outcome_stats(pj),
            }
    barriers = [
        {"id": b["id"], "site": b["site"], "summary": b["summary"], "wcag": b["wcag"], "personas": b["personas"],
         "detected": b["id"] in found_barriers,
         "detected_by": sorted({j["persona"] for j in journeys for f in j["findings"] if f.get("matched") == b["id"]})}
        for b in bench["barriers"]
    ]
    return {"metrics": metrics, "per_persona": per_persona, "barriers": barriers}


def _save(result: dict) -> Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"{result['id']}.json"
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    return path


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "run"


# --------------------------------------------------------------------------
# agent runs


def run_agents(client, model: str, label: str, task_ids=None, personas=None, concurrency: int = 4,
               judge: bool = False, save: bool = True, progress=print) -> dict:
    from .journey import EFFORT, Journey, JourneyRunner

    bench = load_benchmark()
    tasks = [t for t in bench["tasks"] if not task_ids or t["id"] in task_ids]
    personas = personas or bench["personas"]
    started = time.time()
    rows: list[dict] = []

    with serve_sites() as base:
        def one(task, persona):
            j = Journey(url=f"{base}/{task['site']}/{task['start']}", goal=task["goal"], persona=persona,
                        profile={"cvd_type": "deutan"}, model=model)
            t0 = time.time()
            try:
                JourneyRunner(j, client, model).run()
                j.status = "done"
            except Exception as exc:
                j.status, j.error = "error", str(exc).splitlines()[0][:300]
            pub = j.public() | {"visited": j.visited}
            site_barriers = [b for b in bench["barriers"] if b["site"] == task["site"]]
            findings = [{"title": f.get("title", ""), "detail": f.get("detail", ""), "source": src}
                        for src, fs in (("agent", j.barriers), ("auto", j.auto_findings)) for f in fs]
            ids = (judge_findings(client, model, findings, site_barriers) if judge else match_findings(findings, site_barriers))
            for f, m in zip(findings, ids):
                f["matched"] = m
            row = {
                "task": task["id"], "site": task["site"], "persona": persona, "possible": task["possible"][persona],
                "claimed": bool(j.success), "verified": verified(task, pub), "summary": j.summary, "error": j.error,
                "steps": len(j.steps), "seconds": round(time.time() - t0, 1), "llm_calls": j.llm_calls,
                "input_tokens": j.tokens_in, "cache_read_tokens": j.tokens_cache_read, "cache_write_tokens": j.tokens_cache_write,
                "output_tokens": j.tokens_out, "findings": findings, "visited": j.visited,
            }
            progress(f"  {task['id']:16} {persona:14} possible={row['possible']!s:5} claimed={row['claimed']!s:5} "
                     f"verified={row['verified']!s:5} findings={len(findings)} {row['seconds']}s" + (f" ERROR {j.error}" if j.error else ""))
            return row

        jobs = [(t, p) for t in tasks for p in personas]
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            rows = list(pool.map(lambda tp: one(*tp), jobs))

    result = {
        "id": f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{_slug(label)}-{uuid.uuid4().hex[:4]}",
        "label": label, "kind": "agents", "model": model, "effort": EFFORT, "matcher": "llm-judge" if judge else "keywords",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "benchmark_version": bench["version"], "wall_seconds": round(time.time() - started, 1),
        "tasks": [t["id"] for t in tasks], "personas": personas,
        **score(bench, rows, "agents", model), "journeys": rows,
    }
    if save:
        result["path"] = str(_save(result).relative_to(ROOT))
    return result


# --------------------------------------------------------------------------
# rules-only baseline


def _crawl_pages(page, start: str, limit: int = 8) -> list[str]:
    from urllib.parse import urljoin, urlsplit

    seen, queue = [], [start]
    root = start.rsplit("/", 1)[0] + "/"
    while queue and len(seen) < limit:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.append(url)
        page.goto(url, wait_until="load")
        for href in page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))"):
            nxt = urljoin(url, href).split("#")[0]
            if nxt.startswith(root) and urlsplit(nxt).path.endswith(".html") and nxt not in seen:
                queue.append(nxt)
    return seen


def run_baseline(label: str = "Rules-only baseline", save: bool = True, progress=print) -> dict:
    """Deterministic page rules (axe-core if available, else built-in rules) on every page of every site."""
    from playwright.sync_api import sync_playwright

    from .sitecheck import AXE_RUN_JS, PAGE_SCAN_JS, load_axe

    bench = load_benchmark()
    axe = load_axe()
    engine = "axe-core" if axe else "built-in rules"
    rows = []
    with serve_sites() as base, sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True)
        page = ctx.new_page()
        for site in sorted({t["site"] for t in bench["tasks"]}):
            starts = sorted({t["start"] for t in bench["tasks"] if t["site"] == site})
            pages = []
            for s in starts:
                pages += [u for u in _crawl_pages(page, f"{base}/{site}/{s}") if u not in pages]
            findings = []
            for url in pages:
                page.goto(url, wait_until="load")
                if axe:
                    page.add_script_tag(content=axe)
                    violations = page.evaluate(AXE_RUN_JS)["violations"]
                else:
                    violations = page.evaluate(PAGE_SCAN_JS)["builtin_violations"]
                for v in violations:
                    detail = " ".join(f"{n.get('html', '')} {n.get('failureSummary', '')}" for n in v["nodes"][:5])
                    findings.append({"title": v.get("help", v["id"]), "detail": detail, "source": f"{engine}:{v['id']}", "page": url})
            site_barriers = [b for b in bench["barriers"] if b["site"] == site]
            for f, m in zip(findings, match_findings(findings, site_barriers)):
                f["matched"] = m
            progress(f"  {site:8} pages={len(pages)} findings={len(findings)} matched={sum(1 for f in findings if f['matched'])}")
            rows.append({"task": None, "site": site, "persona": "rules", "findings": findings, "pages": pages})
        browser.close()

    result = {
        "id": f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{_slug(label)}-{uuid.uuid4().hex[:4]}",
        "label": label, "kind": "baseline", "model": None, "engine": engine, "matcher": "keywords",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "benchmark_version": bench["version"],
        **score(bench, rows, "baseline"), "journeys": rows,
    }
    if save:
        result["path"] = str(_save(result).relative_to(ROOT))
    return result


def list_results() -> list[dict]:
    out = []
    for p in sorted(RESULTS.glob("*.json"), reverse=True):
        try:
            r = json.loads(p.read_text())
            out.append(r)
        except json.JSONDecodeError:
            continue
    return out


# --------------------------------------------------------------------------
# CLI


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m personalab.evals", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("agents", help="run the persona agents on the benchmark (uses the Claude API)")
    a.add_argument("--label", required=True, help="name for this run, e.g. 'v2 prompt'")
    a.add_argument("--model", default=None, help="Claude model id (default: CLAUDE_MODEL or the app default)")
    a.add_argument("--tasks", nargs="*", help="task ids (default: all)")
    a.add_argument("--personas", nargs="*", help="personas (default: all)")
    a.add_argument("--concurrency", type=int, default=4)
    a.add_argument("--judge", action="store_true", help="match findings with an LLM judge instead of keywords")
    b = sub.add_parser("baseline", help="score rules-only checks on the same benchmark (no API key)")
    b.add_argument("--label", default="Rules-only baseline")
    args = ap.parse_args(argv)

    from .server import load_env

    load_env()
    if args.cmd == "baseline":
        r = run_baseline(args.label)
    else:
        import anthropic

        from .journey import DEFAULT_MODEL

        model = args.model or os.environ.get("CLAUDE_MODEL") or DEFAULT_MODEL
        print(f"Running persona agents with {model}…")
        r = run_agents(anthropic.Anthropic(), model, args.label, args.tasks, args.personas, args.concurrency, args.judge)
    print("\n" + json.dumps(r["metrics"], indent=2))
    if r.get("per_persona"):
        print(json.dumps(r["per_persona"], indent=2))
    print(f"\nSaved to {r.get('path')}")


if __name__ == "__main__":
    main()
