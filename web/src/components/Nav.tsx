"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, keyStore, refreshStatus, type Health } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Test a site", match: ["/", "/run"] },
  { href: "/history", label: "History", match: ["/history", "/saved"] },
  { href: "/evals", label: "Evals", match: ["/evals"] },
];

const linkCls = "rounded-lg px-2 py-2 text-[.85rem] whitespace-nowrap text-ink-2 no-underline hover:bg-line hover:text-ink sm:px-3 sm:text-[.9rem]";

export default function Nav() {
  const path = (usePathname() || "/").replace(/\/$/, "") || "/";
  const [status, setStatus] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const h = await api<Health>("/api/health");
      if (keyStore.get()) setStatus("Using your API key");
      else if (h.public_mode && h.ai_ready && h.remaining) setStatus(`${Math.floor(h.remaining.journey / 4)} free runs left today`);
      else if (h.ai_ready) setStatus(`Model: ${h.model}`);
      else setStatus("Add an API key in Settings");
    } catch { setStatus("Offline"); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of server status
    loadStatus();
    window.addEventListener("pl:status", loadStatus);
    return () => window.removeEventListener("pl:status", loadStatus);
  }, [loadStatus]);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md backdrop-saturate-150">
      <div className="wrap flex h-[60px] items-center justify-between gap-4">
        <Link href="/" aria-label="Persona Lab home" className="inline-flex items-center gap-2.5 font-bold tracking-tight whitespace-nowrap no-underline">
          <span aria-hidden="true" className="grid size-[26px] place-items-center rounded-lg bg-ink text-bg">
            <svg viewBox="0 0 16 16" className="size-4">
              <circle cx="5" cy="6" r="2.2" fill="currentColor" /><circle cx="11" cy="6" r="2.2" fill="currentColor" opacity=".55" />
              <path d="M1.5 13.5c.6-2.2 2-3.3 3.5-3.3s2.9 1.1 3.5 3.3M8 13.5c.6-2.2 1.6-3.3 3-3.3s2.6 1.1 3.3 3.3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          </span>
          <span className="hidden min-[481px]:inline">Persona Lab</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
          <span role="status" className="mr-1 hidden rounded-full border border-line px-2.5 py-1 text-[.8rem] whitespace-nowrap text-ink-2 sm:inline">{status}</span>
          {LINKS.map((l) => {
            const current = l.match.includes(path);
            return (
              <Link key={l.href} href={l.href} aria-current={current ? "page" : undefined}
                className={`${linkCls} ${current ? "font-semibold text-ink" : ""}`}>{l.label}</Link>
            );
          })}
          <Settings className={linkCls} />
        </nav>
      </div>
    </header>
  );
}

function Settings({ className }: { className: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [msg, setMsg] = useState("");

  const openDialog = () => { setKey(keyStore.get()); setMsg(""); dlg.current?.showModal(); };
  const save = () => {
    const k = key.trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) { setMsg("That doesn't look like an Anthropic key (it starts with sk-ant-)."); return; }
    keyStore.set(k, remember); setMsg("Saved. Runs will use your key."); refreshStatus();
  };
  const remove = () => { keyStore.clear(); setKey(""); setMsg("Key removed."); refreshStatus(); };

  return (
    <>
      <button type="button" className={`${className} cursor-pointer`} onClick={openDialog}>Settings</button>
      <dialog ref={dlg} aria-labelledby="settings-h"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-6 text-ink shadow-pop backdrop:bg-black/40">
        <h2 id="settings-h" className="mb-2 text-xl font-semibold">Use your own Claude API key</h2>
        <p className="mb-3.5 text-[.9rem] text-ink-2">
          Optional. The public demo includes a few free runs per day. With your own key from{" "}
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="underline">
            console.anthropic.com<span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          there&apos;s no limit. It stays in your browser and is only sent with your own runs; the server never stores it.
        </p>
        <label className="grid gap-1.5">
          <span className="text-[.8rem] font-semibold text-ink-2">API key</span>
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…"
            value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="mt-2.5 flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
        </label>
        <p role="status" aria-live="polite" className="mt-2.5 min-h-[1.4em] text-sm">{msg}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={remove}>Remove key</button>
          <form method="dialog"><button className="btn">Close</button></form>
          <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </dialog>
    </>
  );
}
