import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, minutesByDayZoned, projectSessionsFrom, weekDays, type ProjectPunch } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";
import { safeText } from "@/lib/export/cells";
import { PdfReport } from "@/lib/export/pdf";
import { addLogo } from "@/lib/export/excel-logo";
import { BRAND } from "@/lib/brand";

export type WeeklyRow = {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  status: "none" | "draft" | "submitted" | "approved" | "rejected";
  logged: number[]; // hours per day Mon..Sun from the timesheet
  clocked: number[]; // hours per day from clock in/out
  leave: (string | null)[]; // leave type name per day
  totalLogged: number;
  totalClocked: number;
  overtime: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * All-staff week: timesheet hours, clocked hours and leave for each active member the
 * client can see (RLS for a signed-in user; everyone for the service role).
 */
export async function buildWeekly(client: SupabaseClient, orgId: string, weekStart: string, tz: string): Promise<{ days: string[]; rows: WeeklyRow[] }> {
  const days = weekDays(weekStart);
  const end = addDays(weekStart, 6);
  const [{ data: members }, { data: sheets }, { data: punches }, { data: leave }, { data: types }] = await Promise.all([
    client.from("organization_memberships").select("id, user_id, job_title").eq("organization_id", orgId).eq("status", "active"),
    client.from("timesheets").select("id, membership_id, status").eq("organization_id", orgId).eq("week_start", weekStart),
    client.from("attendance_events").select("membership_id, kind, occurred_at, project_id").eq("organization_id", orgId)
      .gte("occurred_at", new Date(Date.parse(`${addDays(weekStart, -1)}T00:00:00Z`)).toISOString())
      .lt("occurred_at", new Date(Date.parse(`${addDays(end, 2)}T00:00:00Z`)).toISOString()).order("occurred_at"),
    client.from("leave_requests").select("membership_id, leave_type_id, start_date, end_date").eq("organization_id", orgId).eq("status", "approved")
      .lte("start_date", end).gte("end_date", weekStart),
    client.from("leave_types").select("id, name").eq("organization_id", orgId),
  ]);
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length ? await client.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const sheetIds = (sheets ?? []).map((s) => s.id);
  const { data: entries } = sheetIds.length
    ? await client.from("timesheet_entries").select("timesheet_id, work_date, hours, is_overtime").in("timesheet_id", sheetIds)
    : { data: [] as { timesheet_id: string; work_date: string; hours: number; is_overtime: boolean }[] };
  const typeName = new Map((types ?? []).map((t) => [t.id, t.name as string]));

  // Each clocked day is the day in the zone of the project it was worked on.
  const zones = await projectZones(client, (punches ?? []).map((p) => p.project_id as string | null));
  const rows: WeeklyRow[] = (members ?? []).map((m) => {
    const sheet = (sheets ?? []).find((s) => s.membership_id === m.id);
    const mine = (entries ?? []).filter((e) => sheet && e.timesheet_id === sheet.id);
    const logged = days.map((d) => r2(mine.filter((e) => e.work_date === d).reduce((n, e) => n + Number(e.hours), 0)));
    const mySessions = projectSessionsFrom(((punches ?? []) as (ProjectPunch & { membership_id: string })[]).filter((p) => p.membership_id === m.id));
    const byDay = minutesByDayZoned(mySessions, zones, tz);
    const clocked = days.map((d) => r2((byDay[d] ?? 0) / 60));
    const leaveDays = days.map((d) => {
      const l = (leave ?? []).find((x) => x.membership_id === m.id && x.start_date <= d && x.end_date >= d);
      return l ? typeName.get(l.leave_type_id) ?? "Leave" : null;
    });
    return {
      membershipId: m.id,
      name: nameOf.get(m.user_id) ?? "Colleague",
      jobTitle: m.job_title,
      status: (sheet?.status ?? "none") as WeeklyRow["status"],
      logged,
      clocked,
      leave: leaveDays,
      totalLogged: r2(logged.reduce((a, b) => a + b, 0)),
      totalClocked: r2(clocked.reduce((a, b) => a + b, 0)),
      overtime: r2(mine.filter((e) => e.is_overtime).reduce((n, e) => n + Number(e.hours), 0)),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { days, rows };
}

const STATUS = { none: "Not started", draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Returned" } as const;

export async function weeklyWorkbook(orgName: string, weekStart: string, data: { days: string[]; rows: WeeklyRow[] }, logo?: { png: Buffer; width: number; height: number } | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const ws = wb.addWorksheet("Weekly timesheets", { views: [{ state: "frozen", ySplit: 2, xSplit: 1 }] });
  const label = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  ws.addRow([`${safeText(orgName)} — week of ${label(weekStart)}`]).font = { bold: true, size: 13 };
  ws.addRow(["Employee", "Job title", "Timesheet", ...data.days.map(label), "Timesheet hours", "Clocked hours", "Overtime", "Leave"]).font = { bold: true };
  for (const r of data.rows) {
    ws.addRow([
      safeText(r.name), safeText(r.jobTitle), STATUS[r.status],
      ...r.logged.map((h, i) => (h ? h : r.leave[i] ? safeText(r.leave[i]) : r.clocked[i] ? `(${r.clocked[i]} clocked)` : "")),
      r.totalLogged, r.totalClocked, r.overtime,
      safeText([...new Set(r.leave.filter(Boolean))].join(", ")),
    ]);
  }
  const total = ws.addRow(["Total", "", "", ...data.days.map((_, i) => r2(data.rows.reduce((n, r) => n + r.logged[i], 0))),
    r2(data.rows.reduce((n, r) => n + r.totalLogged, 0)), r2(data.rows.reduce((n, r) => n + r.totalClocked, 0)), r2(data.rows.reduce((n, r) => n + r.overtime, 0)), ""]);
  total.font = { bold: true };
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 26 : i === 1 ? 20 : i === 2 ? 12 : 11));
  addLogo(wb, ws, logo, 10);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function weeklyPdf(orgName: string, weekStartDate: string, data: { days: string[]; rows: WeeklyRow[] }, logo?: { png: Buffer; width: number; height: number } | null): Promise<Buffer> {
  const label = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const pdf = await PdfReport.create(`${BRAND.product} · ${orgName} · weekly timesheets · week of ${weekStartDate}`, logo);
  const logged = r2(data.rows.reduce((n, r) => n + r.totalLogged, 0));
  const clocked = r2(data.rows.reduce((n, r) => n + r.totalClocked, 0));
  pdf.title(`${orgName} — weekly timesheets`, `Week of ${label(weekStartDate)} · ${data.rows.length} people · ${logged.toFixed(2)} h on timesheets · ${clocked.toFixed(2)} h clocked`);
  pdf.table(
    [{ label: "Employee", width: 34 }, { label: "Timesheet", width: 16 }, ...data.days.map((d) => ({ label: label(d).split(" ")[0], width: 9, align: "right" as const })), { label: "Total", width: 10, align: "right" }, { label: "Clocked", width: 11, align: "right" }, { label: "Overtime", width: 11, align: "right" }],
    [
      ...data.rows.map((r) => [r.name, STATUS[r.status], ...r.logged.map((h, i) => (h ? h.toFixed(2) : r.leave[i] ? r.leave[i]! : "-")), r.totalLogged, r.totalClocked, r.overtime]),
      ["Total", "", ...data.days.map((_, i) => r2(data.rows.reduce((n, r) => n + r.logged[i], 0))), logged, clocked, r2(data.rows.reduce((n, r) => n + r.overtime, 0))],
    ],
    { totalRow: true },
  );
  return pdf.bytes();
}
