"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Group, type Journey, type Member, type Step } from "@/lib/api";
import { mergeBarriers, shortLabel } from "@/lib/barriers";
import type { HistoryEntry } from "@/lib/history";
import { ORDER, PERCEIVES, PersonaIcon } from "@/lib/personas";
import Confetti from "./Confetti";
import DownloadMenu from "./DownloadMenu";

const SEV: Record<string, [string, string, string]> = {
  blocker: ["!", "Blocker", "bg-bad-soft text-bad"],
  serious: ["▲", "Serious", "bg-warn/15 text-warn"],
  minor: ["•", "Minor", "bg-line text-ink-2"],
};
const VERB: Record<string, string> = {
  open: "Opened the page", press_key: "Pressed", type_text: "Typed", type_into: "Typed into", click: "Clicked", activate: "Activated",
  read_page: "Read the page", list_elements: "Listed", find_text: "Searched for", scroll: "Scrolled", look: "Looked at the screen",
  go_back: "Went back", report_barrier: "Hit a barrier", finish: "Finished",
};
const isDone = (m: Member) => ["done", "error", "stopped"].includes(m.status);
const goalPhrase = (g: Group) => g.goal.charAt(0).toLowerCase() + g.goal.slice(1);
const stripRefs = (s: string) => s.replace(/ \[ref \d+\]/g, "");

interface Props {
  group: Group;
  /** Set when reopening a finished test from History: no polling, screenshots come from `shots` (object URLs). */
  saved?: HistoryEntry | null;
  shots?: Record<string, string>;
  note?: ReactNode;
  onStop?: () => void;
}

export default function RunView({ group: g, saved, shots = {}, note, onStop }: Props) {
  const [drawer, setDrawer] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const done = g.members.filter(isDone).length;
  const stuck = g.members.filter((m) => !m.success).map((m) => shortLabel(m.persona_label).toLowerCase());
  const members = ORDER.map((p) => g.members.find((m) => m.persona === p)).filter((m): m is Member => !!m);

  return (
    <div className="wrap pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4 pt-7 pb-2">
        <div className="min-w-0">
          <Link href={saved ? "/history" : "/"} className="no-print inline-flex min-h-7 items-center gap-1.5 text-sm text-ink-2 no-underline hover:text-ink">
            <span aria-hidden="true">←</span> {saved ? "All saved tests" : "New test"}
          </Link>
          <h1 className="mt-2.5 text-[1.05rem] font-semibold tracking-normal">{g.goal}</h1>
          <p className="text-sm break-all text-ink-3">{g.url}</p>
        </div>
        <div className="flex items-center gap-2">
          {!g.finished && onStop && <button type="button" className="btn btn-sm no-print" onClick={onStop}>Stop</button>}
          {g.finished && <DownloadMenu runId={g.id} onError={setError} printHere={!!saved} />}
        </div>
      </div>
      <p role="status" aria-live="polite" className="no-print mt-1 min-h-[1.4em] text-sm text-ink-2">{error || note}</p>

      <div aria-live="polite" className="my-5 grid gap-2.5">
        {g.finished ? (
          <>
            <span className={`origin-left animate-pop font-display text-[clamp(3rem,9vw,5.5rem)] leading-[.95] font-extrabold tracking-[-0.05em] tabular-nums ${g.completed === g.total ? "text-ok" : "text-bad"}`}>
              {g.completed} of {g.total}
            </span>
            <span className="max-w-[46ch] text-[clamp(1.15rem,2.6vw,1.6rem)] leading-tight font-semibold tracking-[-0.02em]">
              people could {goalPhrase(g)}.{" "}
              {g.completed < g.total && <span className="font-medium text-ink-2">Stuck: {stuck.join(", ")}.</span>}
            </span>
          </>
        ) : (
          <span className="max-w-[46ch] text-[clamp(1.15rem,2.6vw,1.6rem)] leading-tight font-semibold tracking-[-0.02em]">
            {g.total} agents are trying to {goalPhrase(g)}… <span className="font-medium text-ink-2">{done} of {g.total} finished</span>
          </span>
        )}
      </div>
      {!g.finished && (
        <div aria-hidden="true" className="mt-1 h-3 overflow-hidden rounded-full border-2 border-edge bg-surface">
          <i className="block h-full bg-lime transition-[width] duration-400" style={{ width: `${Math.max(4, (done / g.total) * 100)}%` }} />
        </div>
      )}

      <section aria-labelledby="agents-h" className="mt-6 grid gap-4 min-[861px]:grid-cols-2 print:grid-cols-2">
        <h2 id="agents-h" className="sr-only">How each person did</h2>
        {g.finished && !saved && g.completed === g.total && <Confetti />}
        {members.map((m, i) => <AgentCard key={m.id} i={i} m={m} saved={!!saved} shot={saved ? shots[m.id] : m.shot ? `/api/journey/${m.id}/shot/${m.shot}.jpg` : undefined} onSteps={() => setDrawer(m)} />)}
      </section>

      {g.finished && <Barriers g={g} />}

      <StepsDrawer member={drawer} saved={saved} onClose={() => setDrawer(null)} />
    </div>
  );
}

function AgentCard({ m, i, shot, saved, onSteps }: { m: Member; i: number; shot?: string; saved: boolean; onSteps: () => void }) {
  const last = m.last || ({} as NonNullable<Member["last"]>);
  const thought = m.status === "error" ? m.error : isDone(m) ? m.summary || "" : last.thought || m.current || "Starting…";
  const finished = isDone(m) || m.status === "error";

  let pill: ReactNode, pillCls = "";
  if (m.status === "error") { pillCls = "pill-bad"; pill = <><span aria-hidden="true">!</span> Couldn&apos;t run</>; }
  else if (!isDone(m)) pill = <><span aria-hidden="true" className="size-1.5 animate-blink rounded-full bg-current" /> Trying</>;
  else if (m.success) { pillCls = "pill-ok"; pill = <><span aria-hidden="true">✓</span> Completed</>; }
  else { pillCls = "pill-bad"; pill = <><span aria-hidden="true">✕</span> {m.status === "stopped" ? "Stopped" : "Got stuck"}</>; }

  let screen: ReactNode;
  if (m.persona === "screen_reader") {
    screen = (
      <div className="absolute inset-0 overflow-hidden bg-term-bg px-4 py-3.5 font-mono text-[.78rem] leading-relaxed whitespace-pre-wrap text-term-ink after:absolute after:inset-x-0 after:bottom-0 after:h-15 after:bg-linear-to-b after:from-transparent after:to-term-bg">
        <span className="mb-1.5 block text-[#8b8b93]">Screen reader output</span>
        {last.heard ? stripRefs(last.heard).slice(0, 900) : last.result || "Listening…"}
      </div>
    );
  } else if (shot) {
    // eslint-disable-next-line @next/next/no-img-element -- live API image or a blob: URL; next/image can't optimize either
    screen = <img src={shot} alt={`What the ${m.persona_label.toLowerCase()} sees at step ${m.shot}`} className="block size-full object-cover object-top-left" />;
  } else if (saved) {
    screen = <p className="absolute inset-0 grid place-items-center p-4 text-center text-[.85rem] text-ink-3">No screenshot saved for this test.</p>;
  } else {
    screen = <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-bg via-line to-bg bg-[length:200%_100%] opacity-60" />;
  }

  return (
    <article aria-labelledby={`h-${m.id}`} className="flex animate-rise flex-col overflow-hidden card rounded-2xl break-inside-avoid transition-transform duration-200 hover:-translate-y-1"
      style={{ animationDelay: `${i * 90}ms` }}>
      <div className="flex items-center gap-2.5 border-b-2 border-edge px-3.5 py-3">
        <PersonaIcon id={m.persona} size="sm" />
        <h3 id={`h-${m.id}`} className="min-w-0 flex-1 text-[.92rem] font-semibold tracking-[-0.01em]">{m.persona_label}</h3>
        <span key={m.status + (m.success ? "1" : "0")} className={`pill animate-pop ${pillCls}`}>{pill}</span>
      </div>
      <div className="relative aspect-16/10 overflow-hidden border-b-2 border-edge bg-bg">{screen}</div>
      <div className="grid flex-1 content-start gap-3 px-3.5 pt-3 pb-3.5">
        <p className={`text-sm text-ink-2 italic ${finished ? "" : "line-clamp-2 min-h-[2.8em]"}`}>
          {thought ? (finished ? thought : `“${thought}”`) : ""}
        </p>
        {isDone(m) && <Outcome m={m} />}
        <div className="mt-auto flex items-center justify-between gap-2 text-[.8rem] text-ink-3">
          <span>{m.steps} steps · {m.barriers} barrier{m.barriers === 1 ? "" : "s"}</span>
          <button type="button" className="btn btn-sm no-print" onClick={onSteps}>View steps</button>
        </div>
      </div>
    </article>
  );
}

const RANK: Record<string, number> = { blocker: 0, serious: 1, minor: 2 };
const CARD_MAX = 3;

// Per person: what blocked them (their own barriers, most severe first) and what worked for them.
function Outcome({ m }: { m: Member }) {
  const wrong = [...(m.barrier_list || [])]
    .sort((a, b) => (RANK[a.severity ?? ""] ?? 3) - (RANK[b.severity ?? ""] ?? 3) || (a.source === "agent" ? -1 : 1));
  const worked = m.worked || [];
  if (!wrong.length && !worked.length) return null;
  const h = "mb-1.5 text-[.72rem] font-bold tracking-wider text-ink-3 uppercase";
  return (
    <div className="grid gap-3 border-t border-line pt-3 text-sm">
      {wrong.length > 0 && (
        <div>
          <h4 className={h}>What went wrong</h4>
          <ul className="grid gap-1.5">
            {wrong.slice(0, CARD_MAX).map((b, i) => {
              const [, label] = SEV[b.severity ?? ""] || SEV.minor;
              return (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="font-bold text-bad">✕</span>
                  <span className="min-w-0"><span className="mr-1.5 text-[.72rem] font-bold text-ink-3 uppercase">{label}</span>{b.title}</span>
                </li>
              );
            })}
          </ul>
          {wrong.length > CARD_MAX && (
            <a href="#barriers-h" className="mt-1.5 inline-block text-[.8rem] text-ink-2 underline">
              {wrong.length - CARD_MAX} more, with fixes, below
            </a>
          )}
        </div>
      )}
      {worked.length > 0 && (
        <div>
          <h4 className={h}>What worked</h4>
          <ul className="grid gap-1.5">
            {worked.map((w, i) => (
              <li key={i} className="flex gap-2"><span aria-hidden="true" className="font-bold text-ok">✓</span><span className="min-w-0">{w}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Barriers({ g }: { g: Group }) {
  const items = mergeBarriers(g);
  return (
    <section aria-labelledby="barriers-h" className="mt-10">
      <h2 id="barriers-h" className="mb-1 text-[1.35rem] font-semibold">What blocked people</h2>
      <p className="text-sm text-ink-2">
        {items.length
          ? `${items.length} barrier${items.length === 1 ? "" : "s"}, reported by the agents or detected automatically along the way.`
          : "No barriers found on this task. Automated agents don't catch everything, so also test with real people."}
      </p>
      <ul className="mt-4 grid gap-2.5">
        {items.map((b, i) => {
          const [ic, label, cls] = SEV[b.severity ?? ""] || SEV.minor;
          return (
            <li key={i} className="grid animate-rise grid-cols-[auto_1fr] gap-3.5 card px-[18px] py-4 break-inside-avoid" style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
              <span aria-hidden="true" className={`grid size-7 place-items-center rounded-lg text-[.85rem] font-extrabold ${cls}`}>{ic}</span>
              <div>
                <h3 className="text-[.98rem] font-semibold tracking-[-0.01em]">
                  <span className="mr-2 text-[.72rem] font-bold tracking-wider text-ink-3 uppercase">{label}</span>{b.title}
                </h3>
                {b.detail && <p className="mt-1 text-[.9rem] text-ink-2">{b.detail}</p>}
                {b.fix && <div className="mt-2.5 rounded-[10px] border-2 border-edge bg-lime/40 px-3 py-2 text-sm"><b className="font-semibold">Fix:</b> {b.fix}</div>}
                {b.also.length > 0 && <p className="mt-2 text-[.78rem] text-ink-3">Also detected automatically: {b.also.join("; ")}</p>}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {[...b.who].map((w) => <span key={w} className="rounded-full border border-line px-2 py-0.5 text-[.75rem] text-ink-2">{w}</span>)}
                  {b.wcag && <span className="rounded-full border border-line px-2 py-0.5 text-[.75rem] text-ink-2">WCAG {b.wcag}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StepsDrawer({ member, saved, onClose }: { member: Member | null; saved?: HistoryEntry | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [live, setLive] = useState<{ id: string; steps: Step[] }>({ id: "", steps: [] });

  useEffect(() => {
    const d = dlg.current!;
    if (member && !d.open) d.showModal();
    if (!member && d.open) d.close();
  }, [member]);

  // Live runs: fetch new steps while the drawer is open and the agent is still working.
  useEffect(() => {
    if (!member || saved) return;
    let seen = 0, stop = false, timer: ReturnType<typeof setTimeout>;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when a different agent is opened
    setLive({ id: member.id, steps: [] });
    const tick = async () => {
      try {
        const j = await api<Journey>(`/api/journey/${member.id}?since=${seen}`);
        if (stop) return;
        seen = j.step_count;
        if (j.steps.length) setLive((cur) => ({ id: member.id, steps: [...cur.steps, ...j.steps] }));
        if (["done", "error", "stopped"].includes(j.status)) return;
      } catch { return; }
      timer = setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [member, saved]);

  const journey = member && saved ? saved.record.journeys.find((j) => j.id === member.id) : undefined;
  const steps = saved ? journey?.steps || [] : live.id === member?.id ? live.steps : [];
  const sr = member?.persona === "screen_reader";

  return (
    <dialog ref={dlg} aria-labelledby="drawer-h" onClose={onClose}
      className="m-0 ml-auto h-dvh max-h-dvh w-[min(560px,100vw)] max-w-none border-0 border-l-2 border-edge bg-surface p-0 text-ink backdrop:bg-black/35">
      <div className="sticky top-0 z-1 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4">
        <h2 id="drawer-h" className="text-[1.05rem] font-semibold">{member?.persona_label || "Steps"}</h2>
        <div className="flex gap-2">
          {member && !saved && <a className="btn btn-sm" href={`/api/journey/${member.id}/report.html`} download>Report</a>}
          <form method="dialog"><button className="btn btn-sm">Close</button></form>
        </div>
      </div>
      <div className="px-5 pt-2 pb-10">
        <p className="mt-3 text-sm text-ink-2">
          {member && PERCEIVES[member.persona]}
          {saved && !sr && " Screenshots of every step are in the HTML report."}
        </p>
        <ol className="m-0 list-none p-0">
          {steps.map((st) => <StepItem key={st.n + st.tool} st={st} jid={member!.id} sr={sr} shots={!saved} />)}
        </ol>
      </div>
    </dialog>
  );
}

function StepItem({ st, jid, sr, shots }: { st: Step; jid: string; sr: boolean; shots: boolean }) {
  const inp = st.input || {};
  const detail = inp.key ? `${inp.key}${(inp.times ?? 0) > 1 ? " ×" + inp.times : ""}` : inp.text || inp.query || "";
  const barrier = st.tool === "report_barrier";
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3 border-b border-line py-4">
      <span aria-hidden="true" className={`grid size-[26px] place-items-center rounded-full border text-[.75rem] font-bold ${barrier ? "border-transparent bg-bad-soft text-bad" : "border-line-2 text-ink-2"}`}>
        {barrier ? "!" : st.n}
      </span>
      <div className="min-w-0">
        {st.thought && <p className="text-sm text-ink-2 italic">“{st.thought}”</p>}
        <p className="mt-0.5 text-[.9rem]">
          <b className="font-semibold">{VERB[st.tool] || st.tool}</b> {detail && <code>{String(detail)}</code>} <span className="text-ink-2">{st.result}</span>
        </p>
        {sr && st.heard && (
          <pre className="mt-2.5 max-h-60 overflow-auto rounded-[10px] bg-term-bg px-3 py-2.5 text-[.75rem] whitespace-pre-wrap text-term-ink">{stripRefs(st.heard)}</pre>
        )}
        {!sr && shots && st.has_shot && (
          // eslint-disable-next-line @next/next/no-img-element -- screenshot served by the API
          <img src={`/api/journey/${jid}/shot/${st.n}.jpg`} alt={`Screen at step ${st.n}`} loading="lazy" className="mt-2.5 block w-full rounded-[10px] border border-line" />
        )}
      </div>
    </li>
  );
}
