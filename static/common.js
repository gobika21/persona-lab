// Shared helpers for every page.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Storage can be unavailable (private mode, blocked cookies): never let it break the page.
const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  set(k, v, remember) { try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};
const ownKey = () => store.get("pl-key") || "";

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (ownKey()) headers["X-Anthropic-Key"] = ownKey();
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const ICONS = {
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/></svg>',
  screen_reader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  color_blind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5" stroke-dasharray="2.5 2"/><circle cx="12" cy="15" r="5"/></svg>',
  low_vision: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5"/></svg>',
};

const PERCEIVES = {
  keyboard: "Tab, Enter and arrow keys only. Sees the screen, but no mouse.",
  screen_reader: "Hears the page as text: headings, links, buttons, labels. Never sees it.",
  color_blind: "Sees the page through a red-green color-blindness simulation.",
  low_vision: "Sees the page at 200% zoom, blurred and lower in contrast.",
};

// ---- status chip + settings (present on every page) ----
async function refreshStatus() {
  const chip = $("#status-chip");
  if (!chip) return;
  try {
    const h = await api("/api/health");
    if (ownKey()) chip.textContent = "Using your API key";
    else if (h.public_mode && h.ai_ready) chip.textContent = `${Math.floor(h.remaining.journey / 4)} free runs left today`;
    else if (h.ai_ready) chip.textContent = `Model: ${h.model}`;
    else chip.textContent = "Add an API key in Settings";
  } catch { chip.textContent = "Offline"; }
}

function initSettings() {
  const dlg = $("#settings");
  if (!dlg) return;
  const msg = $("#settings-msg");
  $("#settings-btn").addEventListener("click", () => { $("#key").value = ownKey(); msg.textContent = ""; dlg.showModal(); });
  $("#key-save").addEventListener("click", () => {
    const k = $("#key").value.trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) { msg.textContent = "That doesn't look like an Anthropic key (it starts with sk-ant-)."; return; }
    store.del("pl-key"); store.set("pl-key", k, $("#key-remember").checked);
    msg.textContent = "Saved. Runs will use your key."; refreshStatus();
  });
  $("#key-clear").addEventListener("click", () => { store.del("pl-key"); $("#key").value = ""; msg.textContent = "Key removed."; refreshStatus(); });
}

document.addEventListener("DOMContentLoaded", () => { initSettings(); refreshStatus(); });
