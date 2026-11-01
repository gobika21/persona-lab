"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Demo, type EvalSummary, type Group, type PersonaInfo } from "@/lib/api";
import Stat from "@/components/Stat";
import { ORDER, PERCEIVES, PersonaIcon } from "@/lib/personas";

const DEMO_NAMES: Record<string, string> = { hotel: "Sunset Hotel", shop: "Kiln & Co. shop", clinic: "Marina Clinic", library: "Al Safa Library" };
const DEMO_PICKS: Record<string, string> = { "hotel-book": "Book a room", "shop-green-mug": "Buy the green mug", "clinic-book": "Book a doctor" };
const pct = (x: number | null | undefined) => (x == null ? "–" : Math.round(x * 100) + "%");

export default function Home() {
  const router = useRouter();
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [demos, setDemos] = useState<Demo[]>([]);
  const [evals, setEvals] = useState<EvalSummary[]>([]);
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const goalRef = useRef<HTMLInputElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Links from the earlier single-page version: /#run=<id> and /#history
    const m = location.hash.match(/^#(run|saved)=([a-f0-9]+)/);
    if (m) { router.replace(`/${m[1]}?id=${m[2]}`); return; }
    if (location.hash === "#history") { router.replace("/history"); return; }
    api<PersonaInfo[]>("/api/personas").then(setPersonas).catch(() => {});
    api<Demo[]>("/api/demos").then(setDemos).catch(() => {});
    api<EvalSummary[]>("/api/evals").then(setEvals).catch(() => {});
  }, [router]);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || !goal.trim()) {
      setMsg({ text: !url.trim() ? "Enter a website address." : "Describe what a visitor should be able to do, e.g. “Find the contact email”.", error: true });
      (!url.trim() ? urlRef : goalRef).current?.focus();
      return;
    }
    setBusy(true); setMsg({ text: "Starting four browsers…" });
    try {
      const g = await api<Group>("/api/run", { method: "POST", body: { url: url.trim(), goal: goal.trim() } });
      router.push(`/run?id=${g.id}`);
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true }); setBusy(false);
    }
  }

  const base = evals.find((r) => r.kind === "baseline");
  const agent = evals.find((r) => r.kind === "agents");
  const tiles: [string, string, string][] = [];
  if (base) tiles.push(["Rules-only checks", pct(base.metrics.barrier_recall), "of planted barriers found by page rules alone"]);
  if (agent) {
    tiles.push(["Persona agents", pct(agent.metrics.barrier_recall), `of planted barriers found (${agent.label})`]);
    tiles.push(["Right verdict", pct(agent.metrics.outcome_accuracy), "correct call on whether each person can finish"]);
  } else if (base) {
    tiles.push(["Benchmark", "12", "planted barriers across 4 demo sites"], ["Tasks", "5 × 4", "tasks × personas with known outcomes"]);
  }

  return (
    <>
      <section className="wrap pt-12 pb-6 text-center sm:pt-22 sm:pb-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[.8rem] font-semibold text-ink-2">
          <i aria-hidden="true" className="inline-block size-1.5 rounded-full bg-accent" />AI agents for accessibility testing
        </span>
        <h1 className="mx-auto mt-5 mb-4 max-w-[14ch] text-[clamp(2.3rem,6vw,4rem)] font-[750] tracking-[-0.035em]">Can everyone use your website?</h1>
        <p className="mx-auto max-w-[46rem] text-[clamp(1rem,2.2vw,1.2rem)] text-ink-2">
          Four AI agents try a real task on your site the way disabled people browse: <strong className="text-ink">keyboard only</strong>, with a{" "}
          <strong className="text-ink">screen reader</strong>, with <strong className="text-ink">color blindness</strong>, and at{" "}
          <strong className="text-ink">200% zoom</strong>. You see exactly where each one gets stuck.
        </p>

        <form onSubmit={start} noValidate
          className="mx-auto mt-9 grid max-w-[760px] items-end gap-2.5 rounded-[18px] border border-line bg-surface p-3.5 text-left shadow-pop min-[761px]:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1.5">
            <span className="text-[.8rem] font-semibold text-ink-2">Website</span>
            <input ref={urlRef} className="input" type="text" inputMode="url" autoComplete="url" placeholder="https://example.com" required
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[.8rem] font-semibold text-ink-2">Task <span className="font-normal text-ink-3">(what a visitor should be able to do)</span></span>
            <input ref={goalRef} className="input" type="text" placeholder="e.g. Find the contact email" required
              value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <button ref={runRef} className="btn btn-primary btn-lg w-full min-[761px]:w-auto" type="submit" disabled={busy}>Run test</button>
        </form>
        <p role="status" aria-live="polite" className={`mx-auto mt-2.5 min-h-[1.4em] max-w-[760px] text-left text-[.9rem] ${msg.error ? "font-semibold text-bad" : "text-ink-2"}`}>
          {msg.text}
        </p>
        <div className="mx-auto mt-4.5 flex max-w-[760px] flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-[.82rem] text-ink-3">No site handy? Try a demo:</span>
          {demos.filter((d) => d.id in DEMO_PICKS).map((d) => (
            <button key={d.id} type="button"
              className="cursor-pointer rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[.82rem] text-ink-2 hover:border-solid hover:border-ink-3 hover:text-ink"
              onClick={() => { setUrl(d.path); setGoal(d.goal); runRef.current?.focus(); }}>
              <b className="font-semibold text-ink">{DEMO_NAMES[d.site] || d.site}</b> · {DEMO_PICKS[d.id]}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="who-h" className="wrap py-14">
        <div className="mb-6">
          <h2 id="who-h" className="text-[1.6rem] font-semibold">The four testers</h2>
          <p className="mt-1.5 max-w-[40rem] text-ink-2">Each agent only gets the senses and controls that person has. The screen-reader agent never sees a pixel.</p>
        </div>
        <div className="grid gap-3 min-[521px]:grid-cols-2 min-[901px]:grid-cols-4">
          {ORDER.map((id) => personas.find((p) => p.id === id)).filter((p): p is PersonaInfo => !!p).map((p) => (
            <article key={p.id} className="card p-[18px]">
              <div className="mb-3.5"><PersonaIcon id={p.id} /></div>
              <h3 className="mb-1.5 text-base font-semibold tracking-[-0.01em]">{p.label}</h3>
              <p className="text-sm text-ink-2">{p.who}</p>
              <p className="mt-3 border-t border-line pt-3 text-[.8rem] text-ink-3">{PERCEIVES[p.id]}</p>
            </article>
          ))}
        </div>
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="proof-h" className="wrap py-14">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="proof-h" className="text-[1.6rem] font-semibold">Measured, not guessed</h2>
              <p className="mt-1.5 max-w-[40rem] text-ink-2">The agents are scored against a benchmark of websites with planted barriers and known outcomes.</p>
            </div>
            <Link href="/evals" className="font-semibold text-accent no-underline hover:underline">See the evaluation →</Link>
          </div>
          <div className="grid gap-3 min-[761px]:grid-cols-3">
            {tiles.map(([k, v, d]) => <Stat key={k} k={k} v={v} d={d} />)}
          </div>
        </section>
      )}
    </>
  );
}
