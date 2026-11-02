import CountUp from "./CountUp";

export default function Stat({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="card p-[18px] transition-transform duration-200 hover:-translate-y-1 hover:-rotate-1">
      <div className="text-[.8rem] font-bold tracking-wide text-ink-2 uppercase">{k}</div>
      <div className="mt-1.5 mb-0.5 font-display text-[2.6rem] font-bold tracking-[-0.04em] tabular-nums"><CountUp value={v} /></div>
      <div className="text-[.82rem] text-ink-3">{d}</div>
    </div>
  );
}
