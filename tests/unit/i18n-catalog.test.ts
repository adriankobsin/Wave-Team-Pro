import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = { exact: Record<string, string>; patterns: [string, string][] };
const load = (lang: string): Catalog => JSON.parse(readFileSync(new URL(`../../public/i18n/${lang}.json`, import.meta.url), "utf8"));
const source = JSON.parse(readFileSync(new URL("../../src/lib/i18n/ui/source.json", import.meta.url), "utf8")) as { exact: string[]; patterns: string[] };

describe.each(["th", "ro", "fi"])("UI catalogue %s", (lang) => {
  const c = load(lang);

  it("translates every extracted phrase", () => {
    for (const s of source.exact) expect(c.exact[s], s).toBeTruthy();
    const pats = new Set(c.patterns.map(([en]) => en));
    for (const s of source.patterns) expect(pats.has(s), s).toBe(true);
  });

  it("never invents placeholders", () => {
    for (const [en, tr] of c.patterns) {
      const have = new Set(en.match(/\{\d+\}/g) ?? []);
      for (const p of tr.match(/\{\d+\}/g) ?? []) expect(have.has(p), `${en} → ${tr}`).toBe(true);
    }
  });

  it("covers the main navigation", () => {
    for (const s of ["Settings", "Projects", "Timesheets", "Staff calendar", "Sign out", "Save"]) {
      expect(c.exact[s]).toBeTruthy();
      expect(c.exact[s]).not.toBe(s);
    }
  });
});
