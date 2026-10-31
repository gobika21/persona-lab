// History and downloads. Finished runs are kept in this browser (IndexedDB), never on the server,
// so they survive server restarts and stay private to the visitor.
"use strict";

const HISTORY_MAX = 30;
const RECORD_FORMAT = "persona-lab-run";

// Two stores: "runs" holds the small part (list + data), "files" the heavy part (HTML report, screenshots).
const History = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("This browser can't save history."));
    const req = indexedDB.open("persona-lab", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("runs", { keyPath: "id" });
      req.result.createObjectStore("files", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("This browser can't save history."));
  }));
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(...stores.map((s) => t.objectStore(s)))).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error || new Error("Couldn't save to History."));
    });
  };
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  async function list() {
    const all = await tx(["runs"], "readonly", (runs) => req(runs.getAll()));
    return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  }
  const get = (id) => tx(["runs"], "readonly", (runs) => req(runs.get(id)));
  const files = (id) => tx(["files"], "readonly", (f) => req(f.get(id)));
  const del = (id) => tx(["runs", "files"], "readwrite", (runs, f) => { runs.delete(id); f.delete(id); });
  const clear = () => tx(["runs", "files"], "readwrite", (runs, f) => { runs.clear(); f.clear(); });

  async function put(entry, heavy) {
    // Keep the newest HISTORY_MAX; if the browser runs out of space, drop the oldest and try again.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const old = (await list()).filter((r) => r.id !== entry.id);
        for (const r of old.slice(HISTORY_MAX - 1)) await del(r.id);
        await tx(["runs", "files"], "readwrite", (runs, f) => { runs.put(entry); f.put({ id: entry.id, ...heavy }); });
        return true;
      } catch (err) {
        if (err && err.name !== "QuotaExceededError") throw err;
        const rest = (await list()).filter((r) => r.id !== entry.id);
        if (!rest.length) { heavy = {}; continue; }  // still too big: keep the data, skip report + screenshots
        await del(rest[rest.length - 1].id);
      }
    }
    return false;
  }

  return { list, get, files, put, del, clear };
})();

// A history entry: summary fields for the list, plus the full record.
function historyEntry(record, barriers, imported = false) {
  const g = record.run;
  return {
    id: g.id, saved_at: new Date().toISOString(), run_at: record.exported_at || null, imported,
    url: g.url, goal: g.goal, completed: g.completed, total: g.total, barriers, record,
  };
}

// An imported file is untrusted: check its shape, and force ids and counts into safe forms
// (text fields are always escaped when shown).
const PERSONA_IDS = ["keyboard", "screen_reader", "color_blind", "low_vision"];
const isId = (s) => typeof s === "string" && /^[a-f0-9]{6,32}$/.test(s);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function validRecord(r) {
  if (!r || r.format !== RECORD_FORMAT || r.version !== 1 || !r.run || !isId(r.run.id)
      || typeof r.run.goal !== "string" || typeof r.run.url !== "string"
      || !Array.isArray(r.run.members) || !Array.isArray(r.journeys)) return false;
  const okMembers = r.run.members.every((m) => m && isId(m.id) && PERSONA_IDS.includes(m.persona) && typeof m.persona_label === "string")
    && r.journeys.every((j) => j && isId(j.id) && PERSONA_IDS.includes(j.persona) && Array.isArray(j.steps));
  if (!okMembers) return false;
  r.run.members.forEach((m) => {
    m.steps = num(m.steps); m.barriers = num(m.barriers); m.shot = m.shot == null ? null : num(m.shot);
    m.barrier_list = Array.isArray(m.barrier_list) ? m.barrier_list.filter((b) => b && typeof b === "object") : [];
  });
  r.run.completed = num(r.run.completed); r.run.total = num(r.run.total) || r.run.members.length;
  r.run.finished = true;
  r.journeys.forEach((j) => j.steps.forEach((st) => {
    st.n = num(st.n);
    if (st.input && typeof st.input === "object") st.input.times = num(st.input.times);
  }));
  return true;
}

// ---------------------------------------------------------------- downloads
function fileBase(record) {
  let host = "site";
  try { host = new URL(record.run.url).hostname.replace(/^www\./, "") || host; } catch {}
  const day = (record.exported_at || new Date().toISOString()).slice(0, 10);
  return `persona-lab-${host.replace(/[^a-z0-9.-]/gi, "-")}-${day}`;
}

function saveFile(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// One row per barrier per person (plus a row for anyone with none), ready for a spreadsheet or issue tracker.
function toCSV(record) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;  // stop spreadsheets from running it as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["Site", "Task", "Person", "Result", "Severity", "Barrier", "Details", "How to fix", "WCAG", "Found by"]];
  const g = record.run;
  g.members.forEach((m) => {
    const result = m.status === "error" ? "Couldn't run" : m.success ? "Completed" : m.status === "stopped" ? "Stopped" : "Got stuck";
    const base = [g.url, g.goal, m.persona_label, result];
    const bs = m.barrier_list || [];
    if (!bs.length) rows.push([...base, "", "", "", "", "", ""]);
    bs.forEach((b) => rows.push([...base, b.severity, b.title, b.detail, b.fix, b.wcag, b.source === "auto" ? "Automatic check" : "Agent"]));
  });
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";  // BOM so Excel reads UTF-8
}

// "Save as PDF" goes through the browser's print dialog, using the report in a hidden frame.
function printHTML(html) {
  const f = Object.assign(document.createElement("iframe"), { title: "Report for printing", srcdoc: html });
  f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  f.onload = () => {
    const w = f.contentWindow;
    w.document.querySelectorAll("details").forEach((d) => { d.open = true; });
    w.addEventListener("afterprint", () => setTimeout(() => f.remove(), 100));
    w.focus(); w.print();
  };
  document.body.appendChild(f);
}

// The download menu: a native <details> disclosure, so it works with keyboard and screen readers.
function dlMenu(src, label = "Download") {
  return `<details class="dl" data-src="${esc(src)}">
    <summary class="btn btn-sm">${esc(label)} <span aria-hidden="true">▾</span></summary>
    <div class="dl-menu">
      <button type="button" data-dl="html">HTML report <small>to share or email</small></button>
      <button type="button" data-dl="pdf">PDF <small>opens Print, choose Save as PDF</small></button>
      <button type="button" data-dl="csv">Barriers (CSV) <small>for spreadsheets and issue trackers</small></button>
      <button type="button" data-dl="json">Data (JSON) <small>can be imported back into History</small></button>
    </div>
  </details>`;
}

document.addEventListener("keydown", (e) => {
  const d = e.target.closest && e.target.closest("details.dl[open]");
  if (e.key === "Escape" && d) { d.open = false; d.querySelector("summary").focus(); }
});
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.dl[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});
// The menu opens right-aligned; when the button sits at the left edge (narrow screens) that would overflow, so flip it.
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches || !d.matches("details.dl") || !d.open) return;
  d.classList.remove("dl-left");
  if (d.querySelector(".dl-menu").getBoundingClientRect().left < 8) d.classList.add("dl-left");
}, true);
