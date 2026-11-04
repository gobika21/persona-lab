// Demo replays: a real run recorded with `python -m personalab.replay save`, played back from static files
// (web/public/replays) so visitors can watch the agents without an API key and without spending anything.
import type { Group, Journey, Member, RunRecord, Step } from "./api";

export interface ReplayInfo {
  id: string;
  goal: string;
  url: string;
  recorded_at: string;
  model: string;
  completed: number;
  total: number;
  steps: number;
  cost_usd?: number | null;
}

/** Replays of the same task on two versions of a site, shown side by side on /compare once both are recorded. */
export const PAIRS: { before: string; after: string; title: string }[] = [
  { before: "w3c-before", after: "w3c-after", title: "W3C demo site, before and after its accessibility fixes" },
];

export const pairsIn = (items: ReplayInfo[]) => {
  const ids = new Set(items.map((r) => r.id));
  return PAIRS.filter((p) => ids.has(p.before) && ids.has(p.after));
};

export const compareHref = (p: { before: string; after: string }) => `/compare?a=${encodeURIComponent(p.before)}&b=${encodeURIComponent(p.after)}`;

export const replayBase =(id: string) => `/replays/${encodeURIComponent(id)}`;

export async function listReplays(): Promise<ReplayInfo[]> {
  const r = await fetch("/replays/index.json").catch(() => null);
  if (!r || !r.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

export async function loadReplay(id: string): Promise<RunRecord> {
  const r = await fetch(`${replayBase(id)}/record.json`);
  if (!r.ok) throw new Error("That replay doesn't exist.");
  return r.json();
}

/** At 1× the slowest agent finishes in this many seconds; the others keep their real pace relative to it. */
const TARGET_S = 45;
const FALLBACK_STEP_S = 6;

export interface Timeline {
  duration: number;  // seconds at 1×
  /** Seconds at which each journey's steps appear, by journey id. */
  appear: Record<string, number[]>;
}

export function timeline(rec: RunRecord): Timeline {
  const real = (j: Journey) => (j.elapsed_s && j.steps.length ? j.elapsed_s : j.steps.length * FALLBACK_STEP_S);
  const slowest = Math.max(1, ...rec.journeys.map(real));
  const scale = TARGET_S / slowest;
  const appear: Record<string, number[]> = {};
  for (const j of rec.journeys) {
    const iv = (real(j) * scale) / Math.max(1, j.steps.length);
    appear[j.id] = j.steps.map((_, k) => (k + 0.5) * iv);
  }
  return { duration: TARGET_S, appear };
}

const revealedAt = (times: number[], t: number) => {
  let n = 0;
  while (n < times.length && times[n] <= t) n++;
  return n;
};

/** The run as it looked `t` seconds into the replay, plus how many steps of each journey are visible. */
export function snapshot(rec: RunRecord, tl: Timeline, t: number): { group: Group; revealed: Record<string, number> } {
  const revealed: Record<string, number> = {};
  const members: Member[] = rec.run.members.map((m) => {
    const j = rec.journeys.find((x) => x.id === m.id);
    const times = tl.appear[m.id] || [];
    const n = revealedAt(times, t);
    revealed[m.id] = n;
    if (!j || n >= times.length) return m;  // this agent has finished: show its real result
    const shown: Step[] = j.steps.slice(0, n);
    const last = shown[shown.length - 1];
    const lastShot = [...shown].reverse().find((s) => s.has_shot);
    return {
      ...m, status: n ? "running" : "starting", success: null, steps: n, summary: "", worked: [], barrier_list: [],
      barriers: shown.filter((s) => s.tool === "report_barrier").length,
      current: n ? undefined : "Opening the browser…",
      last: last ? { n: last.n, tool: last.tool, thought: last.thought, result: last.result, heard: last.heard } : null,
      shot: lastShot ? lastShot.n : null,
    };
  });
  const finished = members.every((m, i) => m === rec.run.members[i]);
  return {
    group: { ...rec.run, members, finished, completed: finished ? rec.run.completed : members.filter((m) => m.success).length },
    revealed,
  };
}
