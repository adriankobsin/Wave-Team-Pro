"use client";

import { useEffect } from "react";

/**
 * Shows the platform in the chosen language. The pages are written in English; this swaps every
 * English phrase on screen (text, placeholders, tooltips, labels, the tab title) for its
 * translation from /i18n/<lang>.json, and keeps doing so as pages change. Names, project names
 * and anything else people typed are not in the catalogue, so they stay as written.
 */
type Catalog = { exact: Record<string, string>; patterns: [string, string][] };
type Pattern = { re: RegExp; to: string; key: string };

const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP"]);

function compile(c: Catalog) {
  const exact = new Map(Object.entries(c.exact));
  const byWord = new Map<string, Pattern[]>();
  const loose: Pattern[] = [];
  for (const [from, to] of c.patterns) {
    const parts = from.split(/\{(\d+)\}/);
    let src = "^";
    const order: number[] = [];
    parts.forEach((p, i) => {
      if (i % 2) { src += "(.+?)"; order.push(Number(p)); } else src += p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    // Captured groups come back in source order; rename them to their {n} numbers.
    const toByOrder = to.replace(/\{(\d+)\}/g, (_, d) => `{@${d}}`);
    const remapped = toByOrder.replace(/\{@(\d+)\}/g, (_, d) => `{${order.indexOf(Number(d))}}`);
    const p: Pattern = { re: new RegExp(`${src}$`, "s"), to: remapped, key: from };
    const word = (from.replace(/\{\d+\}/g, " ").toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).sort((a, b) => b.length - a.length)[0];
    if (word) byWord.set(word, [...(byWord.get(word) ?? []), p]);
    else loose.push(p);
  }
  for (const list of byWord.values()) list.sort((a, b) => b.key.length - a.key.length);
  return { exact, byWord, loose };
}

export function UiTranslator({ lang, version }: { lang: string; version: string }) {
  useEffect(() => {
    const html = document.documentElement;
    if (lang === "en") { html.classList.remove("i18n-wait"); return; }
    let stopped = false;
    let observer: MutationObserver | null = null;
    const done = new WeakMap<Node, string>(); // node → the text we last wrote into it
    const attrDone = new WeakMap<Element, Record<string, string>>();

    fetch(`/i18n/${lang}.json?v=${version}`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((catalog: Catalog | null) => {
        if (stopped || !catalog) { html.classList.remove("i18n-wait"); return; }
        const { exact, byWord, loose } = compile(catalog);
        const memo = new Map<string, string | null>();

        const translateCore = (core: string, depth = 0): string | null => {
          if (memo.has(core)) return memo.get(core)!;
          let out: string | null = exact.get(core) ?? null;
          if (out === null && depth < 2 && /[A-Za-z]{2}/.test(core)) {
            const lower = core.toLowerCase();
            const candidates: Pattern[] = [];
            for (const [w, list] of byWord) if (lower.includes(w)) candidates.push(...list);
            candidates.push(...loose);
            candidates.sort((a, b) => b.key.length - a.key.length);
            for (const p of candidates) {
              const m = p.re.exec(core);
              if (!m) continue;
              out = p.to.replace(/\{(\d+)\}/g, (_, i) => {
                const g = m[Number(i) + 1] ?? "";
                return translateCore(g.trim(), depth + 1) ?? g;
              });
              break;
            }
            // "Title · Group Hub" style joins: translate each piece.
            if (out === null && core.includes(" · ")) {
              const pieces = core.split(" · ");
              const t = pieces.map((x) => translateCore(x, depth + 1));
              if (t.some((x) => x !== null)) out = pieces.map((x, i) => t[i] ?? x).join(" · ");
            }
          }
          if (memo.size > 20000) memo.clear();
          memo.set(core, out);
          return out;
        };
        const translate = (text: string): string | null => {
          const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
          if (!m || !m[2]) return null;
          const core = m[2].replace(/\s+/g, " ");
          const t = translateCore(core);
          return t === null ? null : `${m[1]}${t}${m[3]}`;
        };
        const skipped = (el: Element | null) => {
          for (let e = el; e; e = e.parentElement) {
            if (SKIP.has(e.tagName) || e.hasAttribute("data-no-translate") || e.classList.contains("notranslate") || (e as HTMLElement).isContentEditable) return true;
          }
          return false;
        };
        const doText = (node: Text) => {
          const v = node.nodeValue ?? "";
          if (done.get(node) === v || !/[A-Za-z]/.test(v) || skipped(node.parentElement)) return;
          const t = translate(v);
          if (t !== null && t !== v) { node.nodeValue = t; done.set(node, t); }
        };
        const doAttrs = (el: Element) => {
          if (skipped(el)) return;
          const seen = attrDone.get(el) ?? {};
          for (const a of ATTRS) {
            const v = el.getAttribute(a);
            if (!v || seen[a] === v) continue;
            const t = translate(v);
            if (t !== null && t !== v) { el.setAttribute(a, t); seen[a] = t; }
          }
          if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button") && el.value && seen.value !== el.value) {
            const t = translate(el.value);
            if (t !== null) { el.value = t; seen.value = t; }
          }
          attrDone.set(el, seen);
        };
        const walk = (root: Node) => {
          if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
          if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
          if (root.nodeType === Node.ELEMENT_NODE) {
            if (SKIP.has((root as Element).tagName)) return;
            doAttrs(root as Element);
          }
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
            else doAttrs(n as Element);
          }
        };
        const doTitle = () => {
          const t = translate(document.title);
          if (t !== null && t !== document.title) document.title = t;
        };

        walk(document.body);
        doTitle();
        html.classList.remove("i18n-wait");

        let queued = new Set<Node>();
        let scheduled = false;
        const flush = () => {
          scheduled = false;
          const list = queued;
          queued = new Set();
          for (const n of list) if (n.isConnected) walk(n);
          doTitle();
        };
        observer = new MutationObserver((records) => {
          for (const r of records) {
            if (r.type === "characterData") queued.add(r.target);
            else if (r.type === "attributes") queued.add(r.target);
            else r.addedNodes.forEach((n) => queued.add(n));
          }
          if (!scheduled && queued.size) { scheduled = true; queueMicrotask(flush); }
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, "value"] });
        const titleEl = document.querySelector("title");
        if (titleEl) observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
      })
      .catch(() => html.classList.remove("i18n-wait"));
    return () => { stopped = true; observer?.disconnect(); };
  }, [lang, version]);
  return null;
}
