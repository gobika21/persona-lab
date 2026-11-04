"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Missing from "@/components/Missing";
import type { Member, RunRecord } from "@/lib/api";
import { mergeBarriers } from "@/lib/barriers";
import { ORDER, PersonaIcon, SHORT_NAME } from "@/lib/personas";
import { loadReplay } from "@/lib/replay";

export default function CompareClient() {
  return <Suspense fallback={<p className="wrap pt-10 text-ink-2">Loading…</p>}><CompareRoute /></Suspense>;
}

// The same task on two versions of a site (two recorded replays), side by side: who could do it before and
// after, and which barriers the fix removed. /compare?a=<replay>&b=<replay>
function CompareRoute() {
  const params = useSearchParams();
  const a = params.get("a") || "", b = params.get("b") || "";
  const [recs, setRecs] = useState<[RunRecord, RunRecord] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!a || !b) return;
    Promise.all([loadReplay(a), loadReplay(b)]).then(([x, y]) => setRecs([x, y]), (err) => setError((err as Error).message));
  }, [a, b]);

  if (!a || !b) return <Missing message="Pick two replays to compare, e.g. /compare?a=before&b=after." />;
  if (error) return <Missing message={error} />;
  if (!recs) return <p className="wrap pt-10 text-ink-2" role="status">Loading both runs…</p>;

  const [before, after] = recs.map((r) => r.run);
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#").trim();
  const afterTitles = new Set(mergeBarriers(after).map((x) => key(x.title)));
  const gone = mergeBarriers(before).filter((x) => !afterTitles.has(key(x.title)));
  const remaining = mergeBarriers(after);
  const byPersona = (run: typeof before) => Object.fromEntries(run.members.map((m) => [m.persona, m])) as Record<string, Member>;
  const [pb, pa] = [byPersona(before), byPersona(after)];

  return (
    <div className="wrap pb-16">
      <div className="pt-7 pb-2">
        <Link href="/replay" className="inline-flex min-h-7 items-center gap-1.5 text-sm text-ink-2 no-underline hover:text-ink">
          <span aria-hidden="true">←</span> All replays
        </Link>
        <h1 className="mt-2.5 text-[clamp(2rem,5vw,3rem)] font-[750] tracking-[-0.035em]">Before and after the fix</h1>
        <p className="mt-2 max-w-[46rem] text-ink-2">
          The same task, <q>{before.goal}</q>, on two versions of a site. Both are real recorded runs by the four agents.
        </p>
      </div>

      <section aria-labelledby="score-h" className="mt-6 grid gap-4 min-[761px]:grid-cols-2">
        <h2 id="score-h" className="sr-only">Who could do it</h2>
        {([["Before", before, a], ["After", after, b]] as const).map(([label, run, id]) => (
          <div key={label} className="card grid gap-2 p-5">
            <p className="text-sm font-bold tracking-wide text-ink-3 uppercase">{label}</p>
            <p className={`font-display text-[clamp(2.6rem,7vw,4rem)] leading-none font-extrabold tracking-[-0.05em] tabular-nums ${run.completed === run.total ? "text-ok" : "text-bad"}`}>
              {run.completed} of {run.total}
            </p>
            <p className="font-medium">people could do it</p>
            <p className="text-[.85rem] break-all text-ink-3">{run.url}</p>
            <Link href={`/replay?id=${encodeURIComponent(id)}`} className="btn btn-sm justify-self-start">
              <span aria-hidden="true">▶</span> Watch the {label.toLowerCase()} run
            </Link>
          </div>
        ))}
      </section>

      <section aria-labelledby="people-h" className="mt-8">
        <h2 id="people-h" className="mb-3 text-[1.3rem] font-bold">Person by person</h2>
        {/* Scrolls sideways on narrow screens, so it takes focus: keyboard users can scroll it with the arrow keys. */}
        <div className="card overflow-x-auto p-0" tabIndex={0} role="region" aria-label="Before and after table">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-edge">
                <th scope="col" className="p-3">Person</th>
                <th scope="col" className="p-3">Before</th>
                <th scope="col" className="p-3">After</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.filter((p) => pb[p] || pa[p]).map((p) => (
                <tr key={p} className="border-b border-line last:border-0">
                  <th scope="row" className="p-3 font-semibold">
                    <span className="inline-flex items-center gap-2"><PersonaIcon id={p} size="sm" />{SHORT_NAME[p]}</span>
                  </th>
                  <td className="p-3"><Outcome m={pb[p]} /></td>
                  <td className="p-3"><Outcome m={pa[p]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="gone-h" className="mt-8 grid gap-4 min-[761px]:grid-cols-2">
        <div>
          <h2 id="gone-h" className="mb-3 text-[1.3rem] font-bold">Fixed ({gone.length})</h2>
          <BarrierList items={gone} empty="No barrier from the first run is gone in the second." />
        </div>
        <div>
          <h2 className="mb-3 text-[1.3rem] font-bold">Still there ({remaining.length})</h2>
          <BarrierList items={remaining} empty="The agents found no barriers in the second run." />
        </div>
      </section>
    </div>
  );
}

function Outcome({ m }: { m?: Member }) {
  if (!m) return <span className="text-ink-3">Not tested</span>;
  return m.success
    ? <span className="pill pill-ok"><span aria-hidden="true">✓</span> Could do it</span>
    : <span className="pill pill-bad"><span aria-hidden="true">✕</span> Got stuck</span>;
}

function BarrierList({ items, empty }: { items: ReturnType<typeof mergeBarriers>; empty: string }) {
  if (!items.length) return <p className="card p-4 text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="grid gap-2">
      {items.map((x) => (
        <li key={x.title} className="card p-4">
          <p className="font-semibold">{x.title}</p>
          <p className="mt-1 text-sm text-ink-2">Found by {[...x.who].join(", ")}{x.severity ? ` · ${x.severity}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}
