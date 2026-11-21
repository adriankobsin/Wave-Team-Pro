// Folder and file naming for SharePoint filing. Pure functions (unit-tested).

export const SHAREPOINT_KINDS = [
  "receipt",
  "expense_month",
  "xero_bills",
  "xero_card",
  "weekly_timesheets",
  "employee_timesheet",
  "weekly_report",
  "monthly_report",
  "leave_register",
] as const;
export type SharePointKind = (typeof SHAREPOINT_KINDS)[number];

export const KIND_LABEL: Record<SharePointKind, string> = {
  receipt: "Receipts (each approved expense)",
  expense_month: "Monthly expense workbook (when a month is closed)",
  xero_bills: "Xero bills export",
  xero_card: "Xero card statement export",
  weekly_timesheets: "Weekly timesheet — all staff (every Monday)",
  employee_timesheet: "Employee timesheet (when approved)",
  weekly_report: "Weekly report (every Monday)",
  monthly_report: "Monthly report (1st of the month)",
  leave_register: "Leave register (1st of the month)",
};

/** Paths are relative to the company's root folder. */
export const DEFAULT_TEMPLATES: Record<SharePointKind, string> = {
  receipt: "{year}/Expenses/{month_num} {month_name}/Receipts/{expense_date} {merchant} {total} {currency} - {employee}.{ext}",
  expense_month: "{year}/Expenses/{month_num} {month_name}/Expenses {month_name} {year}.xlsx",
  xero_bills: "{year}/Expenses/{month_num} {month_name}/Xero bills {export_date}.csv",
  xero_card: "{year}/Expenses/{month_num} {month_name}/Xero card {card} {export_date}.csv",
  weekly_timesheets: "{year}/Timesheets/Weekly - all staff/{week} ({week_range}) All staff.xlsx",
  employee_timesheet: "{year}/Timesheets/By employee/{employee}/{week} ({week_range}) {employee}.xlsx",
  weekly_report: "{year}/Reports/Weekly/{week} ({week_range}) Weekly report.xlsx",
  monthly_report: "{year}/Reports/Monthly/{month_num} {month_name} {year} Monthly report.xlsx",
  leave_register: "{year}/Leave/Leave register {year} (to {date}).xlsx",
};

export const PLACEHOLDERS: Record<string, string> = {
  company: "Company name",
  year: "Year (for weeks: the ISO week's year)",
  month_num: "Month number, 01–12",
  month_name: "Month name, e.g. October",
  date: "Date the file is made, YYYY-MM-DD",
  week: "ISO week, e.g. 2026-W43",
  week_range: "Week dates, e.g. 19-25 Oct",
  employee: "Employee name",
  merchant: "Merchant on the receipt",
  expense_date: "Receipt date, YYYY-MM-DD",
  total: "Receipt total, e.g. 74.50",
  currency: "Currency code, e.g. GBP",
  ext: "File extension of the receipt",
  export_date: "Date of the Xero export",
  card: "Last 4 digits of the company card",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

/** ISO-8601 week of a YYYY-MM-DD date. */
export function isoWeek(date: string): { year: number; week: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

function addDaysIso(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "19-25 Oct", "29 Sep-5 Oct", "29 Dec 2025-4 Jan 2026". */
export function weekRangeLabel(weekStart: string) {
  const end = addDaysIso(weekStart, 6);
  const [y1, m1, d1] = weekStart.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y1 !== y2) return `${d1} ${SHORT[m1 - 1]} ${y1}-${d2} ${SHORT[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${SHORT[m1 - 1]}-${d2} ${SHORT[m2 - 1]}`;
  return `${d1}-${d2} ${SHORT[m1 - 1]}`;
}

/** Placeholder values for a date-based file. `kind` decides whether the date is a month, a week or a day. */
export function dateVars(opts: { month?: string; weekStart?: string; date?: string; today: string }): Record<string, string> {
  const v: Record<string, string> = { date: opts.today };
  if (opts.weekStart) {
    const { year, week } = isoWeek(opts.weekStart);
    v.year = String(year);
    v.week = `${year}-W${String(week).padStart(2, "0")}`;
    v.week_range = weekRangeLabel(opts.weekStart);
    v.month_num = opts.weekStart.slice(5, 7);
    v.month_name = MONTHS[Number(opts.weekStart.slice(5, 7)) - 1];
    return v;
  }
  const ref = opts.month ? `${opts.month}-01` : (opts.date ?? opts.today);
  v.year = ref.slice(0, 4);
  v.month_num = ref.slice(5, 7);
  v.month_name = MONTHS[Number(ref.slice(5, 7)) - 1];
  return v;
}

/** Makes one folder or file name acceptable to SharePoint. */
export function cleanSegment(s: string): string {
  let out = s
    .replace(/[\u0000-\u001f"*:<>?/\\|#%]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[~.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (out.length > 120) {
    const dot = out.lastIndexOf(".");
    const ext = dot > 0 && out.length - dot <= 8 ? out.slice(dot) : "";
    out = out.slice(0, 120 - ext.length).trim() + ext;
  }
  if (!out || out === "." || out === "..") out = "-";
  if (/^(con|prn|aux|nul|com\d|lpt\d|_vti_|desktop\.ini)$/i.test(out)) out = `${out}-`;
  return out;
}

/**
 * Fills a template like "{year}/Receipts/{merchant}.{ext}" and returns a clean relative path.
 * Unknown placeholders become "-"; a value can't add folders (slashes inside values are replaced).
 */
export function renderPath(root: string, template: string, vars: Record<string, string | number | null | undefined>): string {
  const fill = (t: string) =>
    t.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === null || v === undefined || v === "" ? "-" : String(v).replace(/[/\\]/g, "-");
    });
  const segments = [...fill(root).split("/"), ...fill(template).split("/")]
    .map((s) => s.trim())
    .filter(Boolean)
    .map(cleanSegment);
  const path = segments.join("/");
  return path.length > 380 ? path.slice(0, 380) : path;
}

/** "a/b/name.xlsx" → "a/b/name (v2).xlsx". */
export function versioned(path: string, n: number) {
  if (n <= 1) return path;
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? `${dir}${file.slice(0, dot)} (v${n})${file.slice(dot)}` : `${dir}${file} (v${n})`;
}

/** Template validation for the settings form. */
export function templateProblems(t: string): string[] {
  const problems: string[] = [];
  if (!t.trim()) problems.push("Empty");
  if (t.length > 300) problems.push("Longer than 300 characters");
  for (const m of t.matchAll(/\{([^}]*)\}/g)) if (!(m[1] in PLACEHOLDERS)) problems.push(`Unknown placeholder {${m[1]}}`);
  if (/(^|\/)\.\.(\/|$)/.test(t)) problems.push("“..” isn't allowed");
  return problems;
}

/** The Graph path for a SharePoint site URL: https://x.sharepoint.com/sites/Finance → "x.sharepoint.com:/sites/Finance". */
export function siteLookupPath(siteUrl: string): string | null {
  const m = /^https:\/\/([a-z0-9-]+\.sharepoint\.com)(\/[^?#]*)?/i.exec(siteUrl.trim());
  if (!m) return null;
  const path = (m[2] ?? "").replace(/\/+$/, "").replace(/\/(Shared%20Documents|Shared Documents|Forms)\/?.*$/i, "");
  return path ? `${m[1].toLowerCase()}:${decodeURI(path)}` : m[1].toLowerCase();
}
