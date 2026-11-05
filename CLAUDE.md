# Persona Lab: notes for Claude Code

## What this is
Portfolio project for **AI/ML engineer** roles. One idea: AI agents that test a website the way
disabled people browse it (keyboard only, blind screen-reader user, color-blind, low vision at 200% zoom),
plus an **evaluation suite** that measures whether the agents can be trusted. Public demo, no login.

The owner wants: one focused story, a bold Gen Z neo-brutalist design (thick black edges, hard offset shadows, flat lime/pink/yellow/sky pops, Space Grotesk headings) that still passes axe, and measured results
(never invent eval numbers: only real runs go in `evals/results/`).

## Commands
- Run app: `(cd web && npm run build)` then `PORT=5050 python run.py` → http://localhost:5050 (port 5000 is taken by macOS AirPlay). Pages: / /run /saved /replay /compare /history /evals /accessibility; demo sites at /bench/<site>/
- Develop with live reload: `python dev.py` → http://localhost:3000 (Flask on 5050 with its reloader + `next dev`, which proxies /api and /bench to Flask). `run.py` serves the static build, so it needs a rebuild + restart after changes.
- Frontend checks: `cd web && npx eslint src && npm run build`
- Tests: `pytest -q` (a scripted fake Claude drives real Chromium; no API key needed)
- Own accessibility: `pytest -q tests/test_a11y.py` (needs `web/out` built + `web/node_modules`): axe in light/dark at 1280 and 320px, keyboard walk + visible focus, target size, text spacing, reduced motion, pausable motion, form errors. Must stay green; /accessibility describes these checks, so update it if they change.
- Replays: `python -m personalab.replay save <run-id> --name <name>` copies a finished run (data + step screenshots) from a running server into `web/public/replays/`; `/replay` plays it back with no AI calls. Real runs only.
- Evals: `python -m personalab.evals baseline` (rules only) · `python -m personalab.evals agents --label v1` (uses ANTHROPIC_API_KEY)
- Setup: `pip install -r requirements.txt && playwright install chromium`, `cd web && npm install`, copy `.env.example` to `.env`

## Architecture
- `personalab/journey.py`: personas, persona-limited tools, Claude tool-use loop, `JourneyManager` (parallel runs, groups = all 4 personas on one task), token/visited tracking.
- `personalab/journey_helper.js`: injected into pages; focus info, screen-reader linear text view (`srLines`), clickable targets, unreachable-clickable detection.
- `personalab/evals.py`: benchmark runner, scoring (barrier recall/precision, outcome accuracy, verified success, false success, cost), keyword matcher + optional LLM judge, rules baseline, CLI.
- `benchmark/sites/*` + `benchmark/ground_truth.json`: 4 sites (hotel, shop, clinic, accessible library control), 12 planted barriers, 5 tasks with per-persona `possible` and objective `success` checks.
- `personalab/replay.py` + `web/src/lib/replay.ts`: recorded demo runs; `timeline()`/`snapshot()` rebuild the live run view at any moment, keeping each agent's real relative pace. `PAIRS` (before/after replays of one task) feed `/compare`.
- Showcase build (`NEXT_PUBLIC_SHOWCASE=1`, `npm run build:showcase`, deployed free on Vercel with Root Directory `web`): static, no server. `api()` in `web/src/lib/api.ts` serves personas/evals from `web/public/data` (written by `python -m personalab.showcase`; `tests/test_showcase.py` keeps it in sync) and refuses live-test calls with `LIVE_ONLY`; Nav, home and Missing swap the API key/test form for "Run it yourself" (GitHub).
- `personalab/pricing.py`: $ per run from token counts (Opus 5.5 prices built in, `PRICE_*` env overrides; unknown model → no number). Runs, replays and evals report it.
- Errors: `journey.explain_error` turns Claude API failures (no credits, bad key, rate limit, overload) into plain sentences; when every agent errored, RunView says the test couldn't run instead of showing a score.
- `personalab/server.py`: Flask API (`/api/run`, `/api/journey/<id>`, `/api/evals`, `/api/demos`); `guard.py`: PUBLIC_MODE SSRF guard + per-IP and site-wide daily limits; `export.py`: HTML reports.
- `web/`: Next.js 16 (App Router) + TypeScript + Tailwind v4, **static export** (`output: "export"` → `web/out`) served by Flask's catch-all route, so the app stays one container on one origin. Next 16 differs from older versions: read `web/node_modules/next/dist/docs/` before using a Next API (see `web/AGENTS.md`). Color tokens live in `src/app/globals.css` (CSS variables, light + dark) and are exposed as Tailwind colors (`bg-surface`, `text-ink-2`, `border-edge`, `bg-lime`, …); text on a pop color uses `text-on-pop` so it stays dark in dark mode. Pages are thin server files exporting `metadata` + a `*Client.tsx` client component. History lives in IndexedDB (`src/lib/history.ts`); `GET /api/run/<id>/export.json` is the record format it stores and imports.

## Conventions
- Keep the UI accessible (it's an accessibility product): real buttons, labels, visible focus, no color-only meaning, works at 390px wide. The app's own persona checks should stay clean (axe-core scored 100 on every page after the Next.js migration).
- Static export rules: no server-only Next features (rewrites/redirects/headers in production, server actions, dynamic routes without params); use query strings (`/run?id=`) and wrap `useSearchParams` in `<Suspense>`.
- Agent API calls (`JourneyRunner._ask`): keep `messages` **append-only**. Never rewrite earlier turns (e.g. stripping old screenshots): on current models the preserved-thinking check returns 400 for accounts created after 2026-08-31, and it breaks prompt caching. Old tool results are cleared server-side via context editing (`CLEAR_OLD_RESULTS`). `tests/test_journey.py::test_requests_are_append_only_cached_and_context_managed` guards this. Effort comes from `CLAUDE_EFFORT` and is saved with eval runs.
- Motion: keyframes live in `globals.css` `@theme` (Tailwind drops unused ones, so keyframes used only from inline styles go outside it, like `confetti`). Everything must still work under `prefers-reduced-motion` (a global rule turns animation off; `.reveal` content shows at once). Moving or decorative pieces are `aria-hidden`, and anything that keeps moving gets a pause control. "See it like them" (`SimBar.tsx`) filters only elements marked `data-sim-target`. If CSS changes don't show up after a build, delete `web/.next` (a stale Turbopack cache).
- When changing ground truth, keep the benchmark consistent (`tests/test_evals.py::test_benchmark_is_consistent`).

## Status (Oct 31, 2026)
- Done: personas, live 2×2 run view, verdict + merged barriers, step drawer, HTML reports, evals harness + dashboard, real rules-only baseline (built-in rules: 50% recall, 100% precision).
- Done since: History (IndexedDB) + downloads (HTML/PDF/CSV/JSON, JSON import); frontend migrated to Next.js + TypeScript + Tailwind.
- Not yet done: first **real agent eval run** (needs API key), a real Docker build (no Docker on the dev Mac; steps were replicated locally). Deploy: free static showcase on Vercel; full live app needs a paid host (Render Blueprint, or a Hugging Face Docker Space via `scripts/deploy-hf.sh`, which needs PRO).
- Ideas next: prompt v2 and show measured improvement on /evals; "Fix & Prove" (agent patches the page and re-runs the journey); CI action; more benchmark sites + repeated runs for variance; LLM-judge agreement vs human labels.
