"""Persona Lab web server.

Pages:  the Next.js app (web/, built to web/out) at / /run /saved /history /evals,
        and /bench/<site>/ (demo sites with planted barriers). JSON API under /api/.
No login. PUBLIC_MODE=1 turns on SSRF protection, per-visitor daily limits and
lets visitors bring their own Anthropic key.
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

from .evals import BENCH, list_results, load_benchmark
from .export import export_group, export_journey, export_record
from .guard import BusyError, RateLimiter, limits, local_bench_url, public_mode
from .journey import DEFAULT_MODEL, PERSONAS, JourneyManager

ROOT = Path(__file__).resolve().parent.parent
WEB_OUT = ROOT / "web" / "out"  # `npm run build` in web/ (a Next.js static export)
KEY_HEADER = "X-Anthropic-Key"


def create_app(agent_client=None, web_dir: Path | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    web = Path(web_dir or os.environ.get("PERSONALAB_WEB_DIR") or WEB_OUT)
    model = os.environ.get("CLAUDE_MODEL") or DEFAULT_MODEL
    state = {"server_client": None}

    def server_client():
        if state["server_client"] is None:
            import anthropic

            state["server_client"] = anthropic.Anthropic()
        return state["server_client"]

    journeys = JourneyManager(lambda: agent_client or server_client(), lambda: model)
    app.config["JOURNEYS"] = journeys
    limiter = RateLimiter()

    # ---------------- helpers ----------------

    def bad(msg: str, code: int = 400):
        return jsonify({"error": msg}), code

    def visitor() -> str:
        if os.environ.get("TRUST_PROXY") and request.headers.get("X-Forwarded-For"):
            return request.headers["X-Forwarded-For"].split(",")[0].strip()
        return request.remote_addr or "unknown"

    def own_key() -> str | None:
        key = (request.headers.get(KEY_HEADER) or "").strip()
        return key if re.fullmatch(r"sk-ant-[A-Za-z0-9_\-]{20,200}", key) else None

    def ai_client():
        """The visitor's own key if given, else the server's key (None = no AI available)."""
        if agent_client is not None:
            return agent_client
        if own_key():
            import anthropic

            return anthropic.Anthropic(api_key=own_key())
        return server_client() if os.environ.get("ANTHROPIC_API_KEY") else None

    @app.after_request
    def security_headers(resp: Response):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        if not request.path.startswith("/bench/"):
            resp.headers.setdefault("X-Frame-Options", "DENY")
        return resp

    # ---------------- pages ----------------

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def web_app(path: str):
        """The Next.js static export: /history -> history.html, /_next/... assets, else its 404 page."""
        if path.startswith("api/"):
            return bad("Not found.", 404)
        if not (web / "index.html").exists():
            return Response("The web app isn't built yet. Run: cd web && npm install && npm run build", 503, mimetype="text/plain")
        path = path.rstrip("/")
        for candidate in (path or "index.html", f"{path}.html", f"{path}/index.html"):
            if candidate and (web / candidate).is_file():
                resp = send_from_directory(web, candidate)
                if path.startswith("_next/static/"):
                    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # content-hashed names
                return resp
        return send_from_directory(web, "404.html"), 404

    @app.get("/bench/<path:path>")
    def bench_site(path: str):
        """Demo websites with planted barriers (also the evaluation benchmark)."""
        if path.endswith("/"):
            path += "index.html"
        return send_from_directory(BENCH / "sites", path)

    # ---------------- meta ----------------

    @app.get("/api/health")
    def health():
        v = visitor()
        return jsonify({
            "ok": True, "public_mode": public_mode(), "model": model,
            "ai_ready": agent_client is not None or bool(os.environ.get("ANTHROPIC_API_KEY")),
            "remaining": {"journey": limiter.remaining(v, "journey")} if public_mode() else None,
        })

    @app.get("/api/personas")
    def personas():
        return jsonify([{"id": k, "label": v["label"], "who": v["who"], "brief": v["brief"]} for k, v in PERSONAS.items()])

    @app.get("/api/demos")
    def demos():
        return jsonify([
            {"id": t["id"], "site": t["site"], "goal": t["goal"], "path": f"/bench/{t['site']}/{t['start']}"}
            for t in load_benchmark()["tasks"]
        ])

    # ---------------- runs (all personas on one task) ----------------

    @app.post("/api/run")
    def run_start():
        body = request.get_json(silent=True) or {}
        url = (body.get("url") or "").strip()
        if url.startswith("/bench/"):  # a built-in demo site
            # Public mode loads it over loopback: the visitor-facing host may be localhost (blocked) or a proxy.
            url = local_bench_url(url) if public_mode() else request.host_url.rstrip("/") + url
        chosen = [p for p in (body.get("personas") or list(PERSONAS)) if p in PERSONAS] or list(PERSONAS)
        client = ai_client()
        if client is None:
            return bad("The agents need a Claude API key. Add your own in Settings (it stays in your browser)"
                       + ("." if public_mode() else ", or set ANTHROPIC_API_KEY in .env."), 503)
        try:
            for p in chosen:  # validate before spending the allowance
                journeys._make(url, body.get("goal", ""), p, {})
            if not own_key() and not limiter.take(visitor(), "journey", len(chosen)):
                return bad("You've used today's free runs on this demo. Add your own Claude API key in Settings to keep going.", 429)
            g = journeys.start_group(url, body.get("goal", ""), {"cvd_type": "deutan"}, client=client,
                                     run_async=not app.config.get("SYNC"), personas=chosen)
        except ValueError as exc:
            return bad(str(exc))
        except BusyError:
            return bad("A lot of tests are running right now. Please try again in a few minutes.", 429)
        return jsonify(g)

    @app.get("/api/run/<gid>")
    def run_status(gid: str):
        g = journeys.group(gid)
        return jsonify(g) if g else bad("Run not found (the server may have restarted).", 404)

    @app.post("/api/run/<gid>/stop")
    def run_stop(gid: str):
        g = journeys.stop_group(gid)
        return jsonify(g) if g else bad("Run not found.", 404)

    @app.get("/api/run/<gid>/report.html")
    def run_report(gid: str):
        g = journeys.group(gid)
        if not g:
            return bad("Run not found (the server may have restarted).", 404)
        members = [journeys.get(jid) for jid in g["journeys"] if journeys.get(jid)]
        return _download(export_group(g, members), f"persona-lab-{gid}.html")

    @app.get("/api/run/<gid>/export.json")
    def run_export(gid: str):
        """Everything about a run except screenshots: the browser keeps it as History, users download it as JSON."""
        g = journeys.group(gid)
        if not g:
            return bad("Run not found (the server may have restarted).", 404)
        members = [journeys.get(jid) for jid in g["journeys"] if journeys.get(jid)]
        resp = jsonify(export_record(g, members))
        resp.headers["Content-Disposition"] = f'attachment; filename="persona-lab-{gid}.json"'
        return resp

    # ---------------- single journeys ----------------

    @app.get("/api/journey/<jid>")
    def journey_status(jid: str):
        j = journeys.get(jid)
        return jsonify(j.public(since=int(request.args.get("since", 0)))) if j else bad("Not found.", 404)

    @app.get("/api/journey/<jid>/shot/<int:n>.jpg")
    def journey_shot(jid: str, n: int):
        j = journeys.get(jid)
        data = j.shots.get(n) if j else None
        if not data:
            abort(404)
        resp = send_file(io.BytesIO(data), mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "max-age=3600"
        return resp

    @app.get("/api/journey/<jid>/report.html")
    def journey_report(jid: str):
        j = journeys.get(jid)
        return _download(export_journey(j), f"persona-lab-{j.persona}-{jid}.html") if j else bad("Not found.", 404)

    # ---------------- evals ----------------

    @app.get("/api/evals")
    def evals_list():
        return jsonify([{k: r.get(k) for k in ("id", "label", "kind", "model", "engine", "matcher", "created_at", "metrics", "per_persona", "barriers")}
                        for r in list_results()])

    @app.get("/api/evals/<rid>")
    def evals_one(rid: str):
        r = next((r for r in list_results() if r["id"] == rid), None)
        return jsonify(r) if r else bad("Not found.", 404)

    return app


def _download(html: str, filename: str):
    resp = Response(html, mimetype="text/html")
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


def load_env():
    env = ROOT / ".env"
    try:
        from dotenv import load_dotenv

        load_dotenv(env)
    except ImportError:
        if env.exists():
            for line in env.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    load_env()
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  Persona Lab  ->  http://localhost:{port}   (evals: /evals)\n")
    create_app().run(host="127.0.0.1", port=port, debug=bool(os.environ.get("DEBUG")), threaded=True)


if __name__ == "__main__":
    main()
