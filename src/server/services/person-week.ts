import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dateOf, projectSessionsFrom, timeOf, weekDays, zoneCity, zoneOfProject, type ProjectPunch } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";
import { safeText } from "@/lib/export/cells";
import { PdfReport } from "@/lib/export/pdf";
import { addLogo } from "@/lib/export/excel-logo";
import { BRAND } from "@/lib/brand";

export type CompanyWeek = {
  orgId: string;
  name: string;
  slug: string;
  membershipId: string;
  status: "none" | "draft" | "submitted" | "approved" | "rejected";
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rows: { label: string; perDay: number[]; total: number }[];
  perDay: number[];
  total: number;
  clocked: number; // hours from clock-ins (finished and running sessions)
  sessions: { day: string; start: string; end: string | null; project: string; breakMinutes: number; hours: number; tz: string }[];
};

export type PersonWeek = { name: string; jobTitle: string | null; tz: string; week: string; days: string[]; companies: CompanyWeek[]; clocked: number; logged: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One person's week in every company the viewer may see their time in (row-level security and
 * can_view_time_of decide: a manager in one company never sees another company's rows).
 */
export async function buildPersonWeek(supabase: SupabaseClient, userId: string, week: string, onlyOrg?: string): Promise<PersonWeek | null> {
  const days = weekDays(week);
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone").eq("id", userId).maybeSingle(),
    supabase.from("organization_memberships").select("id, organization_id, job_title, status, organizations(name, slug, timezone)").eq("user_id", userId).eq("status", "active"),
  ]);
  if (!profile) return null;
  const tz = (profile.timezone as string) || "UTC";
  const list = ((memberships ?? []) as unknown as { id: string; organization_id: string; job_title: string | null; organizations: { name: string; slug: string; timezone: string | null } }[])
    .filter((m) => !onlyOrg || m.organization_id === onlyOrg);
  const allowed = await Promise.all(list.map((m) => supabase.rpc("can_view_time_of", { p_org: m.organization_id, p_membership: m.id })));
  const visible = list.filter((_, i) => allowed[i].data === true);

  const companies: CompanyWeek[] = [];
  for (const m of visible) {
    const [{ data: sheet }, { data: punches }, { data: projects }] = await Promise.all([
      supabase.from("timesheets").select("id, status, submitted_at, reviewed_by, reviewed_at").eq("membership_id", m.id).eq("week_start", week).maybeSingle(),
      supabase.from("attendance_events").select("kind, occurred_at, project_id").eq("membership_id", m.id)
        .gte("occurred_at", new Date(Date.parse(`${addDays(week, -1)}T00:00:00Z`)).toISOString())
        .lt("occurred_at", new Date(Date.parse(`${addDays(week, 8)}T00:00:00Z`)).toISOString()),
      supabase.from("projects").select("id, name, code").eq("organization_id", m.organization_id),
    ]);
    const { data: entries } = sheet
      ? await supabase.from("timesheet_entries").select("work_date, project_id, hours").eq("timesheet_id", sheet.id)
      : { data: [] as { work_date: string; project_id: string | null; hours: number }[] };
    const pName = new Map((projects ?? []).map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]));
    const label = (id: string | null) => (id ? pName.get(id) ?? "Project" : "No project");
    const byProject = new Map<string, number[]>();
    for (const e of entries ?? []) {
      const i = days.indexOf(e.work_date);
      if (i < 0) continue;
      const k = label(e.project_id);
      const arr = byProject.get(k) ?? Array(7).fill(0);
      arr[i] = r2(arr[i] + Number(e.hours));
      byProject.set(k, arr);
    }
    const rows = [...byProject.entries()].map(([k, perDay]) => ({ label: k, perDay, total: r2(perDay.reduce((a, b) => a + b, 0)) })).sort((a, b) => b.total - a.total);
    const perDay = days.map((_, i) => r2(rows.reduce((n, r) => n + r.perDay[i], 0)));
    // Each clock-in is shown in local time where its project is (company time zone without a project).
    const zones = await projectZones(supabase, (punches ?? []).map((p) => p.project_id as string | null));
    const sessions = projectSessionsFrom((punches ?? []) as ProjectPunch[])
      .map((s) => ({ ...s, zone: zoneOfProject(s.projectId, zones, m.organizations.timezone || tz) }))
      .map((s) => ({ day: dateOf(s.start, s.zone), tz: s.zone, start: s.start, end: s.end, project: label(s.projectId), breakMinutes: s.breakMinutes, hours: r2(s.workedMinutes / 60) }))
      .filter((s) => s.day >= week && s.day <= addDays(week, 6));
    const { data: reviewer } = sheet?.reviewed_by ? await supabase.from("profiles").select("display_name").eq("id", sheet.reviewed_by).maybeSingle() : { data: null };
    companies.push({
      orgId: m.organization_id, name: m.organizations.name, slug: m.organizations.slug, membershipId: m.id,
      status: (sheet?.status ?? "none") as CompanyWeek["status"], submittedAt: sheet?.submitted_at ?? null,
      reviewedBy: reviewer?.display_name ?? null, reviewedAt: sheet?.reviewed_at ?? null,
      rows, perDay, total: r2(perDay.reduce((a, b) => a + b, 0)), clocked: r2(sessions.reduce((n, s) => n + s.hours, 0)), sessions,
    });
  }
  companies.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    name: profile.display_name as string, jobTitle: visible[0]?.job_title ?? null, tz, week, days, companies,
    clocked: r2(companies.reduce((n, c) => n + c.clocked, 0)), logged: r2(companies.reduce((n, c) => n + c.total, 0)),
  };
}

export const STATUS_LABEL = { none: "Not started", draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Returned" } as const;
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const stamp = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso)) : "");

export function approvalLine(c: CompanyWeek, tz: string) {
  if (c.status === "approved") return `Approved${c.reviewedBy ? ` by ${c.reviewedBy}` : ""} ${stamp(c.reviewedAt, tz)}`.trim();
  if (c.status === "submitted") return `Submitted ${stamp(c.submittedAt, tz)}`;
  return STATUS_LABEL[c.status];
}

export async function personWeekWorkbook(w: PersonWeek, logo?: { png: Buffer; width: number; height: number } | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const head = `${safeText(w.name)} — week of ${dayLabel(w.week)} to ${dayLabel(addDays(w.week, 6))}`;

  const sum = wb.addWorksheet("Summary");
  sum.addRow([head]).font = { bold: true, size: 13 };
  sum.addRow(["Clock times are local time where each project is"]);
  sum.addRow([]);
  sum.addRow(["Company", "Timesheet status", "Hours on timesheet", "Hours clocked", ...w.days.map(dayLabel)]).font = { bold: true };
  for (const c of w.companies) sum.addRow([safeText(c.name), approvalLine(c, w.tz), c.total, c.clocked, ...c.perDay]);
  sum.addRow(["Total", "", w.logged, w.clocked, ...w.days.map((_, i) => r2(w.companies.reduce((n, c) => n + c.perDay[i], 0)))]).font = { bold: true };
  sum.columns.forEach((col, i) => (col.width = i === 0 ? 28 : i === 1 ? 34 : 12));

  for (const c of w.companies) {
    const ws = wb.addWorksheet(c.name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
    ws.addRow([`${safeText(c.name)} — ${head}`]).font = { bold: true };
    ws.addRow([approvalLine(c, w.tz)]);
    ws.addRow([]);
    ws.addRow(["Project", ...w.days.map(dayLabel), "Total"]).font = { bold: true };
    for (const r of c.rows) ws.addRow([safeText(r.label), ...r.perDay, r.total]);
    ws.addRow(["Total", ...c.perDay, c.total]).font = { bold: true };
    ws.columns.forEach((col, i) => (col.width = i === 0 ? 40 : 11));
  }

  for (const ws of wb.worksheets) addLogo(wb, ws, logo, 8);
  const cl = wb.addWorksheet("Clock-ins");
  cl.addRow(["Date", "Company", "Project", "In", "Out", "Time zone", "Break (min)", "Hours"]).font = { bold: true };
  for (const c of w.companies) for (const s of c.sessions) cl.addRow([s.day, safeText(c.name), safeText(s.project), timeOf(s.start, s.tz), s.end ? timeOf(s.end, s.tz) : "still in", zoneCity(s.tz), s.breakMinutes, s.hours]);
  cl.columns.forEach((col, i) => (col.width = [12, 26, 36, 8, 9, 16, 11, 8][i] ?? 12));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function personWeekPdf(w: PersonWeek, logo?: { png: Buffer; width: number; height: number } | null): Promise<Buffer> {
  const pdf = await PdfReport.create(`${BRAND.product} · ${w.name} · week of ${w.week} · clock times in each project's local time`, logo);
  pdf.title(`${w.name} — timesheet`, `Week of ${dayLabel(w.week)} to ${dayLabel(addDays(w.week, 6))}${w.jobTitle ? ` · ${w.jobTitle}` : ""} · ${w.logged.toFixed(2)} h on timesheets · ${w.clocked.toFixed(2)} h clocked`);
  const dayCols = w.days.map((d) => ({ label: dayLabel(d).split(" ")[0], width: 9, align: "right" as const }));
  if (w.companies.length > 1) {
    pdf.heading("All companies");
    pdf.table(
      [{ label: "Company", width: 40 }, ...dayCols, { label: "Total", width: 11, align: "right" }, { label: "Status", width: 34 }],
      [...w.companies.map((c) => [c.name, ...c.perDay, c.total, approvalLine(c, w.tz)]), ["Total", ...w.days.map((_, i) => r2(w.companies.reduce((n, c) => n + c.perDay[i], 0))), w.logged, ""]],
      { totalRow: true },
    );
  }
  for (const c of w.companies) {
    pdf.heading(c.name, approvalLine(c, w.tz));
    if (!c.rows.length) pdf.text("No time on this timesheet.");
    else pdf.table([{ label: "Project", width: 64 }, ...dayCols, { label: "Total", width: 11, align: "right" }], [...c.rows.map((r) => [r.label, ...r.perDay, r.total]), ["Total", ...c.perDay, c.total]], { totalRow: true });
  }
  const sessions = w.companies.flatMap((c) => c.sessions.map((s) => ({ ...s, company: c.name }))).sort((a, b) => a.start.localeCompare(b.start));
  if (sessions.length) {
    pdf.heading("Clock-ins");
    pdf.table(
      [{ label: "Date", width: 17 }, { label: "Company", width: 30 }, { label: "Project", width: 42 }, { label: "In", width: 10, align: "right" }, { label: "Out", width: 12, align: "right" }, { label: "Time zone", width: 18 }, { label: "Break", width: 10, align: "right" }, { label: "Hours", width: 10, align: "right" }],
      sessions.map((s) => [dayLabel(s.day), s.company, s.project, timeOf(s.start, s.tz), s.end ? timeOf(s.end, s.tz) : "still in", zoneCity(s.tz), `${s.breakMinutes} m`, s.hours]),
    );
  }
  return pdf.bytes();
}
