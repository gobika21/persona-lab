// Persona Lab: start a test, watch four agents live, read the verdict.
"use strict";

const run = { id: null, data: null, timer: null, drawer: null };
const ORDER = ["keyboard", "screen_reader", "color_blind", "low_vision"];
const SEV = { blocker: ["!", "Blocker"], serious: ["▲", "Serious"], minor: ["•", "Minor"] };
const VERB = {
  open: "Opened the page", press_key: "Pressed", type_text: "Typed", type_into: "Typed into", click: "Clicked", activate: "Activated",
  read_page: "Read the page", list_elements: "Listed", find_text: "Searched for", scroll: "Scrolled", look: "Looked at the screen",
  go_back: "Went back", report_barrier: "Hit a barrier", finish: "Finished",
};

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

// ---------------------------------------------------------------- run view
function showRun(g) {
  $("#view-start").hidden = true; $("#view-run").hidden = false;
  run.id = g.id; run.data = g;
  $("#run-task").textContent = g.goal;
  $("#run-url").textContent = g.url;
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
  poll();
}

async function poll() {
  const id = run.id;
  try {
    const g = await api(`/api/run/${id}`);
    if (id !== run.id) return;
    run.data = g; render(g);
    if (run.drawer) refreshDrawer();
    if (g.finished) { refreshStatus(); return; }
  } catch (err) {
    $("#verdict").innerHTML = `<span class="txt" style="color:var(--bad)">${esc(err.message)}</span>`;
    return;
  }
  run.timer = setTimeout(poll, 1500);
}

const goalPhrase = (g) => g.goal.charAt(0).toLowerCase() + g.goal.slice(1);
const isDone = (m) => ["done", "error", "stopped"].includes(m.status);

function render(g) {
  const done = g.members.filter(isDone).length;
  $("#progress-bar").style.width = `${Math.max(4, (done / g.total) * 100)}%`;
  $(".progress").hidden = g.finished;
  $("#stop-btn").hidden = g.finished;
  const rb = $("#report-btn");
  rb.hidden = !g.finished; rb.href = `/api/run/${g.id}/report.html`;

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
    if (m.persona === "screen_reader" && last.heard) {
      screen.innerHTML = `<div class="term"><span class="label">Screen reader output</span>${esc(last.heard.replace(/ \[ref \d+\]/g, "").slice(0, 900))}</div>`;
    } else if (m.persona === "screen_reader") {
      screen.innerHTML = `<div class="term"><span class="label">Screen reader output</span>${esc(last.result || "Listening…")}</div>`;
    } else if (m.shot) {
      screen.innerHTML = `<img src="/api/journey/${m.id}/shot/${m.shot}.jpg" alt="What the ${esc(m.persona_label.toLowerCase())} sees at step ${m.shot}">`;
    }
  });

  if (g.finished) renderBarriers(g);
}

function stuckList(g) {
  const stuck = g.members.filter((m) => !m.success).map((m) => m.persona_label.replace(/ \(.*\)/, "").toLowerCase());
  return stuck.length ? `Stuck: ${stuck.join(", ")}.` : "";
}

function renderBarriers(g) {
  // Merge findings across agents, most severe first. Same title = same barrier; an automatic
  // finding about the same WCAG criterion as an agent-reported one is folded into it.
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
  const items = [...map.values()].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.who.size - a.who.size);
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
  $("#drawer-report").href = `/api/journey/${jid}/report.html`;
  $("#steps").innerHTML = "";
  $("#drawer").showModal();
  await refreshDrawer();
}

async function refreshDrawer() {
  const d = run.drawer;
  if (!d || !$("#drawer").open) { run.drawer = null; return; }
  try {
    const j = await api(`/api/journey/${d.id}?since=${d.seen}`);
    if (run.drawer !== d) return;
    d.seen = j.step_count;
    $("#steps").insertAdjacentHTML("beforeend", j.steps.map((st) => stepHtml(st, j)).join(""));
  } catch {}
}

function stepHtml(st, j) {
  const inp = st.input || {};
  const detail = inp.key ? `<code>${esc(inp.key)}${inp.times > 1 ? " ×" + inp.times : ""}</code>`
    : inp.text ? `<code>${esc(inp.text)}</code>` : inp.query ? `<code>${esc(inp.query)}</code>` : "";
  const sr = j.persona === "screen_reader";
  const media = sr ? (st.heard ? `<pre>${esc(st.heard.replace(/ \[ref \d+\]/g, ""))}</pre>` : "")
    : (st.has_shot ? `<img src="/api/journey/${j.id}/shot/${st.n}.jpg" alt="Screen at step ${st.n}" loading="lazy">` : "");
  return `<li class="step ${st.tool === "report_barrier" ? "barrier" : ""}">
    <span class="n" aria-hidden="true">${st.tool === "report_barrier" ? "!" : st.n}</span>
    <div>
      ${st.thought ? `<p class="t">“${esc(st.thought)}”</p>` : ""}
      <p class="a"><b>${esc(VERB[st.tool] || st.tool)}</b> ${detail} <span class="muted">${esc(st.result)}</span></p>
      ${media}
    </div></li>`;
}

// ---------------------------------------------------------------- wiring
$("#stop-btn").addEventListener("click", async () => { if (run.id) await api(`/api/run/${run.id}/stop`, { method: "POST" }).catch(() => {}); });
$("#drawer").addEventListener("close", () => { run.drawer = null; });

async function route() {
  const m = location.hash.match(/run=([a-f0-9]+)/);
  if (m) {
    try { showRun(await api(`/api/run/${m[1]}`)); return; } catch { history.replaceState({}, "", "/"); }
  }
  run.id = null; clearTimeout(run.timer);
  $("#view-run").hidden = true; $("#view-start").hidden = false;
}
window.addEventListener("popstate", route);
initStart();
route();
