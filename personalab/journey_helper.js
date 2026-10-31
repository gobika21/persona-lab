// Injected into every page during a Persona Journey (Playwright add_init_script).
// Exposes window.__siyw with functions the Python side calls to "perceive"
// the page the way a given persona would.
(() => {
  if (window.__siyw) return;

  const isHidden = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden";
  };
  const visibleBox = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && !isHidden(el) && +getComputedStyle(el).opacity !== 0;
  };
  const inViewport = (r) => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const clean = (t, n = 160) => { t = (t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

  const labelFor = (el) => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "); if (clean(t)) return { name: clean(t), how: "aria-labelledby" }; }
    const al = el.getAttribute("aria-label"); if (clean(al)) return { name: clean(al), how: "aria-label" };
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && clean(l.textContent)) return { name: clean(l.textContent), how: "label" }; }
    const wrap = el.closest("label"); if (wrap && clean(wrap.textContent)) return { name: clean(wrap.textContent), how: "label" };
    if (clean(el.title)) return { name: clean(el.title), how: "title" };
    if (clean(el.placeholder)) return { name: clean(el.placeholder), how: "placeholder only" };
    return { name: "", how: "none" };
  };

  const roleOf = (el) => {
    const r = el.getAttribute("role"); if (r) return r.split(" ")[0];
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button" || t === "summary") return "button";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img") return "img";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") {
      const ty = (el.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(ty)) return "button";
      if (ty === "checkbox") return "checkbox";
      if (ty === "radio") return "radio";
      if (ty === "hidden") return "hidden";
      return "textbox";
    }
    return { nav: "navigation", main: "main", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", ul: "list", ol: "list", table: "table" }[t] || "";
  };

  const nameOf = (el) => {
    const role = roleOf(el);
    if (["textbox", "combobox", "checkbox", "radio"].includes(role)) return labelFor(el);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "); if (clean(t)) return { name: clean(t), how: "aria-labelledby" }; }
    if (clean(el.getAttribute("aria-label"))) return { name: clean(el.getAttribute("aria-label")), how: "aria-label" };
    if (el.tagName === "IMG") return el.hasAttribute("alt") ? { name: clean(el.alt), how: "alt" } : { name: "", how: "missing alt" };
    if (el.tagName === "INPUT" && clean(el.value)) return { name: clean(el.value), how: "value" };
    const txt = clean(el.innerText || el.textContent); if (txt) return { name: txt, how: "text" };
    const img = el.querySelector("img[alt]"); if (img && clean(img.alt)) return { name: clean(img.alt), how: "img alt" };
    const svgT = el.querySelector("svg title"); if (svgT && clean(svgT.textContent)) return { name: clean(svgT.textContent), how: "svg title" };
    if (clean(el.title)) return { name: clean(el.title), how: "title" };
    return { name: "", how: "none" };
  };

  const focusable = (el) => {
    if (el.disabled) return false;
    if (el.tabIndex >= 0) return true;
    return false;
  };

  const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [onclick], [tabindex]";

  let refCounter = 0;
  const refOf = (el) => {
    if (!el.dataset.siywRef) el.dataset.siywRef = String(++refCounter);
    return +el.dataset.siywRef;
  };

  const looksClickable = (el) => {
    if (el.hasAttribute("onclick")) return true;
    if (getComputedStyle(el).cursor !== "pointer") return false;
    // cursor:pointer is inherited; only count the element that sets it
    const p = el.parentElement;
    return !p || getComputedStyle(p).cursor !== "pointer";
  };

  const describe = (el) => {
    if (!el || el === document.body || el === document.documentElement) return null;
    const n = nameOf(el);
    const r = el.getBoundingClientRect();
    return {
      ref: refOf(el), role: roleOf(el) || el.tagName.toLowerCase(), tag: el.tagName.toLowerCase(),
      name: n.name, name_source: n.how, focusable: focusable(el),
      href: el.getAttribute("href") || undefined,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      in_viewport: inViewport(r),
    };
  };

  window.__siyw = {
    // ---- keyboard ----
    focusInfo() {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { on_body: true, url: location.href };
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.outlineColor);
      const shadow = s.boxShadow && s.boxShadow !== "none";
      let indicator = outline ? "outline" : shadow ? "box-shadow" : "none detected";
      return { on_body: false, element: describe(el), focus_indicator: indicator, url: location.href };
    },

    unreachableClickables() {
      const out = [];
      document.querySelectorAll("body *").forEach((el) => {
        if (out.length >= 15 || !visibleBox(el)) return;
        if (!looksClickable(el) || focusable(el)) return;
        if (el.closest("a[href], button, input, select, textarea, summary, [tabindex]")) return;
        if (el.querySelector("a[href], button, input, select, textarea, [tabindex]")) return;
        const n = nameOf(el);
        out.push({ ref: refOf(el), tag: el.tagName.toLowerCase(), name: n.name || "(no text)" });
      });
      return out;
    },

    // ---- visual personas ----
    interactiveInViewport() {
      const list = [];
      const cands = new Set(document.querySelectorAll(INTERACTIVE));
      document.querySelectorAll("body *").forEach((el) => { if (cands.size < 400 && looksClickable(el)) cands.add(el); });
      cands.forEach((el) => {
        if (list.length >= 60 || !visibleBox(el)) return;
        const r = el.getBoundingClientRect();
        if (!inViewport(r)) return;
        list.push(describe(el));
      });
      return { items: list, scroll_y: Math.round(scrollY), page_height: document.documentElement.scrollHeight, viewport_height: innerHeight, url: location.href, title: document.title };
    },

    // ---- screen reader ----
    srLines() {
      const lines = [];
      const stats = { unnamed_buttons: 0, unnamed_links: 0, unlabeled_fields: 0, images_no_alt: 0, headings: 0, landmarks: 0 };
      let textBuf = "";
      const flush = () => { const t = clean(textBuf, 300); if (t) lines.push({ text: t }); textBuf = ""; };
      const push = (l) => { flush(); lines.push(l); };
      const LANDMARK = { navigation: "navigation", main: "main", banner: "banner", contentinfo: "content info", complementary: "complementary", search: "search", region: "region" };

      const walk = (node) => {
        if (lines.length > 600) return;
        if (node.nodeType === 3) { textBuf += " " + node.textContent; return; }
        if (node.nodeType !== 1) return;
        const el = node;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"].includes(el.tagName.toUpperCase())) return;
        if (isHidden(el)) return;
        const role = roleOf(el);
        if (role === "heading") {
          const lvl = +(el.getAttribute("aria-level") || el.tagName[1] || 2);
          stats.headings++;
          push({ text: `heading level ${lvl}: ${nameOf(el).name || "(empty)"}`, ref: refOf(el), kind: "heading" });
          return;
        }
        if (role === "link" || role === "button") {
          const n = nameOf(el);
          if (!n.name) stats[role === "link" ? "unnamed_links" : "unnamed_buttons"]++;
          let label = n.name || (role === "link" ? `(no name) ${clean(el.getAttribute("href"), 60)}` : "(no name)");
          const extra = (el.getAttribute("role") === "button" && !focusable(el)) ? " — not keyboard focusable" : "";
          push({ text: `${role}: ${label}${extra}`, ref: refOf(el), kind: role });
          return;
        }
        if (["textbox", "combobox", "checkbox", "radio"].includes(role)) {
          const l = labelFor(el);
          if (!l.name || l.how === "placeholder only") stats.unlabeled_fields++;
          const word = { textbox: "edit text", combobox: "combo box", checkbox: "checkbox", radio: "radio button" }[role];
          let state = "";
          if (role === "checkbox" || role === "radio") state = el.checked ? ", checked" : ", not checked";
          if (role === "textbox" && el.value) state = `, contains "${clean(el.value, 40)}"`;
          push({ text: `${word}: ${l.name ? l.name + (l.how === "placeholder only" ? " (placeholder only — no real label)" : "") : "(no label)"}${state}`, ref: refOf(el), kind: "field" });
          return;
        }
        if (role === "img") {
          if (!el.hasAttribute("alt") && !el.getAttribute("aria-label")) {
            stats.images_no_alt++;
            const src = (el.currentSrc || el.src || "").split("/").pop().split("?")[0];
            push({ text: `image: ${clean(src, 60) || "(unlabeled image)"}  [no alt text, so the file name is read]`, kind: "img" });
          } else if (clean(el.alt || el.getAttribute("aria-label"))) {
            push({ text: `image: ${clean(el.alt || el.getAttribute("aria-label"))}`, kind: "img" });
          }
          return;
        }
        if (!role && looksClickable(el) && !el.querySelector(INTERACTIVE)) {
          push({ text: `clickable: ${clean(el.innerText || el.textContent) || "(no text)"}`, ref: refOf(el), kind: "clickable" });
          return;
        }
        const isLm = LANDMARK[role] || (el.tagName === "SECTION" && el.getAttribute("aria-label") && "region");
        if (isLm) { stats.landmarks++; push({ text: `${LANDMARK[role] || "region"} landmark${el.getAttribute("aria-label") ? ": " + clean(el.getAttribute("aria-label")) : ""}`, kind: "landmark" }); }
        if (role === "list") push({ text: `list, ${el.children.length} items`, kind: "list" });
        const block = /^(P|DIV|LI|TD|TH|SECTION|ARTICLE|DD|DT|BLOCKQUOTE|FIGCAPTION|LABEL)$/.test(el.tagName);
        if (block) flush();
        for (const c of el.childNodes) walk(c);
        if (block) flush();
      };
      walk(document.body);
      flush();
      return { title: document.title, url: location.href, lang: document.documentElement.lang || "", lines, stats };
    },

    lastTabbableRef() {
      const all = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]")]
        .filter((el) => el.tabIndex >= 0 && !el.disabled && visibleBox(el));
      return all.length ? refOf(all[all.length - 1]) : null;
    },

        byRef(ref) { return document.querySelector(`[data-siyw-ref="${ref}"]`); },
    focusRef(ref) { const el = this.byRef(ref); if (!el) return false; el.scrollIntoView({ block: "center" }); el.focus(); return document.activeElement === el; },
  };
})();
