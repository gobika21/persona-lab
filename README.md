# Persona Lab

**AI agents that test a website the way disabled people actually use it, plus an evaluation suite that measures whether those agents can be trusted.**

Give it a website and a task ("book a room"). Four Claude agents attempt the task in a real browser, each limited to the senses and controls of one person:

| Persona | Perceives | Can do |
|---|---|---|
| Keyboard only | The screen, plus which element has focus and whether a focus indicator is visible | Tab, Shift+Tab, Enter, Space, arrows, Escape, typing |
| Screen reader | **Never sees the page.** A linear text rendering like a screen reader's browse mode (headings, links, buttons, labels, alt text) | read, list headings/links/fields, find, activate, type |
| Color-blind | A red-green color-vision simulation of the screen (Machado 2009) with numbered click targets | look, click, type, scroll |
| Low vision | The page at 200% zoom, blurred and lower contrast | look, click, type, scroll |

The result is one line, *"3 of 4 people could book a room"*, followed by what blocked whom, with fixes. Each agent's run can be replayed step by step.

## Why it's interesting (AI/ML engineering)

- **Constrained-perception agents.** The interesting design work is in what each agent is *not* allowed to see or do. The screen-reader agent gets an accessibility-tree-style text view, never pixels; the visual personas get image transforms; the keyboard agent has no pointer.
- **An evaluation harness, not just a demo.** `benchmark/` holds four small sites with **12 planted barriers** and **5 tasks** whose outcome per persona is known (20 task × persona cases). One site is fully accessible, as a false-positive control.
- **Objective outcome checks.** Success is verified from the pages the agent reached or the answer it gave, so an agent that *claims* success without achieving it is caught (false-success rate).
- **Baseline comparison.** The same benchmark is scored with rules-only page checks (axe-core, or built-in rules). Rules alone find the page-level problems (missing alt text, unnamed buttons, low contrast) but not the experience-level ones: a mouse-only "Book" button, color-only product variants, a day picker you can't reach by keyboard.
- **Cost and reliability tracking.** Every run records steps, LLM calls, tokens and wall time, and optionally $ cost, so prompt or model changes can be compared on quality *and* cost.

### Metrics

| Metric | Meaning |
|---|---|
| Barrier recall | planted barriers found (also per persona) |
| Precision | reported findings that correspond to a planted barrier |
| Right verdict | agent correctly concluded whether this person *can* complete the task |
| Verified success | task objectively completed when it was possible |
| False success | agent claimed success but the objective check failed |
| Cost | steps, LLM calls, tokens, seconds (and $ if prices are set) |

Current results are in `evals/results/` and shown at **/evals**. The repo ships only the **rules-only baseline** (built-in rules: 50% recall, 100% precision). Agent results appear after you run the agents, so no numbers here are made up.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env                                   # add ANTHROPIC_API_KEY
(cd web && npm install && npm run build)               # Next.js frontend -> web/out (Node 20+)
PORT=5050 python run.py                                # http://localhost:5050
```

Try one of the suggested real websites on the home page, or any public website. (On macOS, port 5000 is usually taken by AirPlay Receiver, hence `PORT=5050`.)

`python run.py` serves the production build, so code changes need a rebuild and a restart. While developing, use live reload instead:

```bash
python dev.py                                          # http://localhost:3000: Flask on 5050 (reloads on Python changes) + next dev
```

### Evaluate

```bash
python -m personalab.evals baseline                       # rules-only, no API key needed
python -m personalab.evals agents --label "v1 prompt"     # all 20 cases, uses the Claude API
python -m personalab.evals agents --label "v2" --tasks hotel-book shop-green-mug --personas keyboard
python -m personalab.evals agents --label "v2 judged" --judge   # LLM-as-judge finding matcher
```

Change a prompt, a persona's tools or `CLAUDE_MODEL`, re-run, and compare runs on the /evals page.

### Tests

```bash
pytest -q
```

The tests use a scripted fake Claude client to drive **real Chromium** through the benchmark sites, so the agent loop, persona perception, scoring and API are all tested without an API key.

## Deploy (public demo, no login)

**Free showcase (static, no server):** recorded replays, before/after and evals, with no AI calls, so it costs nothing
to host or to visit. On Vercel: New Project > import the repo > set Root Directory to `web` > Deploy (`web/vercel.json`
runs `npm run build:showcase`). Any static host works: `cd web && npm run build:showcase` writes `web/out`. The data comes
from `python -m personalab.showcase` (`web/public/data`, kept in sync by `tests/test_showcase.py`); re-run it after new
eval results, and record replays as below. Live tests need the full app (one of the options below).

**Hugging Face Spaces (Docker Spaces need a PRO subscription):** log in once with `hf auth login` (a token with write access), then

```bash
scripts/deploy-hf.sh <hf-username>/persona-lab
```

It creates a Docker Space if needed and uploads exactly what is committed (never `.env`), with the Space settings added
to the uploaded README. A Space sleeps after a while without visitors and takes a minute to wake. Add `ANTHROPIC_API_KEY` as a Space secret only if visitors should run on your key.

**On Render (paid Starter plan):** push to GitHub, then in Render choose New > Blueprint and pick the repo; `render.yaml` sets everything up.
Set `ANTHROPIC_API_KEY` in the Render dashboard if you want visitors to get free runs on your key (capped per day, below);
leave it unset and visitors use their own key. The `starter` plan is needed: headless Chromium wants about 1 GB RAM.

Or with Docker anywhere:

```bash
docker build -t persona-lab . && docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... persona-lab
```

The Dockerfile builds the Next.js frontend in a Node stage and copies the static export into the Python image, so it's still one container serving one origin.

`PUBLIC_MODE=1` (set in the Dockerfile) blocks private/internal addresses for the typed URL and for every request the page makes (SSRF protection), and gives each visitor a small free daily allowance (`LIMIT_JOURNEY`, default 12 agent runs = 3 tests), with a site-wide daily cap on your key (`LIMIT_SITE_JOURNEY`, default 40 = 10 tests) so a shared link can't run up your bill. Visitors can paste their own Anthropic key with the API key button; it stays in their browser. `render.yaml` deploys to Render as a Blueprint. Chromium needs about 1 GB RAM. State is in memory, so run one worker (the Dockerfile does).

**Demo replays.** Visitors without a key can watch a real recorded run at `/replay`. To record one: do a run in the app, then
`python -m personalab.replay save <run-id> --name hotel-book` (the id is in the run page's address) and rebuild the frontend.
It writes `web/public/replays/` (the run data plus small screenshots, which ship with the image). Only record real runs.
Record the same task on two versions of a site as `w3c-before` and `w3c-after` and `/compare` shows them side by side:
who could do it before and after, and which barriers the fix removed (pairs are listed in `web/src/lib/replay.ts`).

**Cost.** Every run reports what it cost, from the real token counts at the model's API prices (`personalab/pricing.py`;
`PRICE_*` env vars override them). For example, the recorded Wikipedia test (four agents, 14 steps) cost $0.14 on Claude Opus 5.5.

## Layout

```
personalab/
  journey.py          persona definitions, persona-limited tools, agent loop, parallel runs
  journey_helper.js   injected into pages: focus info, screen-reader text view, click targets
  evals.py            benchmark runner, scoring, rules baseline, CLI
  colorlab.py         color-vision simulation used by the visual personas
  sitecheck.py        page rules (axe-core / built-in) used by the baseline
  guard.py            SSRF guard, rate limits, concurrency caps
  pricing.py          $ cost of a run from its token counts
  replay.py           records finished runs as static demo replays
  showcase.py         exports read-only API data for the static showcase build
  export.py           single-file HTML reports
  server.py           Flask app + JSON API; serves the built frontend
benchmark/
  sites/              hotel, shop, clinic, library (accessible control)
  ground_truth.json   tasks, per-persona outcomes, planted barriers + matching rules
evals/results/        one JSON per evaluation run
web/                  Next.js 16 + TypeScript + Tailwind CSS v4, built as a static export (web/out)
  src/app/            pages: / (test a site), /run, /saved, /history, /evals
  src/components/     Nav (+ API key dialog), RunView (agents, barriers, steps drawer), DownloadMenu
  src/lib/            typed API client, History (IndexedDB) + downloads, barrier merging, personas
```

## Related work

AI agents that test a site as a keyboard-only or screen-reader user already exist, notably
[keyboard-a11y-tester](https://github.com/ezufelt/keyboard-a11y-tester),
[Accessibility AI Agent](https://github.com/ksmuvva/Accessiblity_AI_Agent) and
[zivtech/accessibility-skills](https://github.com/zivtech/accessibility-skills). On the research side,
[UXAgent](https://arxiv.org/abs/2502.12561) simulates users with persona agents for usability testing, and
[Zhong et al. (UIST 2026)](https://faculty.washington.edu/wobbrock/pubs/uist-26.01.pdf) study interaction agents for accessibility evaluation.

Persona Lab adds:

- **Visual personas:** a color-blind agent that sees a color-blindness simulation of the screen, and a low-vision agent that sees the page zoomed, blurred and at lower contrast, alongside the keyboard and screen-reader personas.
- **A scored benchmark:** planted barriers, an accessible control site, objective outcome checks and a false-success rate, so the agents themselves are evaluated, not just their findings.

More notes are in [`docs/related-work.md`](docs/related-work.md).

## Limitations and next steps

- The benchmark is small (12 barriers, 20 cases) and hand-built. Next: more sites, real-world sites with expert-labelled barriers, and repeated runs to report variance.
- Keyword matching of findings is strict and transparent; `--judge` trades that for leniency. Next: measure judge agreement against human labels.
- The personas are simulations, not people. Results should guide, not replace, testing with disabled users.
- Next: **Fix & Prove** (the agent patches the page and re-runs the journey) and a CI action that fails a build when a persona can no longer complete a key flow.
