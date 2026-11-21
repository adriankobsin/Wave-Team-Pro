import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Server components that import a plain value (a list, a class string) from a "use client" file get a
 * client reference instead of the value: `new Map(LIST)` then crashes at runtime (this broke the
 * Drawings page). Plain values shared by server and client must live in an ordinary module.
 */
const root = join(__dirname, "../../src");
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
walk(root);

const isClient = (src: string) => /^\s*["']use client["']/.test(src);
const alias = (p: string) => "@/" + relative(root, p).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "");

describe("client/server boundary", () => {
  it("server files never import plain values from \"use client\" modules", () => {
    const plain = new Map<string, Set<string>>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!isClient(src)) continue;
      const names = new Set<string>();
      for (const m of src.matchAll(/export const (\w+)(?:\s*:[^=]+)?\s*=\s*(.)/g)) if (m[2] !== "(" && !/^[A-Z][a-z]/.test(m[1])) names.add(m[1]);
      if (names.size) plain.set(alias(f), names);
    }
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](@\/[^"']+)["']/g)) {
        const names = plain.get(m[2]);
        if (!names) continue;
        for (const n of m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])) if (names.has(n)) bad.push(`${relative(root, f)} imports ${n} from ${m[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
