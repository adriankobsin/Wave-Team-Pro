// Turns a translation work file src/lib/i18n/ui/work/NN.json — rows of [english, thai, romanian, finnish] —
// into th/NN.json, ro/NN.json and fi/NN.json, after checking the English matches en/NN.json row by row.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
const UI = new URL("../src/lib/i18n/ui/", import.meta.url);
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(new URL("work/", UI)).filter((f) => f.endsWith(".json"));
let bad = 0;
for (const f of files) {
  const en = JSON.parse(readFileSync(new URL(`en/${f}`, UI), "utf8"));
  const rows = JSON.parse(readFileSync(new URL(`work/${f}`, UI), "utf8"));
  if (rows.length !== en.length) { console.error(`${f}: ${rows.length} rows for ${en.length} phrases`); bad++; }
  const n = Math.min(rows.length, en.length);
  for (let i = 0; i < n; i++) if (rows[i][0] !== en[i]) { console.error(`${f}#${i}: expected “${en[i]}” got “${rows[i][0]}”`); bad++; if (bad > 5) break; }
  if (bad) continue;
  ["th", "ro", "fi"].forEach((lang, k) => {
    mkdirSync(new URL(`${lang}/`, UI), { recursive: true });
    writeFileSync(new URL(`${lang}/${f}`, UI), JSON.stringify(rows.map((r) => r[k + 1]), null, 1));
  });
  console.log(`${f}: ${rows.length} rows split`);
}
if (bad) process.exit(1);
