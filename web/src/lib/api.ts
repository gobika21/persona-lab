// Typed client for the Flask API (same origin in production, proxied by `next dev`).

export type PersonaId = "keyboard" | "screen_reader" | "color_blind" | "low_vision";
export type Severity = "blocker" | "serious" | "minor";

export interface Barrier {
  title: string;
  detail?: string | null;
  severity?: Severity | string | null;
  wcag?: string | null;
  fix?: string | null;
  source: "agent" | "auto";
}

export interface LastStep { n: number; tool: string; thought?: string; result?: string; heard?: string | null }

export interface Member {
  id: string;
  persona: PersonaId;
  persona_label: string;
  status: "starting" | "running" | "done" | "error" | "stopped" | string;
  success: boolean | null;
  steps: number;
  barriers: number;
  current?: string;
  summary?: string;
  /** What the agent said worked well for this person (finish tool), newest runs only. */
  worked?: string[];
  error?: string;
  last?: LastStep | null;
  shot: number | null;
  barrier_list: Barrier[];
  tokens?: number;
}

export interface Group {
  id: string;
  url: string;
  goal: string;
  journeys: string[];
  members: Member[];
  finished: boolean;
  completed: number;
  total: number;
}

export interface Step {
  n: number;
  thought?: string;
  tool: string;
  input?: { key?: string; times?: number; text?: string; query?: string; [k: string]: unknown };
  result?: string;
  error?: string;
  has_shot?: boolean;
  heard?: string;
}

export interface Journey {
  id: string;
  persona: PersonaId;
  persona_label: string;
  status: string;
  steps: Step[];
  step_count: number;
}

export interface RunRecord {
  format: "persona-lab-run";
  version: 1;
  exported_at: string;
  run: Group;
  journeys: Journey[];
}

export interface PersonaInfo { id: PersonaId; label: string; who: string; brief: string }
export interface Demo { id: string; site: string; goal: string; path: string }
export interface Health { ok: boolean; public_mode: boolean; model: string; ai_ready: boolean; remaining: { journey: number } | null }

export interface EvalSummary {
  id: string;
  label: string;
  kind: "baseline" | "agents";
  model?: string;
  engine?: string;
  created_at: string;
  metrics: { barrier_recall: number | null; precision: number | null; findings: number; outcome_accuracy?: number | null; false_success_rate?: number | null };
  per_persona?: Record<string, { recall: number | null; outcome_accuracy: number | null }>;
  barriers: { id: string; summary: string; site: string; wcag: string; personas: PersonaId[]; detected?: boolean }[];
}
export interface EvalFull extends EvalSummary {
  journeys: { task: string; persona: PersonaId; possible: boolean; claimed: boolean; verified: boolean; error?: string; steps: number }[];
}

// ---- the visitor's own API key (never sent anywhere except with their own requests) ----
const KEY = "pl-key";
export const keyStore = {
  get(): string {
    try { return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) ?? ""; } catch { return ""; }
  },
  set(value: string, remember: boolean) {
    try { this.clear(); (remember ? localStorage : sessionStorage).setItem(KEY, value); } catch {}
  },
  clear() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {}
  },
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  const key = keyStore.get();
  if (key) headers["X-Anthropic-Key"] = key;
  const res = await fetch(path, { method: opts.method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** Ask the nav's status chip (free runs left, key in use) to refresh. */
export const refreshStatus = () => window.dispatchEvent(new Event("pl:status"));
