// Evals dashboard: reads evals/results/*.json through /api/evals.
"use strict";

const PNAME = { keyboard: "Keyboard only", screen_reader: "Screen reader", color_blind: "Color-blind", low_vision: "Low vision" };
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
let RESULTS = [];

function tile(k, v, d) {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="d">${esc(d)}</div></div>`;
}

function bars(rows) {
  // Single series: one color, value direct-labelled, name on the left; hover shows the exact value.
  return rows.map((r) => `
    <li class="bar-row" title="${esc(r.name)}: ${r.v == null ? "n/a" : pct(r.v)}${r.note ? " · " + esc(r.note) : ""}">
      <span class="name">${esc(r.name)}${r.small ? `<small>${esc(r.small)}</small>` : ""}</span>
      <span class="bar-track" role="img" aria-label="${esc(r.name)}: ${r.v == null ? "not measured" : pct(r.v)}">
        <span class="bar-fill" style="width:${r.v == null ? 0 : Math.max(1, r.v * 100)}%"></span></span>
      <span class="val">${pct(r.v)}</span>
    </li>`).join("");
}

function render(id) {
  const r = RESULTS.find((x) => x.id === id) || RESULTS[0];
  const m = r.metrics;
  $("#run-meta").textContent = `${r.kind === "baseline" ? `Engine: ${r.engine}` : `Model: ${r.model}`} · ${new Date(r.created_at).toLocaleString()}`;

  $("#tiles").innerHTML = r.kind === "agents"
    ? tile("Barrier recall", pct(m.barrier_recall), "planted barriers found")
      + tile("Precision", pct(m.precision), `of ${m.findings} findings were real`)
      + tile("Right verdict", pct(m.outcome_accuracy), "correct call: can this person finish?")
      + tile("False success", pct(m.false_success_rate), "claimed done, but wasn't (lower is better)")
    : tile("Barrier recall", pct(m.barrier_recall), "planted barriers found by page rules")
      + tile("Precision", pct(m.precision), `of ${m.findings} findings were real`)
      + tile("Right verdict", "n/a", "rules can't tell if a person can finish a task")
      + tile("Cost", "~0", "no AI calls");

  const hasAgents = RESULTS.some((x) => x.kind === "agents");
  $("#callout").innerHTML = hasAgents ? "" : `
    <div class="callout"><h2>No agent runs yet</h2>
    <p class="small muted">Only the rules-only baseline has been run so far. Score the persona agents with your API key:
    <code>python -m personalab.evals agents --label v1</code>. Results appear here automatically.</p></div>`;

  $("#cmp-bars").innerHTML = bars(RESULTS.slice(0, 8).map((x) => ({
    name: x.label, small: x.kind === "baseline" ? x.engine : x.model, v: x.metrics.barrier_recall,
  })));

  if (r.kind === "agents") {
    $("#pp-sub").textContent = "Planted barriers each persona was expected to hit, and found.";
    const order = ["keyboard", "screen_reader", "color_blind", "low_vision"];
    $("#pp-bars").innerHTML = bars(Object.entries(r.per_persona).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([p, s]) => ({
      name: PNAME[p] || p, v: s.recall, note: `verdict accuracy ${pct(s.outcome_accuracy)}`,
    })));
  } else {
    $("#pp-sub").textContent = "Not applicable: page rules don't simulate people. Run the agents to see this.";
    $("#pp-bars").innerHTML = "";
  }

  // detection matrix: rows = planted barriers, columns = up to 4 most recent runs
  const cols = RESULTS.slice(0, 4);
  const hit = (run, bid) => (run.barriers || []).find((b) => b.id === bid)?.detected;
  $("#matrix").innerHTML = `
    <thead><tr><th scope="col">Planted barrier</th><th scope="col">Affects</th>${cols.map((c) => `<th scope="col" class="c">${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${r.barriers.map((b) => `
      <tr><th scope="row" style="font-weight:500">${esc(b.summary)}<div class="small muted">${esc(b.site)} · WCAG ${esc(b.wcag)}</div></th>
      <td class="small muted">${b.personas.map((p) => esc(PNAME[p] || p)).join(", ")}</td>
      ${cols.map((c) => hit(c, b.id) ? '<td class="c yes">✓ <span class="sr-only">found</span></td>' : '<td class="c no">– <span class="sr-only">missed</span></td>').join("")}</tr>`).join("")}
    </tbody>`;

  // outcome table (agent runs only; loads the full result for per-journey rows)
  $("#outcomes-card").hidden = r.kind !== "agents";
  if (r.kind === "agents") {
    api(`/api/evals/${r.id}`).then((full) => {
      const ok = (b) => (b ? '<span class="yes">✓ yes</span>' : '<span class="no">✕ no</span>');
      $("#outcomes").innerHTML = `
        <thead><tr><th scope="col">Task</th><th scope="col">Persona</th><th scope="col">Possible?</th><th scope="col">Agent said</th><th scope="col">Verified</th><th scope="col" class="c">Steps</th></tr></thead>
        <tbody>${full.journeys.map((j) => `<tr>
          <td>${esc(j.task)}</td><td>${esc(PNAME[j.persona] || j.persona)}</td><td>${ok(j.possible)}</td>
          <td>${j.error ? '<span class="no">error</span>' : (j.claimed ? "completed" : "stuck")}${!j.error && j.claimed !== j.possible ? ' <span style="color:var(--bad)">(wrong)</span>' : ""}</td>
          <td>${ok(j.verified)}</td><td class="c">${j.steps}</td></tr>`).join("")}</tbody>`;
    }).catch(() => {});
  }
}

(async function init() {
  try { RESULTS = await api("/api/evals"); } catch { RESULTS = []; }
  if (!RESULTS.length) {
    $("#tiles").innerHTML = "";
    $("#callout").innerHTML = `<div class="callout"><h2>No results yet</h2><p class="small muted">Run <code>python -m personalab.evals baseline</code> and <code>python -m personalab.evals agents --label v1</code>.</p></div>`;
    return;
  }
  const sel = $("#run-select");
  sel.innerHTML = RESULTS.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}${r.kind === "baseline" ? " (baseline)" : ""}</option>`).join("");
  const firstAgent = RESULTS.find((r) => r.kind === "agents");
  sel.value = (firstAgent || RESULTS[0]).id;
  sel.addEventListener("change", () => render(sel.value));
  render(sel.value);
})();
