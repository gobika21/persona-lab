"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Missing from "@/components/Missing";
import RunView, { type Replay } from "@/components/RunView";
import { REPO_URL, SHOWCASE, type RunRecord } from "@/lib/api";
import { reducedMotion } from "@/hooks/motion";
import { compareHref, listReplays, loadReplay, pairsIn, replayBase, snapshot, timeline, type ReplayInfo } from "@/lib/replay";

export default function ReplayClient() {
  return <Suspense fallback={<p className="wrap pt-10 text-ink-2">Loading…</p>}><ReplayRoute /></Suspense>;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SPEEDS = [1, 2, 4];

function ReplayRoute() {
  const id = useSearchParams().get("id");
  return id ? <Player id={id} /> : <ReplayList />;
}

function ReplayList() {
  const [items, setItems] = useState<ReplayInfo[] | null>(null);
  useEffect(() => { listReplays().then(setItems); }, []);
  return (
    <div className="wrap pb-16">
      <div className="pt-14 pb-6">
        <h1 className="text-[clamp(2rem,5vw,3rem)] font-[750] tracking-[-0.035em]">Watch a real run</h1>
        <p className="mt-3 max-w-[46rem] text-[1.05rem] text-ink-2">
          These are real tests by the four agents, recorded step by step. Watching one is free: nothing calls the AI while it plays.
        </p>
      </div>
      {items === null ? <p role="status" className="text-ink-2">Loading…</p>
        : items.length === 0 ? (
          <div className="rounded-[14px] border-2 border-dashed border-edge bg-surface px-5 py-4.5">
            <h2 className="mb-1.5 text-base font-semibold">No replays yet</h2>
            <p className="text-sm text-ink-2"><Link href="/" className="underline">Run a test</Link> to watch the agents live.</p>
          </div>
        ) : (
          <>
          {pairsIn(items).map((p) => (
            <Link key={p.before} href={compareHref(p)}
              className="card mb-3 flex flex-wrap items-center justify-between gap-2 bg-yellow p-[18px] text-on-pop no-underline hover:-translate-y-px">
              <span><b className="font-display text-[1.1rem]">Before vs after</b> · {p.title}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
          <ul className="grid gap-3 min-[761px]:grid-cols-2">
            {items.map((r) => (
              <li key={r.id} className="card grid gap-2 p-[18px]">
                <h2 className="text-[1.1rem] font-bold"><Link href={`/replay?id=${r.id}`} className="inline-flex min-h-7 items-center text-ink no-underline hover:underline">{r.goal}</Link></h2>
                <p className="text-[.85rem] break-all text-ink-3">{r.url}</p>
                <p className="text-sm text-ink-2"><b className="text-ink">{r.completed} of {r.total}</b> people could do it · {r.steps} steps{r.cost_usd != null && <> · ${r.cost_usd.toFixed(2)} to run</>} · recorded {fmtDay(r.recorded_at)}</p>
                <Link href={`/replay?id=${r.id}`} className="btn btn-primary btn-sm justify-self-start" aria-hidden="true" tabIndex={-1}>
                  <span aria-hidden="true">▶</span> Watch
                </Link>
              </li>
            ))}
          </ul>
          </>
        )}
    </div>
  );
}

function Player({ id }: { id: string }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    loadReplay(id).then((r) => {
      setRec(r);
      // Autoplay, unless the visitor asked for less motion: then it waits for Play.
      setPlaying(!reducedMotion());
    }, (err) => setError((err as Error).message));
  }, [id]);

  const tl = useMemo(() => (rec ? timeline(rec) : null), [rec]);

  useEffect(() => {
    if (!playing || !tl) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((cur) => {
        const next = Math.min(tl.duration, cur + dt);
        if (next >= tl.duration) setPlaying(false);
        return next;
      });
    }, 200);
    return () => clearInterval(timer);
  }, [playing, speed, tl]);

  const snap = useMemo(() => (rec && tl ? snapshot(rec, tl, t) : null), [rec, tl, t]);
  const replay = useMemo<Replay | undefined>(() => rec && snap ? {
    shot: (jid, n) => `${replayBase(id)}/shots/${jid}-${n}.jpg`,
    steps: (jid) => (rec.journeys.find((j) => j.id === jid)?.steps || []).slice(0, snap.revealed[jid] ?? 0),
  } : undefined, [id, rec, snap]);

  if (error) return <Missing message={error} />;
  if (!rec || !tl || !snap) return <p className="wrap pt-10 text-ink-2" role="status">Loading the replay…</p>;

  const atEnd = t >= tl.duration;
  const models = [...new Set(rec.journeys.map((j) => (j as { usage?: { model?: string } }).usage?.model).filter(Boolean))].join(", ");
  const toolbar = (
    <div className="no-print mt-4 grid gap-3 rounded-[18px] border-2 border-edge bg-surface p-3.5 shadow-pop">
      <p className="text-sm text-ink-2">
        <span className="mr-2 inline-flex items-center gap-1 rounded-full border-2 border-edge bg-sky px-2 py-0.5 text-[.72rem] font-bold tracking-wide text-on-pop uppercase">Replay</span>
        A real run recorded on {fmtDay(rec.exported_at)}{models && <> with <code>{models}</code></>}. Played back from a recording, so nothing calls the AI and it&apos;s free to watch.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm min-w-[6.5rem]"
          onClick={() => { if (atEnd) setT(0); setPlaying(!playing); }}>
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span> {playing ? "Pause" : atEnd ? "Replay" : "Play"}
        </button>
        <div role="group" aria-label="Playback speed" className="flex gap-1">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}
              className={`btn btn-sm min-w-11 ${speed === s ? "!bg-ink !text-bg" : ""}`}>
              {s}×<span className="sr-only"> speed</span>
            </button>
          ))}
        </div>
        {!atEnd && <button type="button" className="btn btn-sm" onClick={() => { setT(tl.duration); setPlaying(false); }}>Skip to result</button>}
        <label className="flex min-w-[220px] flex-1 items-center gap-2.5 text-[.8rem] text-ink-2 tabular-nums">
          <span className="sr-only">Replay position</span>
          <input type="range" min={0} max={tl.duration} step={0.5} value={t} className="h-6 flex-1 cursor-pointer accent-lime"
            aria-valuetext={`${clock(t)} of ${clock(tl.duration)}`}
            onChange={(e) => setT(Number(e.target.value))} />
          <span aria-hidden="true">{clock(t)} / {clock(tl.duration)}</span>
        </label>
      </div>
    </div>
  );

  return (
    <>
      <RunView group={snap.group} replay={replay} toolbar={toolbar} />
      {atEnd && (
        <div className="wrap -mt-6 pb-16">
          <div className="card flex flex-wrap items-center justify-between gap-3 bg-yellow p-5 text-on-pop">
            <p className="font-display text-[1.2rem] font-bold">Want to see how your own site does?</p>
            {SHOWCASE
              ? <a href={REPO_URL} className="btn">Run it yourself<span className="sr-only"> (GitHub)</span> <span aria-hidden="true">→</span></a>
              : <Link href="/" className="btn">Test your site <span aria-hidden="true">→</span></Link>}
          </div>
        </div>
      )}
    </>
  );
}
