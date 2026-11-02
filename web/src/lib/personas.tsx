import type { ReactNode } from "react";
import type { PersonaId } from "./api";

export const ORDER: PersonaId[] = ["keyboard", "screen_reader", "color_blind", "low_vision"];

export const PERCEIVES: Record<PersonaId, string> = {
  keyboard: "Tab, Enter and arrow keys only. Sees the screen, but no mouse.",
  screen_reader: "Hears the page as text: headings, links, buttons, labels. Never sees it.",
  color_blind: "Sees the page through a red-green color-blindness simulation.",
  low_vision: "Sees the page at 200% zoom, blurred and lower in contrast.",
};

export const SHORT_NAME: Record<PersonaId, string> = {
  keyboard: "Keyboard only", screen_reader: "Screen reader", color_blind: "Color-blind", low_vision: "Low vision",
};

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true } as const;

export const ICONS: Record<PersonaId, ReactNode> = {
  keyboard: (
    <svg {...svg} strokeLinecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></svg>
  ),
  screen_reader: (
    <svg {...svg} strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>
  ),
  color_blind: (
    <svg {...svg}><circle cx="9" cy="10" r="5" /><circle cx="15" cy="10" r="5" strokeDasharray="2.5 2" /><circle cx="12" cy="15" r="5" /></svg>
  ),
  low_vision: (
    <svg {...svg} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5" /></svg>
  ),
};

export const POP: Record<PersonaId, string> = { keyboard: "bg-yellow", screen_reader: "bg-pink", color_blind: "bg-lime", low_vision: "bg-sky" };

export function PersonaIcon({ id, size = "md" }: { id: PersonaId; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-7 rounded-lg [&>svg]:size-4" : "size-9 rounded-[10px] [&>svg]:size-5";
  return <span className={`grid flex-none place-items-center border-2 border-edge text-on-pop ${POP[id]} ${box}`}>{ICONS[id]}</span>;
}
