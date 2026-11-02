"use client";

import { useEffect, useState } from "react";
import { reducedMotion, useInView } from "@/hooks/motion";

/** Counts a plain number ("50", "100%") up from 0 when it scrolls into view. Anything else renders as is.
 *  Screen readers only ever get the final value. */
export default function CountUp({ value }: { value: string }) {
  const m = value.match(/^(\d+)(%?)$/);
  const target = m ? Number(m[1]) : -1; // -1: not a plain number, render as is
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (target < 0 || !seen) return;
    if (reducedMotion()) { setN(target); return; } // eslint-disable-line react-hooks/set-state-in-effect -- jump straight to the value
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, target]); // only primitives here: a fresh match array each render would restart the count every frame

  if (!m) return <>{value}</>;
  return (
    <span ref={ref}>
      <span aria-hidden="true">{n}{m[2]}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
