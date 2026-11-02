"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Demo, type EvalSummary, type Group, type PersonaInfo } from "@/lib/api";
import Reveal from "@/components/Reveal";
import SimBar from "@/components/SimBar";
import Stat from "@/components/Stat";
import TiltCard from "@/components/TiltCard";
import { ORDER, PERCEIVES, PersonaIcon, SHORT_NAME } from "@/lib/personas";

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
  const [msg, setMsg] = useState<{ text: string; error?: "url" | "goal" | "server" }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ id: string; n: number } | null>(null);
  const [paused, setPaused] = useState(false);
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
      setMsg(!url.trim() ? { text: "Enter a website address.", error: "url" }
        : { text: "Describe what a visitor should be able to do, e.g. “Find the contact email”.", error: "goal" });
      (!url.trim() ? urlRef : goalRef).current?.focus();
      return;
    }
    setBusy(true); setMsg({ text: "Starting four browsers…" });
    try {
      const g = await api<Group>("/api/run", { method: "POST", body: { url: url.trim(), goal: goal.trim() } });
      router.push(`/run?id=${g.id}`);
    } catch (err) {
      setMsg({ text: (err as Error).message, error: "server" }); setBusy(false);
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
      <section data-sim-target className="wrap pt-12 pb-6 text-center sm:pt-22 sm:pb-10">
        <span className="inline-flex animate-float -rotate-2 items-center gap-2 rounded-full border-2 border-edge bg-yellow px-3.5 py-1.5 text-[.8rem] font-bold text-on-pop shadow-[3px_3px_0_var(--edge)]">
          <span aria-hidden="true">✦</span>AI agents for accessibility testing
        </span>
        <h1 className="mx-auto mt-6 mb-5 max-w-[13ch] text-[clamp(2.6rem,7.5vw,5rem)] leading-[1] font-bold tracking-[-0.045em]">
          {["Can", "everyone", "use", "your", "website?"].map((w, i) => (
            <span key={w}>
              <span className={`inline-block animate-rise ${w === "everyone" ? "marker" : ""}`} style={{ animationDelay: `${i * 70}ms` }}>{w}</span>{i < 4 && " "}
            </span>
          ))}
        </h1>
        <p className="mx-auto max-w-[46rem] animate-rise text-[clamp(1rem,2.2vw,1.2rem)] text-ink-2 [animation-delay:350ms]">
          Four AI agents try a real task on your site the way disabled people browse: <strong className="text-ink">keyboard only</strong>, with a{" "}
          <strong className="text-ink">screen reader</strong>, with <strong className="text-ink">color blindness</strong>, and at{" "}
          <strong className="text-ink">200% zoom</strong>. You see exactly where each one gets stuck.
        </p>

        <form onSubmit={start} noValidate
          className="mx-auto mt-9 grid max-w-[760px] animate-rise items-end [animation-delay:480ms] gap-2.5 rounded-[20px] border-2 border-edge bg-surface p-3.5 text-left shadow-pop min-[761px]:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1.5">
            <span className="text-[.8rem] font-bold text-ink">Website</span>
            <input ref={urlRef} className="input" type="text" inputMode="url" autoComplete="url" placeholder="https://example.com" required
              aria-invalid={msg.error === "url" || undefined} aria-describedby={msg.error === "url" ? "form-msg" : undefined}
              value={url} onChange={(e) => { setUrl(e.target.value); if (msg.error === "url") setMsg({ text: "" }); }} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[.8rem] font-bold text-ink">Task <span className="font-normal text-ink-3">(what a visitor should be able to do)</span></span>
            <input ref={goalRef} className="input" type="text" placeholder="e.g. Find the contact email" required
              aria-invalid={msg.error === "goal" || undefined} aria-describedby={msg.error === "goal" ? "form-msg" : undefined}
              value={goal} onChange={(e) => { setGoal(e.target.value); if (msg.error === "goal") setMsg({ text: "" }); }} />
          </label>
          <button ref={runRef} className="group btn btn-primary btn-lg w-full min-[761px]:w-auto" type="submit" disabled={busy}>
            {busy ? "Starting…" : "Run test"} <span aria-hidden="true" className={`inline-block transition-transform group-hover:translate-x-1 ${busy ? "animate-wiggle [animation-iteration-count:infinite]" : ""}`}>→</span>
          </button>
        </form>
        <p id="form-msg" role="status" aria-live="polite" className={`mx-auto mt-2.5 min-h-[1.4em] max-w-[760px] text-left text-[.9rem] ${msg.error ? "font-semibold text-bad" : "text-ink-2"}`}>
          {msg.text}
        </p>
        <div className="mx-auto mt-4.5 flex max-w-[760px] animate-rise flex-wrap items-center justify-center gap-2 [animation-delay:600ms]">
          <span className="mr-1 text-[.82rem] text-ink-3">No site handy? Try a demo:</span>
          {demos.filter((d) => d.id in DEMO_PICKS).map((d) => (
            <button key={picked?.id === d.id ? `${d.id}-${picked.n}` : d.id} type="button"
              className={`cursor-pointer ${picked?.id === d.id ? "animate-wiggle" : ""} rounded-full border-2 border-dashed border-edge bg-surface px-3 py-1.5 text-[.82rem] text-ink-2 transition-transform hover:-rotate-1 hover:border-solid hover:bg-yellow hover:text-on-pop [&:hover_b]:text-on-pop`}
              onClick={() => { setUrl(d.path); setGoal(d.goal); setPicked({ id: d.id, n: (picked?.n ?? 0) + 1 }); runRef.current?.focus(); }}>
              <b className="font-semibold text-ink">{DEMO_NAMES[d.site] || d.site}</b> · {DEMO_PICKS[d.id]}
            </button>
          ))}
        </div>
      </section>

      <div data-pausable className="group relative mt-8 overflow-hidden border-y-2 border-edge bg-ink py-3 text-bg">
        <div data-sim-target aria-hidden="true" className={`flex w-max animate-marquee group-hover:[animation-play-state:paused] ${paused ? "[animation-play-state:paused]" : ""} font-display text-[1.05rem] font-bold whitespace-nowrap`}>
          {[0, 1].map((k) => (
            <span key={k} className="flex">
              {[...ORDER, ...ORDER].map((id, i) => <span key={i} className="px-5">{SHORT_NAME[id]} <span className="ml-5 text-lime">✦</span></span>)}
            </span>
          ))}
        </div>
        <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}
          className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-2 border-edge bg-lime text-[.8rem] font-bold text-on-pop">
          <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span><span className="sr-only">Pause the scrolling banner</span>
        </button>
      </div>

      <section aria-labelledby="who-h" className="wrap py-14">
        <div className="mb-6">
          <h2 id="who-h" className="text-[clamp(1.7rem,4vw,2.3rem)] font-bold">The four testers</h2>
          <p className="mt-1.5 max-w-[40rem] text-ink-2">Each agent only gets the senses and controls that person has. The screen-reader agent never sees a pixel.</p>
        </div>
        <div className="mb-5"><SimBar /></div>
        <div data-sim-target className="grid gap-3 min-[521px]:grid-cols-2 min-[901px]:grid-cols-4">
          {ORDER.map((id) => personas.find((p) => p.id === id)).filter((p): p is PersonaInfo => !!p).map((p, i) => (
            <Reveal key={p.id} delay={i * 90} className="grid">
            <TiltCard className={`card group p-[18px] ${["rotate-[-1deg]", "rotate-[1deg]", "rotate-[-.5deg]", "rotate-[.8deg]"][i]} hover:rotate-0`}>
              <div className="mb-3.5 inline-block group-hover:animate-wiggle"><PersonaIcon id={p.id} /></div>
              <h3 className="mb-1.5 text-[1.1rem] font-bold">{p.label}</h3>
              <p className="text-sm text-ink-2">{p.who}</p>
              <p className="mt-3 border-t-2 border-dashed border-line pt-3 text-[.8rem] text-ink-3">{PERCEIVES[p.id]}</p>
            </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="proof-h" className="wrap py-14">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="proof-h" className="text-[clamp(1.7rem,4vw,2.3rem)] font-bold">Measured, not guessed</h2>
              <p className="mt-1.5 max-w-[40rem] text-ink-2">The agents are scored against a benchmark of websites with planted barriers and known outcomes.</p>
            </div>
            <Link href="/evals" className="btn">See the evaluation <span aria-hidden="true">→</span></Link>
          </div>
          <div className="grid gap-3 min-[761px]:grid-cols-3">
            {tiles.map(([k, v, d], i) => <Reveal key={k} delay={i * 110} className="grid"><Stat k={k} v={v} d={d} /></Reveal>)}
          </div>
        </section>
      )}
    </>
  );
}
