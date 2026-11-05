"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, keyStore, refreshStatus, REPO_URL, SHOWCASE, type Health } from "@/lib/api";

const LINKS = [
  { href: "/", label: SHOWCASE ? "Home" : "Test a site", match: ["/", "/run"] },
  { href: "/replay", label: "Replays", match: ["/replay", "/compare"] },
  { href: "/history", label: "History", match: ["/history", "/saved"] },
  { href: "/evals", label: "Evals", match: ["/evals"] },
];

const linkCls = "rounded-full border-2 border-transparent px-2 py-1.5 text-[.85rem] font-semibold whitespace-nowrap text-ink-2 no-underline hover:border-edge hover:text-ink max-[379px]:px-1.5 max-[379px]:text-[.8rem] sm:px-3 sm:text-[.9rem]";

export default function Nav() {
  const path = (usePathname() || "/").replace(/\/$/, "") || "/";
  const [status, setStatus] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const h = await api<Health>("/api/health");
      if (keyStore.get()) setStatus("Using your API key");
      else if (h.public_mode && h.ai_ready && h.remaining) setStatus(`${Math.floor(h.remaining.journey / 4)} free runs left today`);
      else if (h.ai_ready) setStatus(`Model: ${h.model}`);
      else setStatus("Add your API key");
    } catch { setStatus("Offline"); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of server status
    loadStatus();
    window.addEventListener("pl:status", loadStatus);
    return () => window.removeEventListener("pl:status", loadStatus);
  }, [loadStatus]);

  return (
    <header className="no-print relative top-0 z-20 border-b-2 sm:sticky border-edge bg-bg/90 backdrop-blur-md">
      <div className="wrap flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        <Link href="/" aria-label="Persona Lab home" className="inline-flex items-center gap-2.5 font-display text-[1.05rem] font-bold tracking-tight whitespace-nowrap no-underline">
          <span aria-hidden="true" className="grid size-[30px] -rotate-6 place-items-center rounded-lg border-2 border-edge bg-lime text-on-pop shadow-[2px_2px_0_var(--edge)]">
            <svg viewBox="0 0 16 16" className="size-4">
              <circle cx="5" cy="6" r="2.2" fill="currentColor" /><circle cx="11" cy="6" r="2.2" fill="currentColor" opacity=".55" />
              <path d="M1.5 13.5c.6-2.2 2-3.3 3.5-3.3s2.9 1.1 3.5 3.3M8 13.5c.6-2.2 1.6-3.3 3-3.3s2.6 1.1 3.3 3.3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          </span>
          <span className="hidden min-[481px]:inline">Persona Lab</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-0.5 max-[379px]:w-full max-[379px]:justify-between sm:gap-1">
          {LINKS.filter((l) => !SHOWCASE || l.href !== "/history").map((l) => {
            const current = l.match.includes(path);
            return (
              <Link key={l.href} href={l.href} aria-current={current ? "page" : undefined}
                className={`${linkCls} ${current ? "!border-edge bg-ink !text-bg" : ""}`}>{l.label}</Link>
            );
          })}
          {SHOWCASE ? (
            <a href={REPO_URL} className="ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-full border-2 border-edge bg-yellow px-3 py-1 text-[.85rem] font-bold whitespace-nowrap text-on-pop no-underline shadow-[2px_2px_0_var(--edge)] hover:-translate-y-px">
              Run it yourself<span className="sr-only"> (GitHub)</span>
            </a>
          ) : <Settings status={status} />}
        </nav>
      </div>
    </header>
  );
}

function Settings({ status }: { status: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the portal target only exists in the browser
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const openDialog = () => {
    const k = keyStore.get();
    setKey(k); setHasKey(!!k); setRemember(keyStore.remembered()); setShow(false); setError("");
    dlg.current?.showModal(); input.current?.focus();
  };
  const close = () => dlg.current?.close();
  const save = (e: FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) { setError("That doesn't look like an Anthropic key. It starts with sk-ant-."); input.current?.focus(); return; }
    keyStore.set(k, remember); refreshStatus();
    close(); setToast("API key saved. Your runs will use it.");
  };
  const remove = () => { keyStore.clear(); refreshStatus(); close(); setToast("API key removed."); };

  return (
    <>
      <button type="button" onClick={openDialog}
        className="ml-1 inline-flex min-h-8 min-w-8 justify-center cursor-pointer items-center gap-1.5 rounded-full border-2 border-edge bg-yellow px-2.5 py-1 text-[.8rem] font-bold whitespace-nowrap text-on-pop shadow-[2px_2px_0_var(--edge)] transition-transform hover:-translate-y-px hover:shadow-[3px_3px_0_var(--edge)] active:translate-y-px active:shadow-none motion-reduce:transition-none sm:text-[.85rem]">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0"><circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 8h6.5M12 8v2.5M14.5 8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="max-[379px]:sr-only sm:hidden">API key</span>
        <span className="hidden sm:inline">{status || "API key"}</span>
        <span className="sr-only"> (API key settings)</span>
      </button>
      <dialog ref={dlg} aria-labelledby="settings-h"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border-2 border-edge bg-surface p-6 text-ink shadow-pop backdrop:bg-black/75 backdrop:backdrop-blur-sm">
        <button type="button" onClick={close}
          className="absolute top-3.5 right-3.5 grid size-10 cursor-pointer place-items-center rounded-full border-2 border-edge bg-surface text-ink transition-transform hover:rotate-90 hover:bg-pink hover:text-on-pop motion-reduce:transition-none">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <span className="sr-only">Close</span>
        </button>
        <h2 id="settings-h" className="mb-2 pr-12 font-display text-xl font-bold">Use your own Claude API key</h2>
        <p className="mb-4 text-[.9rem] text-ink-2">
          Optional. The public demo includes a few free runs per day. With your own key from{" "}
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="underline">
            console.anthropic.com<span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          there&apos;s no limit. It stays in your browser and is only sent with your own runs; the server never stores it.
        </p>
        <form onSubmit={save} noValidate>
          <label htmlFor="api-key" className="mb-1.5 block text-[.8rem] font-bold text-ink">API key</label>
          <div className="relative">
            <input ref={input} id="api-key" className="input w-full pr-[4.5rem]" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="sk-ant-…"
              aria-invalid={!!error || undefined} aria-describedby={error ? "api-key-err" : undefined}
              value={key} onChange={(e) => { setKey(e.target.value); setError(""); }} />
            <button type="button" aria-pressed={show} onClick={() => setShow(!show)}
              className="absolute top-1/2 right-2 min-h-8 -translate-y-1/2 cursor-pointer rounded-full border-2 border-edge px-2.5 text-[.75rem] font-bold hover:bg-yellow hover:text-on-pop">
              {show ? "Hide" : "Show"}<span className="sr-only"> key</span>
            </button>
          </div>
          <p id="api-key-err" role="alert" className="mt-1.5 min-h-[1.4em] text-sm font-semibold text-bad">{error}</p>
          <label className="mt-1 flex min-h-6 items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="size-4 accent-lime" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
          </label>
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {hasKey && <button type="button" className="btn mr-auto" onClick={remove}>Remove key</button>}
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </dialog>
      {/* Portaled: the header's backdrop-filter would otherwise make it the containing block for this fixed toast. */}
      {mounted && createPortal(<p role="status" aria-live="polite"
        className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border-2 border-edge bg-lime px-4 py-2 text-sm font-bold whitespace-nowrap text-on-pop shadow-[3px_3px_0_var(--edge)] ${toast ? "animate-pop" : "sr-only"}`}>
        {toast && <><span aria-hidden="true">✓ </span>{toast}</>}
      </p>, document.body)}
    </>
  );
}
