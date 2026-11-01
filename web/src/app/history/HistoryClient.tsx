"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import DownloadMenu from "@/components/DownloadMenu";
import { shortLabel } from "@/lib/barriers";
import { History, historyEntry, validRecord, type HistoryEntry } from "@/lib/history";
import { ICONS, ORDER } from "@/lib/personas";

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function HistoryClient() {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [msg, setMsg] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setItems(await History.list()); } catch (err) { setItems([]); setMsg((err as Error).message); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the browser's saved tests on mount
    load();
    heading.current?.focus();
  }, [load]);

  // Preview images live in IndexedDB as Blobs; give them object URLs while this list is shown.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const r of items || []) if (r.thumb) urls[r.id] = URL.createObjectURL(r.thumb);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the Blobs just loaded
    setThumbs(urls);
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
  }, [items]);

  async function remove(r: HistoryEntry) {
    if (!confirm(`Delete “${r.goal}” from History? This can't be undone.`)) return;
    await History.del(r.id);
    await load();
    setMsg(`Deleted “${r.goal}”.`);
    heading.current?.focus();
  }

  async function clearAll() {
    if (!confirm("Delete every saved test from History in this browser? This can't be undone.")) return;
    await History.clear();
    await load();
    setMsg("History cleared.");
    heading.current?.focus();
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error("That file is too large to be a Persona Lab export.");
      let record: unknown;
      try { record = JSON.parse(await f.text()); } catch { throw new Error("That file isn't valid JSON."); }
      if (!validRecord(record)) throw new Error("That file isn't a Persona Lab test (download one with Download → Data (JSON)).");
      if (await History.get(record.run.id)) { setMsg(`“${record.run.goal}” is already in your History.`); return; }
      await History.put(historyEntry(record, true), {});
      await load();
      setMsg(`Imported “${record.run.goal}”.`);
    } catch (err) { setMsg((err as Error).message); }
  }

  return (
    <div className="wrap pb-16">
      <div className="pt-14 pb-6">
        <h1 ref={heading} tabIndex={-1} className="text-[clamp(2rem,5vw,3rem)] font-[750] tracking-[-0.035em]">History</h1>
        <p className="mt-3 max-w-[46rem] text-[1.05rem] text-ink-2">
          Your finished tests are saved <strong className="text-ink">in this browser only</strong>, so you can reopen and download them later.
          Nothing is kept on our server. Clearing this site&apos;s data in your browser deletes them. Up to 30 tests are kept; the oldest are removed first.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}>Import JSON</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={onImport} />
        {!!items?.length && <button type="button" className="btn btn-sm" onClick={clearAll}>Clear all</button>}
      </div>
      <p role="status" aria-live="polite" className="min-h-[1.4em] text-sm text-ink-2">{msg}</p>

      {items && items.length === 0 && (
        <div className="mt-3 rounded-[14px] border border-dashed border-line-2 bg-surface px-5 py-4.5">
          <h2 className="mb-1.5 text-base font-semibold">No saved tests yet</h2>
          <p className="text-sm text-ink-2">
            When a test finishes it appears here automatically. <Link href="/" className="underline">Run a test</Link>, or import a JSON file you downloaded earlier.
          </p>
        </div>
      )}

      <ul aria-label="Saved tests" className="mt-2 grid gap-2.5">
        {items?.map((r) => {
          return (
            <li key={r.id} className="card grid grid-cols-[96px_1fr] gap-3.5 p-3.5 sm:grid-cols-[176px_1fr] sm:gap-5 sm:p-4">
              {/* Preview for pointer users; the title link below is the same destination for keyboard and screen readers. */}
              <Link href={`/saved?id=${r.id}`} tabIndex={-1} aria-hidden="true"
                className="relative block aspect-16/10 self-start overflow-hidden rounded-lg border border-line bg-bg hover:border-ink-3">
                {thumbs[r.id]
                  // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
                  ? <img src={thumbs[r.id]} alt="" className="size-full object-cover object-top-left" />
                  : <span className="absolute inset-0 grid place-items-center px-2 text-center text-[.72rem] text-ink-3">No preview</span>}
              </Link>
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-[-0.01em]">
                  <Link href={`/saved?id=${r.id}`} className="text-ink no-underline hover:underline">{r.goal}</Link>
                </h2>
                <p className="mt-0.5 text-[.85rem] break-all text-ink-3">{r.url}</p>
                <ul aria-label="Result for each person" className="mt-2.5 flex flex-wrap gap-1.5">
                  {ORDER.map((p) => r.record.run.members.find((m) => m.persona === p)).filter((m) => !!m).map((m) => {
                    const ok = !!m.success, label = `${shortLabel(m.persona_label)}: ${m.status === "error" ? "couldn't run" : ok ? "completed" : "got stuck"}`;
                    return (
                      <li key={m.id} title={label} className={`pill gap-1 py-0.5 pl-1 [&_svg]:size-3.5 ${ok ? "pill-ok" : "pill-bad"}`}>
                        {ICONS[m.persona]}<span aria-hidden="true">{ok ? "✓" : "✕"}</span><span className="sr-only">{label}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                  <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[.82rem] text-ink-2">
                    <span className="font-semibold text-ink">{r.completed} of {r.total} could do it</span>
                    <span>{r.barriers} barrier{r.barriers === 1 ? "" : "s"}</span>
                    <span>{fmtDate(r.run_at || r.saved_at)}</span>
                    {r.imported && <span>Imported</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    <DownloadMenu runId={r.id} onError={setMsg} />
                    <button type="button" className="btn btn-sm" onClick={() => remove(r)}>
                      Delete<span className="sr-only"> “{r.goal}”</span>
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
