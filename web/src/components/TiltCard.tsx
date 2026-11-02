"use client";

import { useRef, type ReactNode } from "react";
import { reducedMotion } from "@/hooks/motion";

/** A card that leans toward the pointer. Pure decoration: no effect for keyboard, touch or reduced motion. */
export default function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-4px)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <article ref={ref} onPointerMove={move} onPointerLeave={leave}
      className={`transition-transform duration-200 ease-out will-change-transform ${className}`}>
      {children}
    </article>
  );
}
