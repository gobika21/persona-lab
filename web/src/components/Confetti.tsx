"use client";

import { useMemo } from "react";

const COLORS = ["var(--lime)", "var(--pink)", "var(--yellow)", "var(--sky)", "var(--accent)"];

/** A one-off burst of paper bits. Decorative; hidden from assistive tech and skipped under reduced motion (global CSS). */
export default function Confetti({ pieces = 70 }: { pieces?: number }) {
  // Deterministic pseudo-random spread, so render stays pure.
  const bits = useMemo(() => Array.from({ length: pieces }, (_, i) => {
    const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    return { left: r(1) * 100, dx: (r(2) - 0.5) * 240, rot: r(3) * 900, delay: r(4) * 400, dur: 1600 + r(5) * 1400, w: 6 + r(6) * 8, c: COLORS[i % COLORS.length], round: r(7) > 0.6 };
  }), [pieces]);
  return (
    <div aria-hidden="true" className="no-print pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden">
      {bits.map((b, i) => (
        <i key={i} className="absolute -top-4 block border border-edge"
          style={{
            left: `${b.left}%`, width: b.w, height: b.round ? b.w : b.w * 1.6, background: b.c, borderRadius: b.round ? "50%" : 2,
            "--dx": `${b.dx}px`, "--rot": `${b.rot}deg`,
            animation: `confetti ${b.dur}ms ${b.delay}ms cubic-bezier(.25,.6,.4,1) forwards`,
          } as React.CSSProperties} />
      ))}
    </div>
  );
}
