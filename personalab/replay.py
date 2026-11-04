"""Demo replays: a real finished run, saved as static files the web app can play back without calling the AI.

Visitors without an API key (and anyone who has used today's free runs) can still watch the agents work.
Only record real runs: a replay is shown as "a real run recorded on <date>".

    python -m personalab.replay save <run-id> --name hotel-book [--server http://localhost:5050]

writes web/public/replays/<name>/record.json + one JPEG per screenshot step, and lists it in index.json.
Rebuild the frontend afterwards (cd web && npm run build) so web/out includes it.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import urllib.request
from pathlib import Path
from typing import Callable

from PIL import Image

from .pricing import cost_usd

ROOT = Path(__file__).resolve().parent.parent
REPLAYS = ROOT / "web" / "public" / "replays"
SHOT_WIDTH = 640  # the cards show screenshots at about half this


def http_fetch(server: str) -> Callable[[str], bytes]:
    def fetch(path: str) -> bytes:
        with urllib.request.urlopen(server.rstrip("/") + path, timeout=30) as r:
            return r.read()
    return fetch


def _small_jpeg(data: bytes) -> bytes:
    im = Image.open(io.BytesIO(data))
    if im.width > SHOT_WIDTH:
        im = im.resize((SHOT_WIDTH, round(im.height * SHOT_WIDTH / im.width)))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=72, optimize=True)
    return buf.getvalue()


def save(run_id: str, name: str, fetch: Callable[[str], bytes], out: Path = REPLAYS) -> dict:
    """Copy a finished run from a running server into `out/<name>/`; returns its index entry."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", name):
        raise ValueError("Use a short name of lowercase letters, digits and dashes, e.g. hotel-book.")
    record = json.loads(fetch(f"/api/run/{run_id}/export.json"))
    run = record["run"]
    if not run.get("finished"):
        raise ValueError("That run hasn't finished yet.")
    if any(m.get("status") == "error" for m in run["members"]):
        raise ValueError("An agent in that run couldn't run; record a run where all four ran.")

    _add_costs(record)

    folder = out / name
    if folder.exists():
        shutil.rmtree(folder)
    (folder / "shots").mkdir(parents=True)
    shots = 0
    for j in record["journeys"]:
        for st in j["steps"]:
            if st.get("has_shot"):
                (folder / "shots" / f"{j['id']}-{st['n']}.jpg").write_bytes(_small_jpeg(fetch(f"/api/journey/{j['id']}/shot/{st['n']}.jpg")))
                shots += 1
    (folder / "record.json").write_text(json.dumps(record, ensure_ascii=False))

    models = sorted({(j.get("usage") or {}).get("model") for j in record["journeys"]} - {None, ""})
    entry = {
        "id": name, "goal": run["goal"], "url": run["url"], "recorded_at": record["exported_at"],
        "model": ", ".join(models), "completed": run["completed"], "total": run["total"],
        "steps": sum(len(j["steps"]) for j in record["journeys"]), "shots": shots, "cost_usd": run.get("cost_usd"),
    }
    index_file = out / "index.json"
    index = json.loads(index_file.read_text()) if index_file.exists() else []
    index = [e for e in index if e["id"] != name] + [entry]
    index_file.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
    return entry


def _add_costs(record: dict) -> None:
    """Fill in each agent's cost from its token usage, for runs recorded before costs were reported."""
    usage = {j["id"]: j.get("usage") or {} for j in record["journeys"]}
    run = record["run"]
    for m in run["members"]:
        if m.get("cost_usd") is None:
            u = usage.get(m["id"], {})
            m["cost_usd"] = cost_usd(u.get("model"), u.get("input_tokens", 0), u.get("output_tokens", 0),
                                     u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0))
    costs = [m["cost_usd"] for m in run["members"]]
    run["cost_usd"] = None if None in costs else round(sum(costs), 4)


def remove(name: str, out: Path = REPLAYS) -> None:
    shutil.rmtree(out / name, ignore_errors=True)
    index_file = out / "index.json"
    if index_file.exists():
        index_file.write_text(json.dumps([e for e in json.loads(index_file.read_text()) if e["id"] != name], indent=2) + "\n")


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m personalab.replay", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("save", help="save a finished run from a running server as a replay")
    s.add_argument("run_id", help="the id in the run page's address: /run?id=<run-id>")
    s.add_argument("--name", required=True, help="replay id, e.g. hotel-book")
    s.add_argument("--server", default="http://localhost:5050")
    r = sub.add_parser("remove", help="delete a replay")
    r.add_argument("name")
    args = p.parse_args()
    if args.cmd == "save":
        e = save(args.run_id, args.name, http_fetch(args.server))
        print(f"Saved replay '{e['id']}': {e['completed']} of {e['total']} could {e['goal'].lower()}, {e['steps']} steps, {e['shots']} screenshots.")
        print("Rebuild the frontend (cd web && npm run build) to include it.")
    else:
        remove(args.name)
        print(f"Removed replay '{args.name}'.")


if __name__ == "__main__":
    main()
