"use client";

import { useEffect, useState, type ReactNode } from "react";
import Stat from "@/components/Stat";
import { api, type EvalFull, type EvalSummary } from "@/lib/api";
import { ORDER, SHORT_NAME } from "@/lib/personas";
import type { PersonaId } from "@/lib/api";

// Evals dashboard: reads evals/results/*.json through /api/evals.
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const pname = (p: string) => SHORT_NAME[p as PersonaId] || p;

interface BarRow { name: string; small?: string; v: number | null | undefined; note?: string }

function Bars({ rows }: { rows: BarRow[] }) {
  // Single series: one color, value direct-labelled, name on the left; hover shows the exact value.
  return (
    <ul className="mt-4.5 grid gap-3">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.v == null ? "n/a" : pct(r.v)}${r.note ? " · " + r.note : ""}`}
          className="group grid grid-cols-[minmax(120px,34%)_1fr_48px] items-center gap-3 text-sm">
          <span className="min-w-0 break-words text-ink">{r.name}{r.small && <small className="block text-[.75rem] text-ink-3">{r.small}</small>}</span>
          <span role="img" aria-label={`${r.name}: ${r.v == null ? "not measured" : pct(r.v)}`}
            className="relative block h-[22px] before:absolute before:inset-x-0 before:top-2.5 before:h-0.5 before:bg-line">
            <span className="relative block h-full min-w-[3px] rounded-r bg-series-1 group-hover:brightness-110" style={{ width: `${r.v == null ? 0 : Math.max(1, r.v * 100)}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{pct(r.v)}</span>
        </li>
      ))}
    </ul>
  );
}

function Card({ id, title, sub, children, className = "" }: { id: string; title: string; sub: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`card p-5 ${className}`}>
      <h2 id={id} className="text-[1.05rem] font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-1 text-[.85rem] text-ink-2">{sub}</p>
      {children}
    </section>
  );
}

const th = "px-2.5 py-2.5 text-left align-top border-b border-line";
const thHead = `${th} text-[.75rem] font-semibold tracking-wider text-ink-2 uppercase whitespace-nowrap`;

export default function EvalsClient() {
  const [results, setResults] = useState<EvalSummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [full, setFull] = useState<EvalFull | null>(null);

  useEffect(() => {
    api<EvalSummary[]>("/api/evals").then((rs) => {
      setResults(rs);
      setSelected((rs.find((r) => r.kind === "agents") || rs[0])?.id || "");
    }).catch(() => setResults([]));
  }, []);

  const r = results?.find((x) => x.id === selected) || results?.[0];

  // Outcome table needs the full result (per-journey rows); only agent runs have it.
  useEffect(() => {
    if (!r || r.kind !== "agents") return;
    let stop = false;
    api<EvalFull>(`/api/evals/${r.id}`).then((f) => { if (!stop) setFull(f); }).catch(() => {});
    return () => { stop = true; };
  }, [r]);

  const hasAgents = !!results?.some((x) => x.kind === "agents");
  const m = r?.metrics;
  const cols = (results || []).slice(0, 4);
  const hit = (run: EvalSummary, bid: string) => (run.barriers || []).find((b) => b.id === bid)?.detected;
  const yes = <span className="font-bold text-ok">✓ yes</span>, no = <span className="text-ink-3">✕ no</span>;

  return (
    <div className="wrap pb-16">
      <div className="pt-14 pb-6">
        <h1 className="text-[clamp(2rem,5vw,3rem)] font-[750] tracking-[-0.035em]">Can the agents be trusted?</h1>
        <p className="mt-3 max-w-[46rem] text-[1.05rem] text-ink-2">
          Every agent version is scored on a benchmark of <strong className="text-ink">4 demo websites</strong> with{" "}
          <strong className="text-ink">12 planted barriers</strong> and <strong className="text-ink">5 tasks</strong> whose outcome is known for each persona,
          including an accessible control site to catch false alarms. Agents are compared with what page rules alone can find.
        </p>
      </div>

      {results && !results.length && (
        <Callout title="No results yet">
          Run <code>python -m personalab.evals baseline</code> and <code>python -m personalab.evals agents --label v1</code>.
        </Callout>
      )}

      {r && m && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <label htmlFor="run-select" className="text-sm text-ink-2">Showing run</label>
            <select id="run-select" value={r.id} onChange={(e) => { setFull(null); setSelected(e.target.value); }}
              className="h-10 max-w-full rounded-[10px] border-2 border-edge bg-surface px-3 text-[.9rem] text-ink">
              {results!.map((x) => <option key={x.id} value={x.id}>{x.label}{x.kind === "baseline" ? " (baseline)" : ""}</option>)}
            </select>
            <span className="text-sm text-ink-2">
              {r.kind === "baseline" ? `Engine: ${r.engine}` : `Model: ${r.model}`} · {new Date(r.created_at).toLocaleString()}
            </span>
          </div>

          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 min-[901px]:grid-cols-4">
            {r.kind === "agents" ? (
              <>
                <Stat k="Barrier recall" v={pct(m.barrier_recall)} d="planted barriers found" />
                <Stat k="Precision" v={pct(m.precision)} d={`of ${m.findings} findings were real`} />
                <Stat k="Right verdict" v={pct(m.outcome_accuracy)} d="correct call: can this person finish?" />
                <Stat k="False success" v={pct(m.false_success_rate)} d="claimed done, but wasn't (lower is better)" />
              </>
            ) : (
              <>
                <Stat k="Barrier recall" v={pct(m.barrier_recall)} d="planted barriers found by page rules" />
                <Stat k="Precision" v={pct(m.precision)} d={`of ${m.findings} findings were real`} />
                <Stat k="Right verdict" v="n/a" d="rules can't tell if a person can finish a task" />
                <Stat k="Cost" v="~0" d="no AI calls" />
              </>
            )}
          </section>

          {!hasAgents && (
            <Callout title="No agent runs yet">
              Only the rules-only baseline has been run so far. Score the persona agents with your API key:{" "}
              <code>python -m personalab.evals agents --label v1</code>. Results appear here automatically.
            </Callout>
          )}

          <div className="mt-3 grid gap-3 min-[901px]:grid-cols-2">
            <Card id="cmp-h" title="Barrier recall by run" sub="Share of the 12 planted barriers each run found.">
              <Bars rows={results!.slice(0, 8).map((x) => ({ name: x.label, small: x.kind === "baseline" ? x.engine : x.model, v: x.metrics.barrier_recall }))} />
            </Card>
            <Card id="pp-h" title="Recall by persona"
              sub={r.kind === "agents" ? "Planted barriers each persona was expected to hit, and found." : "Not applicable: page rules don't simulate people. Run the agents to see this."}>
              {r.kind === "agents" && r.per_persona && (
                <Bars rows={Object.entries(r.per_persona).sort((a, b) => ORDER.indexOf(a[0] as PersonaId) - ORDER.indexOf(b[0] as PersonaId))
                  .map(([p, s]) => ({ name: pname(p), v: s.recall, note: `verdict accuracy ${pct(s.outcome_accuracy)}` }))} />
              )}
            </Card>
          </div>

          <Card id="mx-h" className="mt-3" title="Which barriers were found" sub="Each planted barrier, who it affects, and whether each run detected it.">
            <div className="mt-3.5 overflow-x-auto" tabIndex={0} role="region" aria-label="Barrier table, scrolls sideways">
              <table className="w-full border-collapse text-sm">
                <thead><tr>
                  <th scope="col" className={thHead}>Planted barrier</th><th scope="col" className={thHead}>Affects</th>
                  {cols.map((c) => <th key={c.id} scope="col" className={`${thHead} text-center`}>{c.label}</th>)}
                </tr></thead>
                <tbody>
                  {r.barriers.map((b) => (
                    <tr key={b.id}>
                      <th scope="row" className={`${th} font-medium`}>{b.summary}<div className="text-sm text-ink-2">{b.site} · WCAG {b.wcag}</div></th>
                      <td className={`${th} text-sm text-ink-2`}>{b.personas.map(pname).join(", ")}</td>
                      {cols.map((c) => hit(c, b.id)
                        ? <td key={c.id} className={`${th} text-center font-bold whitespace-nowrap text-ok`}>✓ <span className="sr-only">found</span></td>
                        : <td key={c.id} className={`${th} text-center whitespace-nowrap text-ink-3`}>– <span className="sr-only">missed</span></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {r.kind === "agents" && full?.id === r.id && (
            <Card id="out-h" className="mt-3" title="Task outcomes"
              sub="Did the agent reach the right verdict, and did it really finish? “Verified” is checked from the pages it reached and the answer it gave, not from what it claims.">
              <div className="mt-3.5 overflow-x-auto" tabIndex={0} role="region" aria-label="Outcome table, scrolls sideways">
                <table className="w-full border-collapse text-sm">
                  <thead><tr>
                    {["Task", "Persona", "Possible?", "Agent said", "Verified"].map((h) => <th key={h} scope="col" className={thHead}>{h}</th>)}
                    <th scope="col" className={`${thHead} text-center`}>Steps</th>
                  </tr></thead>
                  <tbody>
                    {full.journeys.map((j, i) => (
                      <tr key={i}>
                        <td className={th}>{j.task}</td><td className={th}>{pname(j.persona)}</td><td className={th}>{j.possible ? yes : no}</td>
                        <td className={th}>
                          {j.error ? <span className="text-ink-3">error</span> : j.claimed ? "completed" : "stuck"}
                          {!j.error && j.claimed !== j.possible && <span className="text-bad"> (wrong)</span>}
                        </td>
                        <td className={th}>{j.verified ? yes : no}</td><td className={`${th} text-center`}>{j.steps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <section aria-labelledby="m-h" className="pt-10">
        <h2 id="m-h" className="mb-6 text-[1.6rem] font-semibold">Method</h2>
        <div className="grid gap-3 min-[901px]:grid-cols-3">
          <MethodCard title="Planted barriers">
            Small realistic sites (hotel, shop, clinic, library) with known problems: a mouse-only &quot;Book&quot; button, color-only product variants, a day picker without keyboard access, unlabeled fields and more. The library site is fully accessible, so anything reported there is a false alarm.
          </MethodCard>
          <MethodCard title="Objective outcomes">
            Each task has a success check, such as &quot;reached <code>confirmed.html</code>&quot; or &quot;answer contains <code>10:00</code>&quot;. That separates agents that finish from agents that only claim to (false success).
          </MethodCard>
          <MethodCard title="Matching findings">
            A finding counts when it names the right element and the right kind of problem (keyword rules in <code>ground_truth.json</code>), or optionally via an LLM judge. Run it yourself: <code>python -m personalab.evals agents --label my-change</code>.
          </MethodCard>
        </div>
        <p className="mt-8 text-[.85rem] text-ink-3">Results are JSON files in <code>evals/results/</code>; this page reads them as-is.</p>
      </section>
    </div>
  );
}

function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 rounded-[14px] border-2 border-dashed border-edge bg-surface px-5 py-4.5">
      <h2 className="mb-1.5 text-base font-semibold">{title}</h2>
      <p className="text-sm text-ink-2 [&_code]:rounded-md [&_code]:border [&_code]:border-line [&_code]:bg-bg [&_code]:px-1.5 [&_code]:py-0.5">{children}</p>
    </div>
  );
}

function MethodCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-[.9rem] text-ink-2">{children}</p>
    </div>
  );
}
