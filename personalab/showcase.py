"""Static showcase: the read-only API responses as files, for a free static host (no server, no AI calls).

    python -m personalab.showcase                      # writes web/public/data/
    cd web && NEXT_PUBLIC_SHOWCASE=1 npm run build     # static site in web/out: replays, compare, evals

The frontend reads these files instead of /api/... when built with NEXT_PUBLIC_SHOWCASE=1 (see web/src/lib/api.ts).
They come from the real Flask app, so they match what the server returns. Re-run after adding eval results.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .server import create_app

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data"


def export(out: Path = DATA) -> list[Path]:
    client = create_app().test_client()
    get = lambda path: client.get(path).get_json()  # noqa: E731
    if out.exists():
        shutil.rmtree(out)
    (out / "evals").mkdir(parents=True)
    files = {out / "personas.json": get("/api/personas"), out / "evals.json": get("/api/evals")}
    for r in files[out / "evals.json"]:
        files[out / "evals" / f"{r['id']}.json"] = get(f"/api/evals/{r['id']}")
    for path, data in files.items():
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    return list(files)


if __name__ == "__main__":
    for p in export():
        print(f"wrote {p.relative_to(DATA.parent.parent.parent)}")
