"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { downloadRun, type DownloadKind } from "@/lib/history";

const OPTIONS: [DownloadKind, string, string][] = [
  ["html", "HTML report", "to share or email"],
  ["pdf", "PDF", "opens Print, choose Save as PDF"],
  ["csv", "Barriers (CSV)", "for spreadsheets and issue trackers"],
  ["json", "Data (JSON)", "can be imported back into History"],
];

/**
 * A native <details> disclosure, so it works with keyboard and screen readers without extra ARIA.
 * PDF for a test with no stored report (imported) prints the results page itself: here when `printHere`
 * (we're on it), otherwise by opening it.
 */
export default function DownloadMenu({ runId, onError, printHere }: { runId: string; onError: (msg: string) => void; printHere?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const router = useRouter();

  useEffect(() => {
    const d = ref.current!;
    const outside = (e: MouseEvent) => { if (d.open && !d.contains(e.target as Node)) d.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && d.open) { d.open = false; d.querySelector("summary")!.focus(); } };
    // Opens right-aligned; when the button sits at the left edge (narrow screens) that would overflow, so flip it.
    const toggle = () => {
      if (!d.open) return;
      const menu = d.querySelector<HTMLElement>("[data-menu]")!;
      menu.style.left = ""; menu.style.right = "0";
      if (menu.getBoundingClientRect().left < 8) { menu.style.left = "0"; menu.style.right = "auto"; }
    };
    document.addEventListener("click", outside);
    d.addEventListener("keydown", esc);
    d.addEventListener("toggle", toggle);
    return () => { document.removeEventListener("click", outside); d.removeEventListener("keydown", esc); d.removeEventListener("toggle", toggle); };
  }, []);

  async function pick(kind: DownloadKind) {
    ref.current!.open = false;
    try {
      const r = await downloadRun(runId, kind);
      if (r === "print-page") {
        if (printHere) window.print();
        else router.push(`/saved?id=${runId}&print=1`);
      }
    } catch (err) { onError((err as Error).message); }
  }

  return (
    <details ref={ref} className="relative no-print">
      <summary className="btn btn-sm list-none [&::-webkit-details-marker]:hidden">
        Download <span aria-hidden="true">▾</span>
      </summary>
      <div data-menu className="absolute top-[calc(100%+6px)] right-0 z-15 grid w-[min(300px,calc(100vw-32px))] gap-0.5 rounded-xl border-2 border-edge bg-surface p-1.5 shadow-pop">
        {OPTIONS.map(([kind, label, hint]) => (
          <button key={kind} type="button" onClick={() => pick(kind)}
            className="cursor-pointer rounded-lg px-2.5 py-2 text-left text-[.9rem] font-semibold text-ink hover:bg-yellow hover:text-on-pop [&:hover_small]:text-on-pop">
            {label}<small className="block text-[.78rem] font-normal text-ink-2">{hint}</small>
          </button>
        ))}
      </div>
    </details>
  );
}
