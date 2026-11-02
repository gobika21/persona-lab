"use client";

import { useEffect, useState } from "react";
import type { PersonaId } from "@/lib/api";
import { ICONS, ORDER, POP, SHORT_NAME } from "@/lib/personas";

const CAPTION: Record<PersonaId, string> = {
  keyboard: "Your mouse pointer is hidden on this page. Press Tab to move, Enter to choose: that's all a keyboard-only user has.",
  screen_reader: "A blind user never sees this page. Their screen reader reads it aloud as headings, links and buttons.",
  color_blind: "Red and green now look alike, as they do for about 1 in 12 men.",
  low_vision: "Blurred and low contrast, the way the page can look to someone with low vision.",
};

/** "See it like them": toggles a rough simulation of each persona over the regions marked data-sim-target. */
export default function SimBar() {
  const [sim, setSim] = useState<PersonaId | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (sim) root.dataset.sim = sim; else delete root.dataset.sim;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSim(null); };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); delete root.dataset.sim; };
  }, [sim]);

  return (
    <div className="no-print">
      <svg aria-hidden="true" className="absolute size-0">
        <filter id="pl-deuteranopia">
          <feColorMatrix type="matrix" values="0.367 0.861 -0.228 0 0  0.280 0.673 0.047 0 0  -0.012 0.043 0.969 0 0  0 0 0 1 0" />
        </filter>
      </svg>
      <div role="group" aria-labelledby="sim-h" className="flex flex-wrap items-center gap-2">
        <span id="sim-h" className="mr-1 font-display text-[.95rem] font-bold">See it like them:</span>
        {ORDER.map((id) => {
          const on = sim === id;
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => setSim(on ? null : id)}
              className={`btn btn-sm [&_svg]:size-4 ${on ? `${POP[id]} text-on-pop -rotate-2` : ""}`}>
              {ICONS[id]} {SHORT_NAME[id]}{on && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-2.5 min-h-[1.5em] text-sm text-ink-2">
        {sim && <>{CAPTION[sim]} <span className="text-ink-3">(Esc to stop)</span></>}
      </p>
      {sim && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <button type="button" onClick={() => setSim(null)} className="btn animate-pop bg-yellow text-on-pop shadow-pop">
            <span aria-hidden="true">👀</span> Back to normal view
          </button>
        </div>
      )}
    </div>
  );
}
