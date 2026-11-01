import type { Barrier, Group } from "./api";

export interface MergedBarrier extends Barrier { who: Set<string>; also: string[] }

const RANK: Record<string, number> = { blocker: 0, serious: 1, minor: 2 };
const criterion = (b: Barrier) => (String(b.wcag || "").match(/\d+\.\d+\.\d+/) || [""])[0];
export const shortLabel = (label: string) => label.replace(/ \(.*\)/, "");

// Merge findings across agents, most severe first. Same title = same barrier; an automatic
// finding about the same WCAG criterion as an agent-reported one is folded into it.
export function mergeBarriers(g: Pick<Group, "members">): MergedBarrier[] {
  const map = new Map<string, MergedBarrier>();
  const add = (b: Barrier, who: string) => {
    const k = (b.title || "").toLowerCase().replace(/\d+/g, "#").trim();
    const twin = b.source === "auto" && criterion(b)
      ? [...map.values()].find((x) => x.source === "agent" && criterion(x) === criterion(b)) : undefined;
    const cur = twin || map.get(k) || { ...b, who: new Set<string>(), also: [] };
    cur.who.add(who);
    if (twin) cur.also.push(b.title);
    if (!cur.fix && b.fix) cur.fix = b.fix;
    if (!twin) map.set(k, cur);
  };
  // agent-reported first, so automatic findings can fold into them
  (["agent", "auto"] as const).forEach((src) => g.members.forEach((m) => (m.barrier_list || [])
    .filter((b) => b.source === src).forEach((b) => add(b, shortLabel(m.persona_label)))));
  return [...map.values()].sort((a, b) => (RANK[a.severity ?? ""] ?? 3) - (RANK[b.severity ?? ""] ?? 3) || b.who.size - a.who.size);
}
