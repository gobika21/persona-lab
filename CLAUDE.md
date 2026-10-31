# Persona Lab: notes for Claude Code

## What this is
Portfolio project for **AI/ML engineer** roles. One idea: AI agents that test a website the way
disabled people browse it (keyboard only, blind screen-reader user, color-blind, low vision at 200% zoom),
plus an **evaluation suite** that measures whether the agents can be trusted. Public demo, no login.

The owner wants: one focused story, a clean & minimal design (Linear/Vercel style), and measured results
(never invent eval numbers: only real runs go in `evals/results/`).

## Commands
- Run app: `python run.py` → http://localhost:5000 (evals dashboard at /evals, demo sites at /bench/<site>/)
- Tests: `pytest -q` (a scripted fake Claude drives real Chromium; no API key needed)
- Evals: `python -m personalab.evals baseline` (rules only) · `python -m personalab.evals agents --label v1` (uses ANTHROPIC_API_KEY)
- Setup: `pip install -r requirements.txt && playwright install chromium`, copy `.env.example` to `.env`

## Architecture
- `personalab/journey.py`: personas, persona-limited tools, Claude tool-use loop, `JourneyManager` (parallel runs, groups = all 4 personas on one task), token/visited tracking.
- `personalab/journey_helper.js`: injected into pages; focus info, screen-reader linear text view (`srLines`), clickable targets, unreachable-clickable detection.
- `personalab/evals.py`: benchmark runner, scoring (barrier recall/precision, outcome accuracy, verified success, false success, cost), keyword matcher + optional LLM judge, rules baseline, CLI.
- `benchmark/sites/*` + `benchmark/ground_truth.json`: 4 sites (hotel, shop, clinic, accessible library control), 12 planted barriers, 5 tasks with per-persona `possible` and objective `success` checks.
- `personalab/server.py`: Flask API (`/api/run`, `/api/journey/<id>`, `/api/evals`, `/api/demos`); `guard.py`: PUBLIC_MODE SSRF guard + per-IP limits; `export.py`: HTML reports.
- `static/`: vanilla HTML/CSS/JS, no build step. `index.html`+`app.js` (run page), `evals.html`+`evals.js`, shared `common.js`, `style.css` (tokens + dark mode).

## Conventions
- Keep the UI accessible (it's an accessibility product): real buttons, labels, visible focus, no color-only meaning, works at 390px wide. The app's own persona checks should stay clean.
- When changing ground truth, keep the benchmark consistent (`tests/test_evals.py::test_benchmark_is_consistent`).

## Status (Oct 31, 2026)
- Done: personas, live 2×2 run view, verdict + merged barriers, step drawer, HTML reports, evals harness + dashboard, real rules-only baseline (built-in rules: 50% recall, 100% precision).
- Not yet done: first **real agent eval run** (needs API key), Docker build test, deployment.
- Ideas next: prompt v2 and show measured improvement on /evals; "Fix & Prove" (agent patches the page and re-runs the journey); CI action; more benchmark sites + repeated runs for variance; LLM-judge agreement vs human labels.
