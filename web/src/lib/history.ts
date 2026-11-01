// History and downloads. Finished runs are kept in this browser (IndexedDB), never on the server,
// so they survive server restarts and stay private to the visitor.
import { api, type Group, type RunRecord } from "./api";
import { mergeBarriers } from "./barriers";

export const HISTORY_MAX = 30;
const RECORD_FORMAT = "persona-lab-run";

export interface HistoryEntry {
  id: string;
  saved_at: string;
  run_at: string | null;
  imported: boolean;
  url: string;
  goal: string;
  completed: number;
  total: number;
  barriers: number;
  record: RunRecord;
  /** Small preview for the History list: the page as the keyboard user last saw it (unfiltered). */
  thumb?: Blob;
}
export interface HistoryFiles { id: string; report_html?: string | null; shots?: Record<string, Blob> }

// Two stores: "runs" holds the small part (list + data), "files" the heavy part (HTML report, screenshots).
let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return dbp ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser can't save history."));
    const req = indexedDB.open("persona-lab", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("runs", { keyPath: "id" });
      req.result.createObjectStore("files", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error || new Error("This browser can't save history.")); };
  });
}

function done<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (...s: IDBObjectStore[]) => Promise<T> | T): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out: T;
    Promise.resolve(fn(...stores.map((s) => t.objectStore(s)))).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error || new Error("Couldn't save to History."));
  });
}

export const History = {
  async list(): Promise<HistoryEntry[]> {
    const all = await tx(["runs"], "readonly", (runs) => done(runs.getAll() as IDBRequest<HistoryEntry[]>));
    return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  },
  get: (id: string) => tx(["runs"], "readonly", (runs) => done(runs.get(id) as IDBRequest<HistoryEntry | undefined>)),
  files: (id: string) => tx(["files"], "readonly", (f) => done(f.get(id) as IDBRequest<HistoryFiles | undefined>)),
  del: (id: string) => tx(["runs", "files"], "readwrite", (runs, f) => { runs.delete(id); f.delete(id); }),
  clear: () => tx(["runs", "files"], "readwrite", (runs, f) => { runs.clear(); f.clear(); }),

  async put(entry: HistoryEntry, heavy: Omit<HistoryFiles, "id">): Promise<boolean> {
    // Keep the newest HISTORY_MAX; if the browser runs out of space, drop the oldest and try again.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const old = (await History.list()).filter((r) => r.id !== entry.id);
        for (const r of old.slice(HISTORY_MAX - 1)) await History.del(r.id);
        await tx(["runs", "files"], "readwrite", (runs, f) => { runs.put(entry); f.put({ id: entry.id, ...heavy }); });
        return true;
      } catch (err) {
        if ((err as DOMException)?.name !== "QuotaExceededError") throw err;
        const rest = (await History.list()).filter((r) => r.id !== entry.id);
        if (!rest.length) { heavy = {}; continue; }  // still too big: keep the data, skip report + screenshots
        await History.del(rest[rest.length - 1].id);
      }
    }
    return false;
  },
};

export function historyEntry(record: RunRecord, imported = false): HistoryEntry {
  const g = record.run;
  return {
    id: g.id, saved_at: new Date().toISOString(), run_at: record.exported_at || null, imported,
    url: g.url, goal: g.goal, completed: g.completed, total: g.total, barriers: mergeBarriers(g).length, record,
  };
}

/** Keep a finished run in this browser: the data, the HTML report and each agent's last screenshot. */
export async function saveRun(g: Group): Promise<"saved" | "exists"> {
  if (await History.get(g.id)) return "exists";
  const record = await api<RunRecord>(`/api/run/${g.id}/export.json`);
  const report_html = await fetch(`/api/run/${g.id}/report.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const shots: Record<string, Blob> = {};
  for (const m of g.members) {
    if (!m.shot) continue;
    const r = await fetch(`/api/journey/${m.id}/shot/${m.shot}.jpg`).catch(() => null);
    if (r && r.ok) shots[m.id] = await r.blob();
  }
  // Prefer views that show the page as it is (the visual personas' shots are filtered or zoomed).
  const pick = ["keyboard", "color_blind", "low_vision"].map((p) => g.members.find((m) => m.persona === p)?.id).find((id) => id && shots[id]);
  await History.put({ ...historyEntry(record), thumb: pick ? shots[pick] : undefined }, { report_html, shots });
  return "saved";
}

// An imported file is untrusted: check its shape, and force ids and counts into safe forms
// (React escapes all text when it's shown).
const PERSONA_IDS = ["keyboard", "screen_reader", "color_blind", "low_vision"];
const isId = (s: unknown) => typeof s === "string" && /^[a-f0-9]{6,32}$/.test(s);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validRecord(r: any): r is RunRecord {
  if (!r || r.format !== RECORD_FORMAT || r.version !== 1 || !r.run || !isId(r.run.id)
      || typeof r.run.goal !== "string" || typeof r.run.url !== "string"
      || !Array.isArray(r.run.members) || !Array.isArray(r.journeys)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ok = r.run.members.every((m: any) => m && isId(m.id) && PERSONA_IDS.includes(m.persona) && typeof m.persona_label === "string")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && r.journeys.every((j: any) => j && isId(j.id) && PERSONA_IDS.includes(j.persona) && Array.isArray(j.steps));
  if (!ok) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.run.members.forEach((m: any) => {
    m.steps = num(m.steps); m.barriers = num(m.barriers); m.shot = m.shot == null ? null : num(m.shot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.barrier_list = Array.isArray(m.barrier_list) ? m.barrier_list.filter((b: any) => b && typeof b === "object") : [];
    m.worked = Array.isArray(m.worked) ? m.worked.filter((w: unknown) => typeof w === "string").slice(0, 5) : [];
  });
  r.run.completed = num(r.run.completed); r.run.total = num(r.run.total) || r.run.members.length;
  r.run.finished = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.journeys.forEach((j: any) => j.steps.forEach((st: any) => {
    st.n = num(st.n);
    if (st.input && typeof st.input === "object") st.input.times = num(st.input.times);
  }));
  return true;
}

// ---------------------------------------------------------------- downloads
export function fileBase(record: RunRecord): string {
  let host = "site";
  try { host = new URL(record.run.url).hostname.replace(/^www\./, "") || host; } catch {}
  const day = (record.exported_at || new Date().toISOString()).slice(0, 10);
  return `persona-lab-${host.replace(/[^a-z0-9.-]/gi, "-")}-${day}`;
}

export function saveFile(name: string, data: Blob | string, type: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// One row per barrier per person (plus a row for anyone with none), ready for a spreadsheet or issue tracker.
export function toCSV(record: RunRecord): string {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;  // stop spreadsheets from running it as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: unknown[][] = [["Site", "Task", "Person", "Result", "Severity", "Barrier", "Details", "How to fix", "WCAG", "Found by", "What worked for this person"]];
  const g = record.run;
  g.members.forEach((m) => {
    const result = m.status === "error" ? "Couldn't run" : m.success ? "Completed" : m.status === "stopped" ? "Stopped" : "Got stuck";
    const base = [g.url, g.goal, m.persona_label, result];
    const worked = (m.worked || []).join("; ");
    const bs = m.barrier_list || [];
    if (!bs.length) rows.push([...base, "", "", "", "", "", "", worked]);
    bs.forEach((b) => rows.push([...base, b.severity, b.title, b.detail, b.fix, b.wcag, b.source === "auto" ? "Automatic check" : "Agent", worked]));
  });
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";  // BOM so Excel reads UTF-8
}

// "Save as PDF" goes through the browser's print dialog, using the report in a hidden frame.
export function printHTML(html: string) {
  const f = Object.assign(document.createElement("iframe"), { title: "Report for printing", srcdoc: html, tabIndex: -1 });
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  f.onload = () => {
    const w = f.contentWindow!;
    w.document.querySelectorAll("details").forEach((d) => { d.open = true; });
    w.addEventListener("afterprint", () => setTimeout(() => f.remove(), 100));
    w.focus(); w.print();
  };
  document.body.appendChild(f);
}

export type DownloadKind = "html" | "pdf" | "csv" | "json";

/**
 * Download a run, from this browser's History when it's saved there, otherwise from the server.
 * Returns "print-page" when there's no stored report (imported tests): the caller prints its own view.
 */
export async function downloadRun(id: string, what: DownloadKind): Promise<void | "print-page"> {
  const saved = await History.get(id).catch(() => undefined);
  const record = saved ? saved.record : await api<RunRecord>(`/api/run/${id}/export.json`);
  const base = fileBase(record);
  if (what === "json") return saveFile(`${base}.json`, JSON.stringify(record, null, 2), "application/json");
  if (what === "csv") return saveFile(`${base}-barriers.csv`, toCSV(record), "text/csv;charset=utf-8");
  const html = saved
    ? ((await History.files(id).catch(() => undefined)) || {}).report_html
    : await fetch(`/api/run/${id}/report.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (html) return what === "html" ? saveFile(`${base}.html`, html, "text/html") : printHTML(html);
  if (what === "pdf") return "print-page";
  throw new Error("The HTML report isn't stored for imported tests. Download it in the browser that ran the test, or use PDF to print this page.");
}
