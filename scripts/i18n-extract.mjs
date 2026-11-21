// Collects the English UI text in src/ (JSX text, user-facing string and template literals) for the
// runtime translator. Output: src/lib/i18n/ui/source.json — { exact: string[], patterns: string[] }.
// Patterns are template literals with {0}, {1}… where the ${…} parts were.
import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
// Not shown in the browser, or must stay English: emails and Outlook invites, exported files,
// SharePoint folder names, Xero/CSV columns, spreadsheet/PDF parsers, time zone ids, demo data.
const SKIP_DIRS = ["lib/i18n", "server/services/outlook.ts", "server/services/expense-workbook.ts", "server/services/project-pack.ts", "server/services/qr-doc.ts", "app/q/[code]/file", "server/services/project-report.ts",
  "lib/drawings/stamp.ts", "lib/sharepoint/", "server/services/sharepoint.ts", "lib/bookkeeping/", "lib/import/", "lib/timezones.ts", "lib/demo.ts", "lib/outlook/", "lib/email", "lib/ai/", "proxy.ts", "lib/supabase/", "lib/m365", "lib/xero"];
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (SKIP_DIRS.some((s) => p.includes(s))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(f) && !f.endsWith(".d.ts")) files.push(p);
  }
})(ROOT);

const NON_UI_ATTR = new Set(["className", "href", "name", "id", "type", "key", "src", "method", "action", "accept", "autoComplete", "inputMode", "pattern", "rel", "target", "role", "tone", "variant", "size", "icon", "htmlFor", "form", "value", "defaultValue", "encType", "lang", "dir", "fill", "stroke", "viewBox", "d", "xmlns", "sizes", "media", "as", "prefetch", "scope", "align", "step", "min", "max", "list", "capture", "strategy", "crossOrigin", "charSet", "content", "property", "httpEquiv", "transform", "points", "colSpan", "rowSpan", "tabIndex", "spellCheck", "draggable", "kind", "mode", "status", "category", "slug", "base", "path"]);
const NON_UI_PROP = /^(className|href|path|key|id|slug|select|table|kind|status|icon|tone|variant|column|sql|url|mime|ext|bucket|scope|module|code|type|tz|timeZone|locale|format|role|sort|order|field|prefix)$/;
const TW = /^(flex|grid|block|inline|hidden|contents|truncate|underline|italic|uppercase|lowercase|capitalize|rounded|border|shadow|relative|absolute|fixed|sticky|static|grow|shrink|transition|tabular|sr-only|container|prose|antialiased|ring|outline|resize|select|cursor|pointer|group|peer|isolate|invisible|visible|collapse|table|font|text|bg|p|m|w|h|gap|space)\b/;

const exact = new Map();
const patterns = new Map();
const add = (map, s, file) => { if (!map.has(s)) map.set(s, file.replace(ROOT, "")); };

function looksUi(s) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|\/|\.|#|@|data:|mailto:)/.test(t)) return false;
  if (/^[a-z0-9_.:\/-]+$/.test(t)) return false; // identifiers, keys, paths
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false; // camelCase
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 3 && t.includes("_")) return false; // CONSTANTS
  if (!/^[A-Z0-9"'“(«$£€\[{·•…–—→✓+-]/.test(t)) {
    // lower-case start: keep short connecting words in sentences, drop class lists and selects
    if (TW.test(t) || /\b[a-z]+-[a-z0-9]/.test(t) || /[a-z_]+,\s*[a-z_]+/.test(t) || /\(.*\)/.test(t) && /_/.test(t)) return false;
  }
  if (/\b(select|insert|update|delete|from|where)\b.*\b(from|into|set|where)\b/i.test(t) && /_/.test(t)) return false;
  if (/^[\w-]+(\s[\w-]+:[\w-]+)+/.test(t)) return false;
  if (/(^|\s)(px|py|mx|my|mt|mb|ml|mr|pt|pb|pl|pr|text|bg|border|rounded|gap|w|h|min-w|max-w|grid-cols|col-span|sm|md|lg|xl|dark|hover|focus)[-:]/.test(t)) return false;
  return true;
}

// JSX text keeps HTML entities in the source; the page shows the characters.
const ENT = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: "\u00a0", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", mdash: "—", ndash: "–", middot: "·", rarr: "→", larr: "←", times: "×", copy: "©" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);

function templateToPattern(node) {
  let out = node.head.text; let i = 0;
  for (const span of node.templateSpans) { out += `{${i++}}` + span.literal.text; }
  return out;
}

function inJsx(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}
function attrName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText();
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isFunctionLike(p)) return null;
  }
  return null;
}
function propName(node) {
  const p = node.parent;
  if (p && ts.isPropertyAssignment(p) && p.initializer === node) return p.name.getText().replace(/["']/g, "");
  return null;
}
function callee(node) {
  const p = node.parent;
  if (p && ts.isCallExpression(p)) return p.expression.getText();
  return null;
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isTsx = file.endsWith(".tsx");
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const t = decode(node.text).replace(/\s+/g, " ").trim();
      if (t && /[A-Za-z]/.test(t)) add(exact, t, file);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const s = node.text;
      const a = attrName(node);
      const pn = propName(node);
      const c = callee(node);
      if (a && NON_UI_ATTR.has(a)) return;
      if (pn && NON_UI_PROP.test(pn)) return;
      if (c && /(^|\.)(from|select|eq|neq|in|is|order|rpc|storage|get|getAll|has|startsWith|endsWith|includes|split|join|replace|replaceAll|test|match|cookies|headers|redirect|revalidatePath|set|delete|append|setItem|getItem|querySelector|querySelectorAll|addEventListener|removeEventListener|toggle|contains|createElement|setAttribute|getAttribute|Intl|DateTimeFormat|NumberFormat|log|error|warn|logServerError|env|require|import|fetch|upload|download|createSignedUrl|createSignedUploadUrl|list|remove|channel|on|ilike|like|or|filter|contains|textSearch|upsert|insert|update|match|not|gte|lte|gt|lt|range|limit|single|maybeSingle|header|digest|createHash|createHmac|randomUUID|parse|stringify|Number|String|Date|RegExp|z\.enum|enum|literal)$/.test(c)) return;
      if (ts.isCaseClause(node.parent) || (ts.isBinaryExpression(node.parent) && /===|!==|==|!=/.test(node.parent.operatorToken.getText()))) return;
      if (ts.isElementAccessExpression(node.parent) || ts.isLiteralTypeNode(node.parent) || ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      if (ts.isPropertyAccessExpression(node.parent)) return;
      const uiContext = (isTsx && inJsx(node)) || a || (pn && /^(label|title|description|message|error|hint|placeholder|text|heading|subtitle|caption|help|empty|confirm|pendingLabel|summary|body|intro|tip|note|link|button|cta|name|short|long|tooltip|aria|legend|question|answer|action|reason|detail|details|explain)$/i.test(pn)) || (c && /(^|\.)(t|min|max|length|refine|regex|email|url|uuid|superRefine|nonempty|addIssue|Error|throw)$/.test(c)) || ts.isReturnStatement(node.parent) || ts.isConditionalExpression(node.parent) || ts.isArrayLiteralExpression(node.parent) || ts.isBinaryExpression(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent);
      if (uiContext && looksUi(s)) add(exact, s.replace(/\s+/g, " ").trim(), file);
    } else if (ts.isTemplateExpression(node)) {
      const a = attrName(node);
      if (a && NON_UI_ATTR.has(a)) return ts.forEachChild(node, visit);
      const pn = propName(node);
      if (pn && NON_UI_PROP.test(pn)) return ts.forEachChild(node, visit);
      const pat = templateToPattern(node).replace(/\s+/g, " ").trim();
      const statics = pat.replace(/\{\d+\}/g, " ").trim();
      if (/[A-Za-z]{3}/.test(statics) && looksUi(statics) && !/^\{\d+\}$/.test(pat) && !/[/?=&]\{\d+\}|\{\d+\}[/?=&]/.test(pat)) add(patterns, pat, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Phrases already handled by the message catalogs stay out (they are translated by key).
// The few keyed messages (menu, sign-in) are drawn in English too.
for (const v of Object.values(JSON.parse(readFileSync(new URL("../src/lib/i18n/messages/en.json", import.meta.url), "utf8")))) add(exact, v, "lib/i18n/messages/en.json");
const noise = (t) => /^\(function\(|^[A-Za-z0-9!#%+=?@]{40,}$|^-[A-Z][a-zA-Z]+ /.test(t);
const keep = (t) => !noise(t) && !/<\/?[a-z]+[ >]|\.ilike\.|^\(prefers-|^[A-Z][a-z]+\/[A-Z]/.test(t) && !/^[A-Za-z]+[A-Z][a-z]+\d*$/.test(t);
const out = { exact: [...exact.keys()].filter(keep).sort(), patterns: [...patterns.keys()].filter(keep).sort() };
if (process.env.WHERE) { const by = {}; for (const [, f] of [...exact, ...patterns]) { const d = f.split("/").slice(0, 3).join("/"); by[d] = (by[d] ?? 0) + 1; } console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 45)); }
mkdirSync(new URL("../src/lib/i18n/ui/", import.meta.url), { recursive: true });
writeFileSync(new URL("../src/lib/i18n/ui/source.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`exact ${out.exact.length}, patterns ${out.patterns.length}`);
