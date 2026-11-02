"use client";

import type { ReactNode } from "react";
import { useInView } from "@/hooks/motion";

/** Fades and lifts its children in when scrolled into view. `delay` staggers siblings. */
export default function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${seen ? "in" : ""} ${className}`} style={{ "--d": `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}
