// Runs inside the page being checked (injected by Playwright).
// Collects (1) text color samples for personal checks and (2) a set of
// built-in WCAG checks used when axe-core isn't available.
// Returns plain JSON. Must not depend on anything outside this function.
() => {
  const MAX_TEXT = 400;
  const MAX_NODES = 25;

  // ---------- helpers ----------
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const selectorFor = (el) => {
    if (el === document.documentElement) return "html";
    if (el === document.body) return "body";
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll("#" + el.id).length === 1) return "#" + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) { parts.unshift("#" + cur.id); break; }
      const sibs = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : [];
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  const snippet = (el) => {
    const h = el.outerHTML || "";
    const open = h.slice(0, h.indexOf(">") + 1) || h;
    return (open.length > 220 ? open.slice(0, 217) + "..." : open);
  };
  const parseColor = (str) => {
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const effectiveBg = (el) => {
    // Walk up and composite background colors. null if an image/gradient is in the way.
    const layers = [];
    for (let cur = el; cur; cur = cur.parentElement) {
      const s = getComputedStyle(cur);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const accName = (el) => {
    const lab = el.getAttribute("aria-labelledby");
    if (lab) { const t = lab.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim(); if (t) return t; }
    const al = (el.getAttribute("aria-label") || "").trim(); if (al) return al;
    const txt = (el.innerText || el.textContent || "").trim(); if (txt) return txt;
    const img = el.querySelector("img[alt]:not([alt=''])"); if (img) return img.alt.trim();
    const svgTitle = el.querySelector("svg title"); if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    return (el.getAttribute("title") || "").trim();
  };

  // ---------- text samples ----------
  const texts = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode() && texts.length < MAX_TEXT) {
    const node = walker.currentNode;
    const t = node.textContent.trim();
    const el = node.parentElement;
    if (!t || !el || seen.has(el) || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    seen.add(el);
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const fgRaw = parseColor(s.color);
    const bg = effectiveBg(el);
    if (!fgRaw || !bg) continue;
    const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
    const size = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    texts.push({
      selector: selectorFor(el), text: t.slice(0, 80), fg: hex(fg), bg: hex(bg),
      font_size_px: size, bold, large: size >= 24 || (size >= 18.66 && bold),
      ratio: Math.round(ratio(fg, bg) * 100) / 100, rect: rectOf(el), html: snippet(el),
    });
  }

  // ---------- built-in rules ----------
  const violations = [];
  const add = (id, impact, help, description, els, extra = () => ({})) => {
    if (!els.length) return;
    violations.push({
      id, impact, help, description, helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${id}`,
      nodes: els.slice(0, MAX_NODES).map((el) => ({
        target: [selectorFor(el)], html: snippet(el),
        rect: (el === document.documentElement || el === document.body) ? null : rectOf(el), ...extra(el) })),
      total: els.length,
    });
  };

  // contrast
  const lowContrast = texts.filter((t) => t.ratio < (t.large ? 3 : 4.5));
  if (lowContrast.length) {
    violations.push({
      id: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast ratio thresholds",
      description: "Text needs enough contrast with its background to be readable.",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      nodes: lowContrast.slice(0, MAX_NODES).map((t) => ({
        target: [t.selector], html: t.html, rect: t.rect,
        failureSummary: `Contrast ${t.ratio}:1 (needs ${t.large ? 3 : 4.5}:1). Text ${t.fg} on ${t.bg}.`,
        data: { fgColor: t.fg, bgColor: t.bg, contrastRatio: t.ratio, expectedContrastRatio: (t.large ? "3:1" : "4.5:1"), fontSize: t.font_size_px },
      })),
      total: lowContrast.length,
    });
  }

  const imgs = [...document.querySelectorAll("img")].filter((el) => !el.hasAttribute("alt") && !["presentation", "none"].includes(el.getAttribute("role")) && !el.closest("[aria-hidden='true']"));
  add("image-alt", "critical", "Images must have alternative text", "Screen reader users can't know what an image shows without alt text. Use alt=\"\" for decorative images.", imgs);

  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], input[type='reset']")]
    .filter((el) => visible(el) && !(el.tagName === "INPUT" && (el.value || "").trim()) && !accName(el));
  add("button-name", "critical", "Buttons must have discernible text", "Icon-only buttons need an aria-label so people know what they do.", buttons);

  const links = [...document.querySelectorAll("a[href]")].filter((el) => visible(el) && !accName(el));
  add("link-name", "serious", "Links must have discernible text", "Links need text (or an aria-label) that says where they go.", links);

  const fields = [...document.querySelectorAll("input, select, textarea")].filter((el) => {
    if (["hidden", "submit", "button", "reset", "image"].includes((el.type || "").toLowerCase()) || !visible(el)) return false;
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) return false;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
    if (el.closest("label")) return false;
    return true;
  });
  add("label", "critical", "Form elements must have labels", "Each form field needs a visible label linked to it; a placeholder is not a label.", fields);

  if (!(document.documentElement.getAttribute("lang") || "").trim())
    add("html-has-lang", "serious", "<html> element must have a lang attribute", "Screen readers need the page language to pronounce text correctly.", [document.documentElement]);
  if (!document.title.trim())
    add("document-title", "serious", "Documents must have <title> element", "The page title is the first thing screen readers announce and what shows in browser tabs.", [document.documentElement]);

  const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible);
  const skipped = heads.filter((h, i) => i > 0 && +h.tagName[1] - +heads[i - 1].tagName[1] > 1);
  add("heading-order", "moderate", "Heading levels should only increase by one", "Skipping heading levels makes the page structure confusing to navigate.", skipped);
  if (heads.length && !heads.some((h) => h.tagName === "H1"))
    add("page-has-heading-one", "moderate", "Page should contain a level-one heading", "A single <h1> tells people what the page is about.", [document.body]);

  // links distinguished by color alone
  const colorOnly = [...document.querySelectorAll("p a[href], li a[href]")].filter((a) => {
    if (!visible(a)) return false;
    const s = getComputedStyle(a), ps = getComputedStyle(a.parentElement);
    if (s.textDecorationLine.includes("underline") || parseFloat(s.borderBottomWidth) > 0) return false;
    if ((a.parentElement.textContent || "").trim() === (a.textContent || "").trim()) return false; // link is the whole block
    const c1 = parseColor(s.color), c2 = parseColor(ps.color);
    return c1 && c2 && ratio(c1, c2) < 3 && (parseInt(s.fontWeight, 10) === parseInt(ps.fontWeight, 10));
  });
  add("link-in-text-block", "serious", "Links must be distinguishable without relying on color",
    "Links inside text should be underlined (or otherwise marked), not just a different color.", colorOnly);

  const page = document.documentElement;
  return {
    title: document.title,
    lang: page.getAttribute("lang") || "",
    page_width: Math.max(page.scrollWidth, document.body ? document.body.scrollWidth : 0),
    page_height: Math.max(page.scrollHeight, document.body ? document.body.scrollHeight : 0),
    texts,
    builtin_violations: violations,
    counts: { images: document.images.length, links: document.links.length, headings: heads.length, form_fields: document.querySelectorAll("input, select, textarea").length },
  };
}
