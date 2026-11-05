"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import Missing from "@/components/Missing";
import RunView from "@/components/RunView";
import { api, LIVE_ONLY, refreshStatus, SHOWCASE, type Group } from "@/lib/api";
import { History, saveRun } from "@/lib/history";

export default function RunClient() {
  return <Suspense fallback={<p className="wrap pt-10 text-ink-2">Loading…</p>}><LiveRun /></Suspense>;
}

// A run in progress (or just finished) on the server. Polls until every agent is done, then keeps it in History.
function LiveRun() {
  return SHOWCASE ? <Missing title="Live tests aren't in the showcase" message={LIVE_ONLY} /> : <ServerRun />;
}

function ServerRun() {
  const id = useSearchParams().get("id") || "";
  const router = useRouter();
  const [g, setG] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState<ReactNode>("");

  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const poll = async (first: boolean) => {
      try {
        const next = await api<Group>(`/api/run/${id}`);
        if (stop) return;
        setG(next);
        if (next.finished) {
          refreshStatus();
          if (!next.members.some((m) => m.status !== "error")) return;  // nothing ran (e.g. a bad key): not worth keeping
          try {
            await saveRun(next);
            if (!stop) setNote(<>Saved in your <Link href="/history" className="underline">History</Link> (this browser only).</>);
          } catch {
            if (!stop) setNote("Couldn't save this test to History; your browser may be blocking storage. Use Download to keep a copy.");
          }
          return;
        }
      } catch (err) {
        // The server forgot it (restart or redeploy), but this browser may have kept it.
        if (first && await History.get(id).catch(() => undefined)) { router.replace(`/saved?id=${id}`); return; }
        if (!stop) setError((err as Error).message);
        return;
      }
      timer = setTimeout(() => poll(false), 1500);
    };
    poll(true);
    return () => { stop = true; clearTimeout(timer); };
  }, [id, router]);

  if (error && !g) return <Missing message={`${error} It isn’t in this browser’s History either.`} />;
  if (!g) return <p className="wrap pt-10 text-ink-2" role="status">Loading the test…</p>;
  const stop = () => api(`/api/run/${id}/stop`, { method: "POST" }).catch(() => {});
  return <RunView group={g} note={error || note} onStop={stop} />;
}
