// Persona Lab: start a test, watch four agents live, read the verdict, come back to it in History.
"use strict";

const run = { id: null, data: null, timer: null, drawer: null, saved: null, shots: {} };
const ORDER = ["keyboard", "screen_reader", "color_blind", "low_vision"];
const SEV = { blocker: ["!", "Blocker"], serious: ["▲", "Serious"], minor: ["•", "Minor"] };
const VERB = {
  open: "Opened the page", press_key: "Pressed", type_text: "Typed", type_into: "Typed into", click: "Clicked", activate: "Activated",
  read_page: "Read the page", list_elements: "Listed", find_text: "Searched for", scroll: "Scrolled", look: "Looked at the screen",
  go_back: "Went back", report_barrier: "Hit a barrier", finish: "Finished",
};
const TITLE = document.title;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return iso || ""; } };

// ---------------------------------------------------------------- start view
async function initStart() {
  try {
    const personas = await api("/api/personas");
    $("#personas").innerHTML = ORDER.map((id) => personas.find((p) => p.id === id)).filter(Boolean).map((p) => `
      <article class="persona">
        <div class="ico">${ICONS[p.id]}</div>
        <h3>${esc(p.label)}</h3>
        <p>${esc(p.who)}</p>
        <p class="perceives">${esc(PERCEIVES[p.id])}</p>
      </article>`).join("");
  } catch {}

  try {
    const demos = await api("/api/demos");
    const names = { hotel: "Sunset Hotel", shop: "Kiln & Co. shop", clinic: "Marina Clinic", library: "Al Safa Library" };
    const picks = ["hotel-book", "shop-green-mug", "clinic-book"];
    demos.filter((d) => picks.includes(d.id)).forEach((d) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip";
      const short = { "hotel-book": "Book a room", "shop-green-mug": "Buy the green mug", "clinic-book": "Book a doctor" };
      b.innerHTML = `<b>${esc(names[d.site] || d.site)}</b> · ${esc(short[d.id] || d.goal)}`;
      b.addEventListener("click", () => { $("#url").value = d.path; $("#goal").value = d.goal; $("#run-btn").focus(); });
      $("#demos").appendChild(b);
    });
  } catch {}

  try {
    const results = await api("/api/evals");
    const base = results.find((r) => r.kind === "baseline");
    const agent = results.find((r) => r.kind === "agents");
    const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
    const tiles = [];
    if (base) tiles.push(["Rules-only checks", pct(base.metrics.barrier_recall), "of planted barriers found by page rules alone"]);
    if (agent) {
      tiles.push(["Persona agents", pct(agent.metrics.barrier_recall), `of planted barriers found (${esc(agent.label)})`]);
      tiles.push(["Right verdict", pct(agent.metrics.outcome_accuracy), "correct call on whether each person can finish"]);
    } else {
      tiles.push(["Benchmark", "12", "planted barriers across 4 demo sites"], ["Tasks", "5 × 4", "tasks × personas with known outcomes"]);
    }
    if (tiles.length) {
      $("#proof-stats").innerHTML = tiles.map(([k, v, d]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
      $("#proof").hidden = false;
    }
  } catch {}

  $("#run-form").addEventListener("submit", (e) => { e.preventDefault(); startRun(); });
}

async function startRun() {
  const url = $("#url").value.trim(), goal = $("#goal").value.trim(), msg = $("#form-msg");
  msg.classList.remove("error");
  if (!url || !goal) { msg.textContent = !url ? "Enter a website address." : "Describe the task, e.g. “Book a room”."; msg.classList.add("error"); (!url ? $("#url") : $("#goal")).focus(); return; }
  $("#run-btn").disabled = true; msg.textContent = "Starting four browsers…";
  try {
    const g = await api("/api/run", { method: "POST", body: { url, goal } });
    history.pushState({}, "", `#run=${g.id}`);
    showRun(g);
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  } finally { $("#run-btn").disabled = false; }
}

// ---------------------------------------------------------------- views
function setView(name) {
  ["start", "run", "history"].forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
  const inHistory = name === "history" || (name === "run" && run.saved);
  $(inHistory ? "#nav-history" : "#nav-test").setAttribute("aria-current", "page");
  $(inHistory ? "#nav-test" : "#nav-history").removeAttribute("aria-current");
  if (name !== "run") { run.id = null; run.saved = null; clearTimeout(run.timer); }
  document.title = name === "history" ? "History: Persona Lab" : TITLE;
}

// ---------------------------------------------------------------- run view
// `saved` is a History entry when reopening a finished test from this browser (no polling, local screenshots).
function showRun(g, saved = null, files = null) {
  Object.values(run.shots).forEach((u) => URL.revokeObjectURL(u));
  run.shots = {};
  if (saved && files && files.shots) for (const [jid, blob] of Object.entries(files.shots)) run.shots[jid] = URL.createObjectURL(blob);
  run.saved = saved;
  setView("run");
  run.id = g.id; run.data = g;
  $("#run-task").textContent = g.goal;
  $("#run-url").textContent = g.url;
  const back = $("#back");
  back.href = saved ? "#history" : "/";
  back.lastChild.textContent = saved ? " All saved tests" : " New test";
  $("#dl-slot").innerHTML = "";
  $("#saved-note").innerHTML = saved
    ? `Saved test from ${esc(fmtDate(saved.run_at || saved.saved_at))}${saved.imported ? " (imported from a file)" : ""}.`
    : "";
  $("#barriers").hidden = true;
  $("#agents").innerHTML = ORDER.map((p) => g.members.find((m) => m.persona === p)).filter(Boolean).map((m) => `
    <article class="agent" data-id="${m.id}" aria-labelledby="h-${m.id}">
      <div class="agent-head">
        <span class="ico">${ICONS[m.persona]}</span>
        <h3 id="h-${m.id}">${esc(m.persona_label)}</h3>
        <span class="pill" data-role="pill"></span>
      </div>
      <div class="screen" data-role="screen"><div class="skeleton"></div></div>
      <div class="agent-foot">
        <p class="thought" data-role="thought"></p>
        <div class="agent-meta"><span data-role="meta"></span><button type="button" class="btn btn-sm" data-role="steps">View steps</button></div>
      </div>
    </article>`).join("");
  document.querySelectorAll(".agent [data-role=steps]").forEach((b) => b.addEventListener("click", () => openDrawer(b.closest(".agent").dataset.id)));
  window.scrollTo({ top: 0 });
  render(g);
  clearTimeout(run.timer);
  if (!saved) poll();
}

async function poll() {
  const id = run.id;
  try {
    const g = await api(`/api/run/${id}`);
    if (id !== run.id) return;
    run.data = g; render(g);
    if (run.drawer) refreshDrawer();
    if (g.finished) { refreshStatus(); autoSave(g); return; }
  } catch (err) {
    $("#verdict").innerHTML = `<span class="txt" style="color:var(--bad)">${esc(err.message)}</span>`;
    return;
  }
  run.timer = setTimeout(poll, 1500);
}

// Keep every finished run in this browser: the data, the HTML report and each agent's last screenshot.
async function autoSave(g) {
  if (!g.members.some((m) => m.status !== "error")) return;  // nothing ran (e.g. a bad key): not worth keeping
  const note = $("#saved-note");
  try {
    if (await History.get(g.id)) { if (run.id === g.id) note.innerHTML = 'Saved in your <a href="#history">History</a>.'; return; }
    const record = await api(`/api/run/${g.id}/export.json`);
    const report_html = await fetch(`/api/run/${g.id}/report.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    const shots = {};
    for (const m of g.members) {
      if (!m.shot) continue;
      const r = await fetch(`/api/journey/${m.id}/shot/${m.shot}.jpg`).catch(() => null);
      if (r && r.ok) shots[m.id] = await r.blob();
    }
    await History.put(historyEntry(record, mergeBarriers(record.run).length), { report_html, shots });
    if (run.id === g.id) note.innerHTML = 'Saved in your <a href="#history">History</a> (this browser only).';
  } catch {
    if (run.id === g.id) note.textContent = "Couldn't save this test to History; your browser may be blocking storage. Use Download to keep a copy.";
  }
}

const goalPhrase = (g) => g.goal.charAt(0).toLowerCase() + g.goal.slice(1);
const isDone = (m) => ["done", "error", "stopped"].includes(m.status);

function render(g) {
  const done = g.members.filter(isDone).length;
  $("#progress-bar").style.width = `${Math.max(4, (done / g.total) * 100)}%`;
  $(".progress").hidden = g.finished;
  $("#stop-btn").hidden = g.finished;
  if (g.finished && !$("#dl-slot").firstChild) $("#dl-slot").innerHTML = dlMenu(g.id);

  $("#verdict").innerHTML = g.finished
    ? `<span class="num ${g.completed === g.total ? "all" : "some"}">${g.completed} of ${g.total}</span>
       <span class="txt">people could ${esc(goalPhrase(g))}.${g.completed < g.total ? ` <span class="muted">${esc(stuckList(g))}</span>` : ""}</span>`
    : `<span class="txt">${g.total} agents are trying to ${esc(goalPhrase(g))}… <span class="muted">${done} of ${g.total} finished</span></span>`;

  g.members.forEach((m) => {
    const card = document.querySelector(`.agent[data-id="${m.id}"]`);
    if (!card) return;
    const pill = card.querySelector("[data-role=pill]");
    if (m.status === "error") { pill.className = "pill bad"; pill.innerHTML = '<span aria-hidden="true">!</span> Couldn\'t run'; }
    else if (!isDone(m)) { pill.className = "pill"; pill.innerHTML = '<span class="dot" aria-hidden="true"></span> Trying'; }
    else if (m.success) { pill.className = "pill ok"; pill.innerHTML = '<span aria-hidden="true">✓</span> Completed'; }
    else { pill.className = "pill bad"; pill.innerHTML = `<span aria-hidden="true">✕</span> ${m.status === "stopped" ? "Stopped" : "Got stuck"}`; }

    const last = m.last || {};
    const thought = m.status === "error" ? m.error : isDone(m) ? (m.summary || "") : (last.thought || m.current || "Starting…");
    card.querySelector("[data-role=thought]").textContent = thought ? (isDone(m) || m.status === "error" ? thought : `“${thought}”`) : "";
    card.querySelector("[data-role=meta]").textContent = `${m.steps} steps · ${m.barriers} barrier${m.barriers === 1 ? "" : "s"}`;

    const screen = card.querySelector("[data-role=screen]");
    const key = m.persona === "screen_reader" ? `t${(last.heard || "").length}` : `s${m.shot}`;
    if (screen.dataset.key === key) return;
    screen.dataset.key = key;
    const src = run.saved ? run.shots[m.id] : m.shot && `/api/journey/${m.id}/shot/${m.shot}.jpg`;
    if (m.persona === "screen_reader" && last.heard) {
      screen.innerHTML = `<div class="term"><span class="label">Screen reader output</span>${esc(last.heard.replace(/ \[ref \d+\]/g, "").slice(0, 900))}</div>`;
    } else if (m.persona === "screen_reader") {
      screen.innerHTML = `<div class="term"><span class="label">Screen reader output</span>${esc(last.result || "Listening…")}</div>`;
    } else if (src) {
      screen.innerHTML = `<img src="${esc(src)}" alt="What the ${esc(m.persona_label.toLowerCase())} sees at step ${m.shot}">`;
    } else if (run.saved) {
      screen.innerHTML = '<p class="noshot">No screenshot saved for this test.</p>';
    }
  });

  if (g.finished) renderBarriers(g);
}

function stuckList(g) {
  const stuck = g.members.filter((m) => !m.success).map((m) => m.persona_label.replace(/ \(.*\)/, "").toLowerCase());
  return stuck.length ? `Stuck: ${stuck.join(", ")}.` : "";
}

// Merge findings across agents, most severe first. Same title = same barrier; an automatic
// finding about the same WCAG criterion as an agent-reported one is folded into it.
function mergeBarriers(g) {
  const map = new Map();
  const crit = (b) => (String(b.wcag || "").match(/\d+\.\d+\.\d+/) || [""])[0];
  const add = (b, who) => {
    const k = (b.title || "").toLowerCase().replace(/\d+/g, "#").trim();
    const twin = b.source === "auto" && crit(b) && [...map.values()].find((x) => x.source === "agent" && crit(x) === crit(b));
    const cur = twin || map.get(k) || { ...b, who: new Set(), also: [] };
    cur.who.add(who);
    if (twin) cur.also.push(b.title);
    if (!cur.fix && b.fix) cur.fix = b.fix;
    if (!twin) map.set(k, cur);
  };
  // agent-reported first, so automatic findings can fold into them
  ["agent", "auto"].forEach((src) => g.members.forEach((m) => (m.barrier_list || [])
    .filter((b) => b.source === src).forEach((b) => add(b, m.persona_label.replace(/ \(.*\)/, "")))));
  const rank = { blocker: 0, serious: 1, minor: 2 };
  return [...map.values()].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.who.size - a.who.size);
}

function renderBarriers(g) {
  const items = mergeBarriers(g);
  $("#barriers").hidden = false;
  $("#barriers-sub").textContent = items.length
    ? `${items.length} barrier${items.length === 1 ? "" : "s"}, reported by the agents or detected automatically along the way.`
    : "No barriers found on this task. Automated agents don't catch everything, so also test with real people.";
  $("#blist").innerHTML = items.map((b) => {
    const [ic, label] = SEV[b.severity] || SEV.minor;
    return `<li class="bitem">
      <span class="sev ${esc(b.severity || "minor")}" aria-hidden="true">${ic}</span>
      <div>
        <h3><span class="sevlabel">${label}</span>${esc(b.title)}</h3>
        ${b.detail ? `<p>${esc(b.detail)}</p>` : ""}
        ${b.fix ? `<div class="fix"><b>Fix:</b> ${esc(b.fix)}</div>` : ""}
        ${b.also && b.also.length ? `<p class="also">Also detected automatically: ${esc(b.also.join("; "))}</p>` : ""}
        <div class="tags">${[...b.who].map((w) => `<span class="tag">${esc(w)}</span>`).join("")}${b.wcag ? `<span class="tag">WCAG ${esc(b.wcag)}</span>` : ""}</div>
      </div></li>`;
  }).join("");
}

// ---------------------------------------------------------------- steps drawer
async function openDrawer(jid) {
  run.drawer = { id: jid, seen: 0 };
  const m = run.data.members.find((x) => x.id === jid);
  $("#drawer-h").textContent = m.persona_label;
  $("#drawer-sub").textContent = PERCEIVES[m.persona];
  $("#drawer-report").hidden = !!run.saved;
  $("#drawer-report").href = `/api/journey/${jid}/report.html`;
  $("#steps").innerHTML = "";
  $("#drawer").showModal();
  if (run.saved) {
    const j = run.saved.record.journeys.find((x) => x.id === jid);
    if (m.persona !== "screen_reader") $("#drawer-sub").textContent += " Screenshots of every step are in the HTML report.";
    $("#steps").innerHTML = j ? j.steps.map((st) => stepHtml(st, j, false)).join("") : "";
    return;
  }
  await refreshDrawer();
}

async function refreshDrawer() {
  const d = run.drawer;
  if (!d || !$("#drawer").open || run.saved) { run.drawer = null; return; }
  try {
    const j = await api(`/api/journey/${d.id}?since=${d.seen}`);
    if (run.drawer !== d) return;
    d.seen = j.step_count;
    $("#steps").insertAdjacentHTML("beforeend", j.steps.map((st) => stepHtml(st, j)).join(""));
  } catch {}
}

function stepHtml(st, j, shots = true) {
  const inp = st.input || {};
  const detail = inp.key ? `<code>${esc(inp.key)}${inp.times > 1 ? " ×" + inp.times : ""}</code>`
    : inp.text ? `<code>${esc(inp.text)}</code>` : inp.query ? `<code>${esc(inp.query)}</code>` : "";
  const sr = j.persona === "screen_reader";
  const media = sr ? (st.heard ? `<pre>${esc(st.heard.replace(/ \[ref \d+\]/g, ""))}</pre>` : "")
    : (shots && st.has_shot ? `<img src="/api/journey/${j.id}/shot/${st.n}.jpg" alt="Screen at step ${st.n}" loading="lazy">` : "");
  return `<li class="step ${st.tool === "report_barrier" ? "barrier" : ""}">
    <span class="n" aria-hidden="true">${st.tool === "report_barrier" ? "!" : st.n}</span>
    <div>
      ${st.thought ? `<p class="t">“${esc(st.thought)}”</p>` : ""}
      <p class="a"><b>${esc(VERB[st.tool] || st.tool)}</b> ${detail} <span class="muted">${esc(st.result)}</span></p>
      ${media}
    </div></li>`;
}

// ---------------------------------------------------------------- history view
async function showHistory() {
  setView("history");
  await renderHistory();
  $("#history-h").focus();
}

async function renderHistory() {
  let items = [];
  try { items = await History.list(); } catch (err) { $("#history-msg").textContent = err.message; }
  $("#history-empty").hidden = items.length > 0;
  $("#clear-btn").hidden = !items.length;
  $("#hlist").innerHTML = items.map((r) => {
    const all = r.completed === r.total;
    return `<li class="hitem">
      <div class="hmain">
        <h2><a href="#saved=${esc(r.id)}">${esc(r.goal)}</a></h2>
        <p class="hurl">${esc(r.url)}</p>
        <p class="hmeta">
          <span class="pill ${all ? "ok" : "bad"}"><span aria-hidden="true">${all ? "✓" : "✕"}</span> ${r.completed} of ${r.total} could do it</span>
          <span>${r.barriers} barrier${r.barriers === 1 ? "" : "s"}</span>
          <span>${esc(fmtDate(r.run_at || r.saved_at))}</span>${r.imported ? "<span>Imported</span>" : ""}
        </p>
      </div>
      <div class="hactions">${dlMenu(r.id)}
        <button type="button" class="btn btn-sm" data-del="${esc(r.id)}">Delete<span class="sr-only"> “${esc(r.goal)}”</span></button>
      </div>
    </li>`;
  }).join("");
}

$("#hlist").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  const r = await History.get(b.dataset.del).catch(() => null);
  if (!r || !confirm(`Delete “${r.goal}” from History? This can't be undone.`)) return;
  await History.del(r.id);
  await renderHistory();
  $("#history-msg").textContent = `Deleted “${r.goal}”.`;
  $("#history-h").focus();
});

$("#clear-btn").addEventListener("click", async () => {
  if (!confirm("Delete every saved test from History in this browser? This can't be undone.")) return;
  await History.clear();
  await renderHistory();
  $("#history-msg").textContent = "History cleared.";
  $("#history-h").focus();
});

$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0], msg = $("#history-msg");
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("That file is too large to be a Persona Lab export.");
    let record;
    try { record = JSON.parse(await file.text()); } catch { throw new Error("That file isn't valid JSON."); }
    if (!validRecord(record)) throw new Error("That file isn't a Persona Lab test (download one with Download → Data (JSON)).");
    if (await History.get(record.run.id)) { msg.textContent = `“${record.run.goal}” is already in your History.`; return; }
    await History.put(historyEntry(record, mergeBarriers(record.run).length, true), {});
    await renderHistory();
    msg.textContent = `Imported “${record.run.goal}”.`;
  } catch (err) { msg.textContent = err.message; }
});

// ---------------------------------------------------------------- downloads
// From this browser's History when the test is saved there, otherwise from the server.
async function download(id, what) {
  const saved = await History.get(id).catch(() => null);
  const record = saved ? saved.record : await api(`/api/run/${id}/export.json`);
  const base = fileBase(record);
  if (what === "json") return saveFile(`${base}.json`, JSON.stringify(record, null, 2), "application/json");
  if (what === "csv") return saveFile(`${base}-barriers.csv`, toCSV(record), "text/csv;charset=utf-8");
  const html = saved
    ? ((await History.files(id).catch(() => null)) || {}).report_html
    : await fetch(`/api/run/${id}/report.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (html) return what === "html" ? saveFile(`${base}.html`, html, "text/html") : printHTML(html);
  if (what === "pdf") {  // no stored report (imported test): print the results page itself
    if (!run.saved || run.saved.id !== id) { history.pushState({}, "", `#saved=${id}`); await route(); }
    return window.print();
  }
  throw new Error("The HTML report isn't stored for imported tests. Download it in the browser that ran the test, or use PDF to print this page.");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-dl]");
  if (!b) return;
  const d = b.closest("details.dl");
  d.open = false;
  const msg = $("#view-history").hidden ? $("#saved-note") : $("#history-msg");
  try { await download(d.dataset.src, b.dataset.dl); } catch (err) { msg.textContent = err.message; }
});

// ---------------------------------------------------------------- wiring
$("#stop-btn").addEventListener("click", async () => { if (run.id) await api(`/api/run/${run.id}/stop`, { method: "POST" }).catch(() => {}); });
$("#drawer").addEventListener("close", () => { run.drawer = null; });

async function openSaved(id) {
  const s = await History.get(id).catch(() => null);
  if (!s) return false;
  const files = await History.files(id).catch(() => null);
  showRun(s.record.run, s, files);
  return true;
}

async function route() {
  const h = location.hash;
  let m = h.match(/^#run=([a-f0-9]+)/);
  if (m) {
    try { showRun(await api(`/api/run/${m[1]}`)); return; } catch {}
    // The server forgot it (restart or redeploy), but this browser may have kept it.
    if (await openSaved(m[1])) { history.replaceState({}, "", `#saved=${m[1]}`); return; }
    history.replaceState({}, "", "/");
  }
  m = h.match(/^#saved=([a-f0-9]+)/);
  if (m) {
    if (await openSaved(m[1])) return;
    history.replaceState({}, "", "#history");
  }
  if (location.hash === "#history") return showHistory();
  setView("start");
}
window.addEventListener("popstate", route);
initStart();
route();
