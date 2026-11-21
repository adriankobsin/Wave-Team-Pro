import "server-only";
import ExcelJS from "exceljs";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { GraphError, graphConfigured, resolveDrive, uploadNew } from "@/lib/sharepoint/graph";
import { DEFAULT_TEMPLATES, SHAREPOINT_KINDS, dateVars, renderPath, versioned, type SharePointKind } from "@/lib/sharepoint/paths";
import { addDays, addMonths, todayIn, weekStart } from "@/lib/time";
import { listExpenses } from "@/server/services/expenses";
import { listPeople } from "@/server/services/people";
import { buildExpenseWorkbook } from "@/server/services/expense-workbook";
import { prepareXero, xeroCsv } from "@/server/services/xero-export";
import { buildWeekly, weeklyWorkbook } from "@/server/services/weekly";
import { buildReport, monthRange, reportWorkbook } from "@/server/services/reports";
import { safeText } from "@/lib/export/cells";
import { addLogo } from "@/lib/export/excel-logo";
import { getLogo, type Logo } from "@/server/services/branding";
import { BRAND } from "@/lib/brand";

export type SharePointSettings = {
  organization_id: string;
  enabled: boolean;
  site_url: string | null;
  library: string;
  root_folder: string;
  templates: Partial<Record<SharePointKind, string>>;
  disabled_kinds: string[];
  site_id: string | null;
  drive_id: string | null;
  verified_at: string | null;
};

type Org = { id: string; name: string; slug: string; timezone: string; country: string; base_currency: string; legal_entity_code: string | null };
type Upload = { id: string; organization_id: string; kind: SharePointKind; ref_key: string; ref: Record<string, unknown>; attempts: number };
type Built = { content: Buffer; vars: Record<string, string | number | null> } | { skip: string };

const MAX_ATTEMPTS = 6;

export function templateFor(s: Pick<SharePointSettings, "templates">, kind: SharePointKind) {
  const t = s.templates?.[kind];
  return typeof t === "string" && t.trim() ? t : DEFAULT_TEMPLATES[kind];
}

const XLSX = (wb: ExcelJS.Workbook) => wb.xlsx.writeBuffer().then((b) => Buffer.from(b));

// ---------------------------------------------------------------------------------------------
// File builders
// ---------------------------------------------------------------------------------------------

async function buildFile(admin: SupabaseClient, org: Org, u: Upload): Promise<Built> {
  const today = todayIn(org.timezone);
  const logo = u.kind === "receipt" || u.kind === "xero_bills" || u.kind === "xero_card" ? null : await getLogo(org.id, admin);
  const common = { company: org.name };
  switch (u.kind) {
    case "receipt": {
      const expenseId = String(u.ref.expense_id ?? "");
      const fileId = String(u.ref.file_id ?? "");
      const [rows, { data: file }] = await Promise.all([
        listExpenses(org.id, { ids: [expenseId], status: "any" }, admin),
        admin.from("files").select("storage_path, file_name, mime_type").eq("id", fileId).maybeSingle(),
      ]);
      const e = rows[0];
      if (!e || !file) return { skip: "The expense or its receipt no longer exists." };
      const { data: m } = await admin.from("organization_memberships").select("user_id").eq("id", e.membership_id).maybeSingle();
      const { data: p } = m ? await admin.from("profiles").select("display_name").eq("id", m.user_id).maybeSingle() : { data: null };
      const { data: blob, error } = await admin.storage.from("files").download(file.storage_path);
      if (error || !blob) throw new Error("Couldn't read the receipt from storage.");
      const dot = file.file_name.lastIndexOf(".");
      const ext = dot > 0 ? file.file_name.slice(dot + 1).toLowerCase() : file.mime_type === "application/pdf" ? "pdf" : (file.mime_type.split("/")[1] ?? "bin");
      return {
        content: Buffer.from(await blob.arrayBuffer()),
        vars: {
          ...common,
          ...dateVars({ date: e.expense_date ?? undefined, today }),
          employee: p?.display_name ?? "Colleague",
          merchant: e.merchant ?? "Receipt",
          expense_date: e.expense_date ?? today,
          total: e.total !== null ? e.total.toFixed(2) : "",
          currency: e.currency ?? "",
          ext,
        },
      };
    }
    case "expense_month": {
      const month = String(u.ref.month ?? "");
      if (!/^\d{4}-\d{2}$/.test(month)) return { skip: "Unknown month." };
      const [rows, people, { data: projects }, { data: categories }] = await Promise.all([
        listExpenses(org.id, { month, status: "approved" }, admin),
        listPeople(org.id, { includeInactive: true }, admin),
        admin.from("projects").select("id, name, code, cost_center").eq("organization_id", org.id),
        admin.from("expense_categories").select("id, name, accounting_code").eq("organization_id", org.id),
      ]);
      const { xlsx } = await buildExpenseWorkbook({
        supabase: admin, org, rows, people,
        projects: (projects ?? []) as { id: string; name: string; code: string | null; cost_center: string | null }[],
        categories: (categories ?? []) as { id: string; name: string; accounting_code: string | null }[],
        filters: { month, status: "approved" }, generatedBy: `${BRAND.product} (month close)`, appBaseUrl: publicEnv().APP_BASE_URL, format: "xlsx", logo,
      });
      return { content: xlsx, vars: { ...common, ...dateVars({ month, today }) } };
    }
    case "xero_bills":
    case "xero_card": {
      const exportId = String(u.ref.export_id ?? "");
      const { data: x } = await admin.from("accounting_exports").select("id, kind, filters, created_at, undone_at").eq("id", exportId).maybeSingle();
      if (!x) return { skip: "The export no longer exists." };
      if (x.undone_at) return { skip: "The export was undone." };
      const { data: ids } = await admin.from("expenses").select("id").eq("accounting_export_id", exportId);
      const rows = await listExpenses(org.id, { ids: (ids ?? []).map((r) => r.id), status: "any" }, admin);
      const exportDate = todayIn(org.timezone, new Date(x.created_at));
      const { lines, opts } = await prepareXero(admin, org, rows, exportDate, admin);
      if (!lines.length) return { skip: "No claims in this export." };
      const filters = (x.filters ?? {}) as { to?: string | null; card?: string | null };
      let card = "";
      if (filters.card) {
        const { data: c } = await admin.from("company_cards").select("last4").eq("id", filters.card).maybeSingle();
        card = c?.last4 ?? "";
      }
      const ref = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : exportDate;
      return {
        content: Buffer.from(xeroCsv(u.kind === "xero_card" ? "card" : "bills", lines, opts), "utf8"),
        vars: { ...common, ...dateVars({ date: ref, today }), export_date: exportDate, card },
      };
    }
    case "weekly_timesheets": {
      const wk = String(u.ref.week_start ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) return { skip: "Unknown week." };
      const data = await buildWeekly(admin, org.id, wk, org.timezone);
      return { content: await weeklyWorkbook(org.name, wk, data, logo), vars: { ...common, ...dateVars({ weekStart: wk, today }) } };
    }
    case "weekly_report": {
      const wk = String(u.ref.week_start ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) return { skip: "Unknown week." };
      const r = await buildReport(org.id, { from: wk, to: addDays(wk, 6) }, admin);
      return { content: await reportWorkbook(org.name, r, "Weekly report", logo), vars: { ...common, ...dateVars({ weekStart: wk, today }) } };
    }
    case "monthly_report": {
      const month = String(u.ref.month ?? "");
      if (!/^\d{4}-\d{2}$/.test(month)) return { skip: "Unknown month." };
      const r = await buildReport(org.id, monthRange(month, month), admin);
      return { content: await reportWorkbook(org.name, r, "Monthly report", logo), vars: { ...common, ...dateVars({ month, today }) } };
    }
    case "employee_timesheet": {
      const id = String(u.ref.timesheet_id ?? "");
      const built = await employeeTimesheetWorkbook(admin, org, id, logo);
      if (!built) return { skip: "The timesheet no longer exists." };
      return { content: built.xlsx, vars: { ...common, ...dateVars({ weekStart: built.weekStart, today }), employee: built.employee } };
    }
    case "leave_register": {
      const to = String(u.ref.to ?? today);
      const xlsx = await leaveRegisterWorkbook(admin, org, `${to.slice(0, 4)}-01-01`, to, logo);
      return { content: xlsx, vars: { ...common, ...dateVars({ date: to, today: to }), date: to } };
    }
  }
}

async function employeeTimesheetWorkbook(admin: SupabaseClient, org: Org, timesheetId: string, logo: Logo | null) {
  const { data: ts } = await admin.from("timesheets").select("id, membership_id, week_start, status, submitted_at, reviewed_by, reviewed_at, review_note").eq("id", timesheetId).maybeSingle();
  if (!ts) return null;
  const [{ data: entries }, { data: m }, { data: projects }] = await Promise.all([
    admin.from("timesheet_entries").select("work_date, project_id, category, hours, is_overtime, billable, description").eq("timesheet_id", ts.id).order("work_date"),
    admin.from("organization_memberships").select("user_id, job_title, employee_number").eq("id", ts.membership_id).maybeSingle(),
    admin.from("projects").select("id, name, code").eq("organization_id", org.id),
  ]);
  const ids = [m?.user_id, ts.reviewed_by].filter(Boolean) as string[];
  const { data: profiles } = ids.length ? await admin.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
  const name = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const employee = (m && name.get(m.user_id)) ?? "Colleague";
  const proj = new Map((projects ?? []).map((p) => [p.id, p.code ? `${p.code} ${p.name}` : p.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const ws = wb.addWorksheet("Timesheet", { views: [{ state: "frozen", ySplit: 6 }] });
  ws.addRow([`${safeText(org.name)} — timesheet`]).font = { bold: true, size: 13 };
  ws.addRow(["Employee", safeText(employee), "Job title", safeText(m?.job_title ?? "")]);
  ws.addRow(["Week starting", ts.week_start, "Employee no.", safeText(m?.employee_number ?? "")]);
  ws.addRow(["Status", ts.status === "approved" ? "Approved" : ts.status, "Approved by", safeText(ts.reviewed_by ? name.get(ts.reviewed_by) ?? "" : ""), "Approved at", ts.reviewed_at ? ts.reviewed_at.slice(0, 16).replace("T", " ") + " UTC" : ""]);
  ws.addRow([]);
  ws.addRow(["Date", "Day", "Project", "Type", "Hours", "Overtime", "Billable", "Description"]).font = { bold: true };
  let total = 0;
  let overtime = 0;
  for (const e of entries ?? []) {
    const h = Number(e.hours);
    total += h;
    if (e.is_overtime) overtime += h;
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${e.work_date}T00:00:00Z`));
    ws.addRow([e.work_date, day, safeText(e.project_id ? proj.get(e.project_id) ?? "" : "No project"), e.category, h, e.is_overtime ? "Yes" : "", e.billable ? "Yes" : "", safeText(e.description ?? "")]);
  }
  ws.addRow([]);
  ws.addRow(["Total", "", "", "", Math.round(total * 100) / 100, Math.round(overtime * 100) / 100]).font = { bold: true };
  ws.columns.forEach((c, i) => (c.width = [12, 6, 28, 10, 8, 10, 9, 48][i] ?? 12));
  addLogo(wb, ws, logo, 5);
  return { xlsx: await XLSX(wb), employee, weekStart: ts.week_start as string };
}

async function leaveRegisterWorkbook(admin: SupabaseClient, org: Org, from: string, to: string, logo: Logo | null) {
  const [{ data: leave }, { data: types }, people] = await Promise.all([
    admin.from("leave_requests").select("membership_id, leave_type_id, start_date, end_date, days, reviewed_at").eq("organization_id", org.id).eq("status", "approved")
      .lte("start_date", to).gte("end_date", from).order("start_date"),
    admin.from("leave_types").select("id, name, paid").eq("organization_id", org.id),
    listPeople(org.id, { includeInactive: true }, admin),
  ]);
  const type = new Map((types ?? []).map((t) => [t.id, t]));
  const person = new Map(people.map((p) => [p.membershipId, p.name]));
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const ws = wb.addWorksheet("Leave register", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.addRow([`${safeText(org.name)} — approved leave ${from} to ${to}`]).font = { bold: true, size: 13 };
  ws.addRow(["Employee", "Leave type", "Paid", "From", "To", "Working days", "Approved"]).font = { bold: true };
  const totals = new Map<string, Map<string, number>>();
  for (const l of leave ?? []) {
    const t = type.get(l.leave_type_id);
    const who = person.get(l.membership_id) ?? "Former colleague";
    ws.addRow([safeText(who), safeText(t?.name ?? "Leave"), t?.paid ? "Yes" : "No", l.start_date, l.end_date, Number(l.days), l.reviewed_at ? String(l.reviewed_at).slice(0, 10) : ""]);
    const byType = totals.get(who) ?? new Map<string, number>();
    byType.set(t?.name ?? "Leave", (byType.get(t?.name ?? "Leave") ?? 0) + Number(l.days));
    totals.set(who, byType);
  }
  ws.columns.forEach((c, i) => (c.width = [26, 20, 6, 12, 12, 12, 12][i] ?? 12));
  const sum = wb.addWorksheet("Totals by person");
  sum.addRow(["Employee", "Leave type", "Working days"]).font = { bold: true };
  for (const [who, byType] of [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const [t, d] of byType) sum.addRow([safeText(who), safeText(t), Math.round(d * 10) / 10]);
  }
  sum.columns.forEach((c, i) => (c.width = [26, 20, 12][i] ?? 12));
  addLogo(wb, ws, logo, 5);
  return XLSX(wb);
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

function describe(e: unknown) {
  if (e instanceof GraphError) return e.message;
  return e instanceof Error ? e.message.slice(0, 300) : "Unexpected error";
}

/**
 * Uploads queued files. Safe to call from many places at once: each row is claimed atomically.
 * Stops after `budgetMs`; whatever is left is picked up next time (actions, daily cron).
 */
export async function runSharepointUploads(opts: { orgId?: string; budgetMs?: number; limit?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const admin = createAdminClient();
  const stats = { done: 0, failed: 0, retry: 0, skipped: 0 };

  // Rows left "uploading" by a crashed run go back in the queue.
  await admin.from("sharepoint_uploads").update({ status: "pending", started_at: null })
    .eq("status", "uploading").lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());

  const settingsCache = new Map<string, SharePointSettings | null>();
  const orgCache = new Map<string, Org | null>();
  let processed = 0;

  while (Date.now() - started < budget && processed < (opts.limit ?? 200)) {
    let q = admin.from("sharepoint_uploads").select("id, organization_id, kind, ref_key, ref, attempts")
      .eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(5);
    if (opts.orgId) q = q.eq("organization_id", opts.orgId);
    const { data: batch } = await q;
    if (!batch?.length) break;
    for (const row of batch as Upload[]) {
      if (Date.now() - started >= budget) break;
      const { data: claimed } = await admin.from("sharepoint_uploads")
        .update({ status: "uploading", started_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq("id", row.id).eq("status", "pending").select("id");
      if (!claimed?.length) continue;
      processed++;
      const result = await processOne(admin, row, settingsCache, orgCache);
      stats[result]++;
    }
  }
  if (processed) console.log(JSON.stringify({ level: "info", scope: "sharepoint.run", ...stats, ms: Date.now() - started }));
  return stats;
}

async function processOne(admin: SupabaseClient, row: Upload, settingsCache: Map<string, SharePointSettings | null>, orgCache: Map<string, Org | null>): Promise<"done" | "failed" | "retry" | "skipped"> {
  const finish = (patch: Record<string, unknown>) => admin.from("sharepoint_uploads").update(patch).eq("id", row.id);
  try {
    if (!settingsCache.has(row.organization_id)) {
      const { data } = await admin.from("sharepoint_settings").select("*").eq("organization_id", row.organization_id).maybeSingle();
      settingsCache.set(row.organization_id, (data as SharePointSettings | null) ?? null);
    }
    const s = settingsCache.get(row.organization_id);
    if (!s?.enabled || !s.site_url) {
      await finish({ status: "skipped", last_error: "SharePoint filing is switched off for this company.", completed_at: new Date().toISOString() });
      return "skipped";
    }
    if (!graphConfigured()) {
      await finish({ status: "pending", next_attempt_at: new Date(Date.now() + 60 * 60_000).toISOString(), last_error: "Waiting for the Microsoft 365 connection (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)." });
      return "retry";
    }
    if (!orgCache.has(row.organization_id)) {
      const { data } = await admin.from("organizations").select("id, name, slug, timezone, country, base_currency, legal_entity_code").eq("id", row.organization_id).maybeSingle();
      orgCache.set(row.organization_id, (data as Org | null) ?? null);
    }
    const org = orgCache.get(row.organization_id);
    if (!org) {
      await finish({ status: "skipped", last_error: "Company not found.", completed_at: new Date().toISOString() });
      return "skipped";
    }
    if (!s.drive_id) {
      const d = await resolveDrive(s.site_url, s.library);
      await admin.from("sharepoint_settings").update({ site_id: d.siteId, drive_id: d.driveId, verified_at: new Date().toISOString() }).eq("organization_id", s.organization_id);
      s.site_id = d.siteId;
      s.drive_id = d.driveId;
    }
    const built = await buildFile(admin, org, row);
    if ("skip" in built) {
      await finish({ status: "skipped", last_error: built.skip, completed_at: new Date().toISOString() });
      return "skipped";
    }
    const path = renderPath(s.root_folder, templateFor(s, row.kind), built.vars);
    const up = await uploadNew(s.drive_id, path, built.content, (n) => versioned(path, n));
    await finish({ status: "done", path: up.path, web_url: up.webUrl, size_bytes: up.size, last_error: null, completed_at: new Date().toISOString() });
    return "done";
  } catch (e) {
    const attempts = row.attempts + 1;
    const retryable = !(e instanceof GraphError) || e.retryable;
    // A moved library or revoked access invalidates the cached drive; look it up again next time.
    if (e instanceof GraphError && (e.status === 404 || e.status === 403)) {
      await admin.from("sharepoint_settings").update({ drive_id: null, site_id: null }).eq("organization_id", row.organization_id);
      settingsCache.delete(row.organization_id);
    }
    if (retryable && attempts < MAX_ATTEMPTS) {
      await finish({ status: "pending", next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(), last_error: describe(e) });
      return "retry";
    }
    await finish({ status: "failed", last_error: describe(e), completed_at: new Date().toISOString() });
    console.error(JSON.stringify({ level: "error", scope: "sharepoint.upload", kind: row.kind, message: describe(e) }));
    return "failed";
  }
}

/** Queues one file by hand (Settings → "File now"). A new key each time, so it files a new version. */
export async function enqueueManual(admin: SupabaseClient, orgId: string, kind: SharePointKind, ref: Record<string, unknown>) {
  const { error } = await admin.from("sharepoint_uploads").insert({ organization_id: orgId, kind, ref_key: `manual-${Date.now()}`, ref });
  if (error) throw error;
}

/**
 * Daily: for every company with filing on, queue last complete week's timesheets and report,
 * and last complete month's report and leave register. Keys make this idempotent, so a missed
 * day just catches up the next day.
 */
export async function scheduleSharepointPeriodics() {
  const admin = createAdminClient();
  const { data: list } = await admin.from("sharepoint_settings").select("organization_id, disabled_kinds").eq("enabled", true);
  for (const s of list ?? []) {
    const { data: org } = await admin.from("organizations").select("id, timezone, status").eq("id", s.organization_id).maybeSingle();
    if (!org || org.status !== "active") continue;
    const today = todayIn(org.timezone);
    const lastWeek = weekStart(addDays(today, -7));
    const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
    const jobs: [SharePointKind, string, Record<string, unknown>][] = [
      ["weekly_timesheets", lastWeek, { week_start: lastWeek }],
      ["weekly_report", lastWeek, { week_start: lastWeek }],
      ["monthly_report", lastMonth, { month: lastMonth }],
      ["leave_register", lastMonth, { to: lastMonthEnd }],
    ];
    for (const [kind, key, ref] of jobs) {
      await admin.rpc("sharepoint_enqueue", { p_org: org.id, p_kind: kind, p_ref_key: key, p_ref: ref });
    }
  }
}

export const ALL_KINDS = SHAREPOINT_KINDS;

/** After an action that may have queued files, upload them once the response has been sent. */
export function fileInBackground(orgId?: string) {
  if (!graphConfigured()) return;
  after(async () => {
    try {
      await runSharepointUploads({ orgId, budgetMs: 40_000, limit: 50 });
    } catch (e) {
      console.error(JSON.stringify({ level: "error", scope: "sharepoint.background", message: describe(e) }));
    }
  });
}
