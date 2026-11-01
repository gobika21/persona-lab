"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Missing from "@/components/Missing";
import RunView from "@/components/RunView";
import { History, type HistoryEntry } from "@/lib/history";

export default function SavedClient() {
  return <Suspense fallback={<p className="wrap pt-10 text-ink-2">Loading…</p>}><SavedRun /></Suspense>;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// A finished test reopened from this browser's History: works without the server having it.
function SavedRun() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const print = params.get("print") === "1";
  const [state, setState] = useState<{ entry?: HistoryEntry; shots: Record<string, string>; missing?: boolean }>({ shots: {} });

  useEffect(() => {
    let urls: string[] = [], stop = false;
    (async () => {
      const entry = await History.get(id).catch(() => undefined);
      if (stop) return;
      if (!entry) { setState({ shots: {}, missing: true }); return; }
      const files = await History.files(id).catch(() => undefined);
      const shots: Record<string, string> = {};
      for (const [jid, blob] of Object.entries(files?.shots || {})) shots[jid] = URL.createObjectURL(blob);
      urls = Object.values(shots);
      if (!stop) setState({ entry, shots });
    })();
    return () => { stop = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [id]);

  // Opened via Download → PDF for a test with no stored report: print this page once it's drawn.
  useEffect(() => {
    if (print && state.entry) setTimeout(() => window.print(), 300);
  }, [print, state.entry]);

  if (state.missing) return <Missing message="This test isn't saved in this browser." />;
  if (!state.entry) return <p className="wrap pt-10 text-ink-2" role="status">Loading the saved test…</p>;
  const e = state.entry;
  return (
    <RunView group={e.record.run} saved={e} shots={state.shots}
      note={`Saved test from ${fmtDate(e.run_at || e.saved_at)}${e.imported ? " (imported from a file)" : ""}.`} />
  );
}
