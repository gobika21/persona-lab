export default function Stat({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="card p-[18px]">
      <div className="text-[.8rem] font-semibold text-ink-2">{k}</div>
      <div className="mt-1.5 mb-0.5 text-[2.2rem] font-[750] tracking-[-0.03em] tabular-nums">{v}</div>
      <div className="text-[.82rem] text-ink-3">{d}</div>
    </div>
  );
}
