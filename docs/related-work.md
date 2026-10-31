# Related work and positioning

Web search notes from Oct 31, 2026. These are findings from search results, not a full literature
review. Read the sources before quoting them in the README or in interviews.

## Verdict

The core idea (AI agents test a website as a keyboard-only or screen-reader user) **already exists**.
What sets Persona Lab apart is:

1. **Visual personas.** No tool found has a color-blind agent that sees a CVD-simulated screen, or a
   low-vision agent that sees the page at 200% zoom, blurred and with lower contrast. Existing tools stop
   at keyboard and screen reader.
2. **An eval suite with ground truth.** Planted barriers, an accessible control site, objective success
   checks, a false-success rate and a rules-only baseline. Existing tools output findings but don't
   measure whether the agent is right.
3. **Results framed around people:** "3 of 4 people could book a room" instead of a list of WCAG violations.

## Tools

| Project | What it does | Overlap with Persona Lab |
|---|---|---|
| [keyboard-a11y-tester](https://github.com/ezufelt/keyboard-a11y-tester) (ezufelt) | An AI drives a real browser as a keyboard-only user and an emulated screen-reader user; reports evidence-linked WCAG findings | Closest match: same idea for 2 of the 4 personas. No visual personas, no benchmark |
| [Accessibility AI Agent](https://github.com/ksmuvva/Accessiblity_AI_Agent) (ksmuvva) | OpenAI Agents SDK + Playwright + axe-core, optional real NVDA on Windows | Agent + browser + rules. Notes that emulated screen-reader results don't replace real assistive tech |
| [accessibility-skills](https://github.com/zivtech/accessibility-skills) (zivtech) | Claude Code skills: Playwright keyboard tests, axe-core, screen-reader reviews, bug reports, draft ACRs | Audit workflow for developers, not persona journeys |
| [BrowserStack: AI accessibility testing tools](https://www.browserstack.com/accessibility-testing/ai-accessibility-testing-tools) | Overview of commercial tools | Mostly rule scanners with AI added |

## Research

- [UXAgent](https://arxiv.org/pdf/2502.12561): LLM agents with personas simulate users for usability
  testing on live websites. Not specific to disability.
- [Targeted Interaction Agents for Web Accessibility Evaluation](https://faculty.washington.edu/wobbrock/pubs/uist-26.01.pdf)
  (Zhong et al., UIST 2026): **probably the closest research.** Only the title was seen; read the paper
  before claiming anything is novel.
- [From Blind Edits to Verified Repair](https://arxiv.org/abs/2608.24913) (arXiv 2608.24913): user-side
  LLM agents that repair pages, with checks that the repair worked. Relevant to the "Fix & Prove" idea.
- [AccessEval](https://arxiv.org/html/2509.22703v1): benchmarks disability bias in LLM answers
  (21 models, 9 disability types). About model responses, not agents browsing sites.
- [Tabular Accessibility Dataset](https://doi.org/10.3390/data10090149): benchmark for LLM-based
  WCAG auditing of table components.
- [WebAccessBench](https://conesible.de/wab/whitepaper_webaccessbench.pdf): accessibility of
  LLM-*generated* interfaces.

## Supporting points

- [Salesforce: AI Agents Don't Live with Disabilities](https://www.salesforce.com/blog/accessible-ai-experiences/):
  automated checks need to be paired with manual keyboard and screen-reader testing.
- A reported study (via [SitePoint](https://www.sitepoint.com/how-ai-agents-are-making-accessibility-a-business-critical-development-priority/))
  says Claude Sonnet 4.5's task success fell from about 78% to 42% when it could only use the keyboard.
  This is a secondary source and the original study wasn't checked, so don't cite the number without verifying it.

## Weaknesses to fix

- **No agent results yet.** /evals shows only the rules-only baseline. Run
  `python -m personalab.evals agents --label v1` first.
- **The benchmark is small and self-built** (20 cases). Add repeated runs for variance and a few real
  sites with expert-labelled barriers.
- **Add a "Related work" section to the README** naming these projects and what Persona Lab adds.
- The old See It Your Way README calls Persona Journey "unique". That isn't accurate.
