import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { listPeople, type DirectoryPerson } from "@/server/services/people";
import { countryName } from "@/lib/regions";
import { addDays, todayIn, zoneOfProject } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";

export type HubCompany = {
  id: string;
  name: string;
  slug: string;
  location: string;
  currency: string;
  timezone: string;
  can: { staff: boolean; manageStaff: boolean; time: boolean; expenses: boolean; settings: boolean };
};

const cityOf = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

/**
 * The group view ("Group Hub") for people who run more than one company: platform admins, and anyone
 * who can see the staff of two or more companies. Each company keeps its own permissions; the hub
 * only puts what the person may already see side by side.
 */
export const getHub = cache(async (): Promise<{ companies: HubCompany[]; home: HubCompany | null; isPlatform: boolean } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_companies");
  const rows = (data ?? []) as {
    organization_id: string; name: string; slug: string; timezone: string; country: string; base_currency: string; created_at: string;
    can_staff: boolean; can_manage_staff: boolean; can_time: boolean; can_expenses: boolean; can_settings: boolean; is_platform_admin: boolean;
  }[];
  if (!rows.length) return null;
  const isPlatform = rows[0].is_platform_admin === true;
  const companies: HubCompany[] = rows.map((r) => ({
    id: r.organization_id, name: r.name, slug: r.slug, timezone: r.timezone || "UTC",
    location: `${cityOf(r.timezone || "UTC")}, ${countryName(r.country)}`,
    currency: r.base_currency ?? "",
    can: { staff: r.can_staff, manageStaff: r.can_manage_staff, time: r.can_time, expenses: r.can_expenses, settings: r.can_settings },
  }));
  // Group Hub is for people who run the group: platform admins, and anyone who manages staff
  // (edits people or roles) in two or more companies. Seeing the staff directory isn't enough —
  // every employee can do that.
  const qualifies = isPlatform || companies.filter((c) => c.can.manageStaff).length >= 2;
  if (!qualifies) return null;
  // Home company: where the person's own clock-ins are recorded — the company that was set up first.
  const home = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return { companies, home: companies.find((c) => c.id === home.organization_id) ?? null, isPlatform };
});

type Event = { membership_id: string; kind: string; occurred_at: string; project_id: string | null };

/**
 * Today's attendance in each company: everyone clocked in or on a break now, plus everyone who
 * clocked out today (the company's own date), with when they came in and left.
 */
async function attendanceToday(companies: HubCompany[]) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data } = await supabase.from("attendance_events").select("organization_id, membership_id, kind, occurred_at, project_id")
    .in("organization_id", companies.map((c) => c.id)).gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(5000);
  const tzOf = new Map(companies.map((c) => [c.id, c.timezone]));
  const zones = await projectZones(supabase, ((data ?? []) as Event[]).map((e) => e.project_id));
  const byMember = new Map<string, (Event & { organization_id: string })[]>();
  for (const e of (data ?? []) as (Event & { organization_id: string })[]) byMember.set(e.membership_id, [...(byMember.get(e.membership_id) ?? []), e]);
  const out: { organization_id: string; membership_id: string; state: "in" | "break" | "out"; inAt: string | null; outAt: string | null; project_id: string | null; tz: string }[] = [];
  for (const [membership, events] of byMember) {
    // Local time is where the project is; without a project it is the company's.
    const lastProject = [...events].reverse().find((e) => e.kind === "clock_in" || e.project_id)?.project_id ?? null;
    const tz = zoneOfProject(lastProject, zones, tzOf.get(events[0].organization_id) ?? "UTC");
    const today = todayIn(tz);
    const last = events[events.length - 1];
    const state = last.kind === "clock_out" ? "out" : last.kind === "break_start" ? "break" : "in";
    if (state === "out" && todayIn(tz, new Date(last.occurred_at)) !== today) continue;
    const lastIn = [...events].reverse().find((e) => e.kind === "clock_in");
    const firstInToday = events.find((e) => e.kind === "clock_in" && todayIn(tz, new Date(e.occurred_at)) === today);
    const project = [...events].reverse().find((e) => e.kind === "clock_in" || e.project_id)?.project_id ?? null;
    out.push({
      organization_id: last.organization_id, membership_id: membership, state,
      inAt: (state === "out" ? firstInToday ?? lastIn : lastIn)?.occurred_at ?? null,
      outAt: state === "out" ? last.occurred_at : null,
      project_id: project, tz,
    });
  }
  return out;
}

export type CompanyOverview = HubCompany & {
  active: number; inactive: number; invited: number;
  activeIds: string[]; inactiveIds: string[]; invitedEmails: string[];
  onClock: { name: string; userId: string; since: string; onBreak: boolean; project: string | null }[];
  today: { name: string; userId: string; state: "in" | "break" | "out"; inAt: string | null; outAt: string | null; project: string | null; tz: string }[];
  timesheetsWaiting: number; expensesWaiting: number; expensesWaitingTotal: number;
};

export async function hubOverview(companies: HubCompany[]): Promise<CompanyOverview[]> {
  const supabase = await createClient();
  const ids = companies.map((c) => c.id);
  const [people, live, { data: invites }, { data: sheets }, { data: claims }, { data: projects }] = await Promise.all([
    Promise.all(companies.map((c) => (c.can.staff ? listPeople(c.id, { includeInactive: true }) : Promise.resolve([] as DirectoryPerson[])))),
    attendanceToday(companies),
    supabase.from("invitations").select("organization_id, email").in("organization_id", ids).eq("status", "pending"),
    supabase.from("timesheets").select("organization_id").in("organization_id", ids).eq("status", "submitted"),
    supabase.from("expenses").select("organization_id, reporting_total, total").in("organization_id", ids).eq("status", "submitted"),
    supabase.from("projects").select("id, name, code").in("organization_id", ids),
  ]);
  const pName = new Map((projects ?? []).map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]));
  return companies.map((c, i) => {
    const list = people[i];
    const byMembership = new Map(list.map((p) => [p.membershipId, p]));
    return {
      ...c,
      active: list.filter((p) => p.status === "active").length,
      inactive: list.filter((p) => p.status !== "active").length,
      invited: (invites ?? []).filter((x) => x.organization_id === c.id).length,
      activeIds: list.filter((p) => p.status === "active").map((p) => p.userId),
      inactiveIds: list.filter((p) => p.status !== "active").map((p) => p.userId),
      invitedEmails: (invites ?? []).filter((x) => x.organization_id === c.id).map((x) => String(x.email).toLowerCase()),
      onClock: live.filter((e) => e.organization_id === c.id && e.state !== "out").flatMap((e) => {
        const p = byMembership.get(e.membership_id);
        return p ? [{ name: p.name, userId: p.userId, since: e.inAt ?? "", onBreak: e.state === "break", project: e.project_id ? pName.get(e.project_id) ?? null : null }] : [];
      }),
      today: live.filter((e) => e.organization_id === c.id).flatMap((e) => {
        const p = byMembership.get(e.membership_id);
        return p ? [{ name: p.name, userId: p.userId, state: e.state, inAt: e.inAt, outAt: e.outAt, tz: e.tz, project: e.project_id ? pName.get(e.project_id) ?? null : null }] : [];
      }),
      timesheetsWaiting: (sheets ?? []).filter((x) => x.organization_id === c.id).length,
      expensesWaiting: (claims ?? []).filter((x) => x.organization_id === c.id).length,
      expensesWaitingTotal: Math.round((claims ?? []).filter((x) => x.organization_id === c.id).reduce((n, x) => n + Number(x.reporting_total ?? x.total ?? 0), 0) * 100) / 100,
    };
  });
}

export type HubTimesheetRow = {
  company: HubCompany; userId: string; name: string; avatarUrl: string | null; jobTitle: string | null;
  status: "none" | "draft" | "submitted" | "approved" | "rejected"; hours: number; perDay: number[]; submittedAt: string | null;
};

/** Everyone's timesheet for one week, in every company where the viewer may see time. */
export async function hubTimesheets(companies: HubCompany[], week: string): Promise<HubTimesheetRow[]> {
  const supabase = await createClient();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const out: HubTimesheetRow[] = [];
  await Promise.all(companies.map(async (c) => {
    const [{ data: visible }, people, { data: sheets }] = await Promise.all([
      supabase.rpc("time_people", { p_org: c.id }),
      listPeople(c.id),
      supabase.from("timesheets").select("id, membership_id, status, submitted_at").eq("organization_id", c.id).eq("week_start", week),
    ]);
    const allowed = new Set(((visible ?? []) as { membership_id: string }[]).map((v) => v.membership_id));
    const sheetBy = new Map((sheets ?? []).map((s) => [s.membership_id as string, s]));
    const sheetIds = (sheets ?? []).map((s) => s.id as string);
    const { data: entries } = sheetIds.length
      ? await supabase.from("timesheet_entries").select("timesheet_id, work_date, hours").in("timesheet_id", sheetIds)
      : { data: [] as { timesheet_id: string; work_date: string; hours: number }[] };
    for (const p of people) {
      if (!allowed.has(p.membershipId)) continue;
      const s = sheetBy.get(p.membershipId);
      const perDay = days.map((d) => Math.round((entries ?? []).filter((e) => e.timesheet_id === s?.id && e.work_date === d).reduce((n, e) => n + Number(e.hours), 0) * 100) / 100);
      out.push({
        company: c, userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, jobTitle: p.jobTitle,
        status: (s?.status as HubTimesheetRow["status"]) ?? "none", submittedAt: (s?.submitted_at as string) ?? null,
        perDay, hours: Math.round(perDay.reduce((a, b) => a + b, 0) * 100) / 100,
      });
    }
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.company.name.localeCompare(b.company.name));
}

export type HubExpenseRow = {
  id: string; company: HubCompany; name: string; userId: string | null; date: string | null; merchant: string | null;
  description: string | null; status: string; currency: string | null; total: number | null; reportingTotal: number | null; receipts: number;
};

/** Expense claims across companies (row-level security decides which ones the viewer sees). */
export async function hubExpenses(companies: HubCompany[], f: { month?: string; status?: string }): Promise<HubExpenseRow[]> {
  const supabase = await createClient();
  const ids = companies.map((c) => c.id);
  let q = supabase.from("expenses").select("id, organization_id, membership_id, expense_date, merchant, description, status, currency, total, reporting_total").in("organization_id", ids);
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const [y, m] = f.month.split("-").map(Number);
    q = q.gte("expense_date", `${f.month}-01`).lte("expense_date", new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  }
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  else q = q.neq("status", "cancelled");
  const { data } = await q.order("expense_date", { ascending: false, nullsFirst: true }).limit(1000);
  const rows = data ?? [];
  const memberships = [...new Set(rows.map((r) => r.membership_id as string))];
  const [{ data: ms }, { data: files }] = await Promise.all([
    memberships.length ? supabase.from("organization_memberships").select("id, user_id").in("id", memberships) : Promise.resolve({ data: [] as { id: string; user_id: string }[] }),
    rows.length ? supabase.from("files").select("context_id").eq("context_type", "expense").in("context_id", rows.map((r) => r.id).slice(0, 1000)) : Promise.resolve({ data: [] as { context_id: string }[] }),
  ]);
  const userOf = new Map((ms ?? []).map((m) => [m.id as string, m.user_id as string]));
  const userIds = [...new Set([...userOf.values()])];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  const company = new Map(companies.map((c) => [c.id, c]));
  const receipts = new Map<string, number>();
  for (const f2 of files ?? []) receipts.set(f2.context_id as string, (receipts.get(f2.context_id as string) ?? 0) + 1);
  return rows.map((r) => {
    const uid = userOf.get(r.membership_id as string) ?? null;
    return {
      id: r.id as string, company: company.get(r.organization_id as string)!, userId: uid, name: (uid && nameOf.get(uid)) || "Someone",
      date: (r.expense_date as string) ?? null, merchant: (r.merchant as string) ?? null, description: (r.description as string) ?? null,
      status: r.status as string, currency: (r.currency as string) ?? null,
      total: r.total === null ? null : Number(r.total), reportingTotal: r.reporting_total === null ? null : Number(r.reporting_total),
      receipts: receipts.get(r.id as string) ?? 0,
    };
  });
}

export type HubUpdate = { id: string; at: string; company: HubCompany; kind: "notification" | "announcement"; title: string; body: string | null; link: string | null; unread: boolean };

/** The viewer's notifications from every company, plus the latest announcements everywhere. */
export async function hubUpdates(companies: HubCompany[], opts: { unreadOnly?: boolean; companyId?: string } = {}): Promise<HubUpdate[]> {
  const supabase = await createClient();
  const ids = opts.companyId ? [opts.companyId] : companies.map((c) => c.id);
  let nq = supabase.from("notifications").select("id, organization_id, title, body, link, read_at, created_at").in("organization_id", ids).order("created_at", { ascending: false }).limit(200);
  if (opts.unreadOnly) nq = nq.is("read_at", null);
  const [{ data: notes }, { data: news }] = await Promise.all([
    nq,
    opts.unreadOnly ? Promise.resolve({ data: [] }) : supabase.from("announcements").select("id, organization_id, title, published_at").in("organization_id", ids).is("archived_at", null).order("published_at", { ascending: false }).limit(30),
  ]);
  const company = new Map(companies.map((c) => [c.id, c]));
  const items: HubUpdate[] = [
    ...(notes ?? []).map((n) => ({
      id: n.id as string, at: n.created_at as string, company: company.get(n.organization_id as string)!, kind: "notification" as const,
      title: n.title as string, body: (n.body as string) ?? null, link: (n.link as string) ?? null, unread: !n.read_at,
    })),
    ...((news ?? []) as { id: string; organization_id: string; title: string; published_at: string }[]).filter((a) => a.published_at).map((a) => {
      const c = company.get(a.organization_id)!;
      return { id: a.id, at: a.published_at, company: c, kind: "announcement" as const, title: a.title, body: null, link: `/o/${c.slug}/announcements#a-${a.id}`, unread: false };
    }),
  ];
  return items.filter((i) => i.company).sort((a, b) => b.at.localeCompare(a.at));
}

export type GroupPerson = { userId: string; name: string; jobTitle: string | null; avatarUrl: string | null; companies: { id: string; name: string; membershipId: string }[] };

/** Everyone active in the viewer's companies, once each, with the companies they work in. */
export async function groupPeople(companies: HubCompany[]): Promise<GroupPerson[]> {
  const lists = await Promise.all(companies.filter((c) => c.can.staff).map(async (c) => ({ c, people: await listPeople(c.id) })));
  const byUser = new Map<string, GroupPerson>();
  for (const { c, people } of lists) {
    for (const p of people) {
      if (p.status !== "active") continue;
      const row = byUser.get(p.userId) ?? { userId: p.userId, name: p.name, jobTitle: p.jobTitle, avatarUrl: p.avatarUrl, companies: [] };
      row.companies.push({ id: c.id, name: c.name, membershipId: p.membershipId });
      byUser.set(p.userId, row);
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type PendingTimesheet = {
  id: string; company: HubCompany; userId: string | null; name: string; weekStart: string; submittedAt: string | null; hours: number;
  entries: { workDate: string; project: string | null; category: string | null; description: string | null; hours: number }[];
};

/** Every timesheet waiting for approval, in every company and every week (row-level security decides). */
export async function hubPendingTimesheets(companies: HubCompany[]): Promise<PendingTimesheet[]> {
  const supabase = await createClient();
  const { data: sheets } = await supabase.from("timesheets").select("id, organization_id, membership_id, week_start, submitted_at")
    .in("organization_id", companies.map((c) => c.id)).eq("status", "submitted").order("week_start").limit(500);
  if (!sheets?.length) return [];
  const [{ data: entries }, { data: ms }] = await Promise.all([
    supabase.from("timesheet_entries").select("timesheet_id, work_date, project_id, category, description, hours").in("timesheet_id", sheets.map((s) => s.id)).order("work_date"),
    supabase.from("organization_memberships").select("id, user_id").in("id", sheets.map((s) => s.membership_id)),
  ]);
  const userOf = new Map((ms ?? []).map((m) => [m.id as string, m.user_id as string]));
  const projectIds = [...new Set((entries ?? []).map((e) => e.project_id).filter(Boolean))] as string[];
  const [{ data: profiles }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", [...new Set(userOf.values())]),
    projectIds.length ? supabase.from("projects").select("id, name, code").in("id", projectIds) : Promise.resolve({ data: [] as { id: string; name: string; code: string | null }[] }),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  const pName = new Map((projects ?? []).map((p) => [p.id as string, p.code ? `${p.code} · ${p.name}` : (p.name as string)]));
  const company = new Map(companies.map((c) => [c.id, c]));
  return sheets.map((s) => {
    const rows = (entries ?? []).filter((e) => e.timesheet_id === s.id);
    const uid = userOf.get(s.membership_id as string) ?? null;
    return {
      id: s.id as string, company: company.get(s.organization_id as string)!, userId: uid, name: (uid && nameOf.get(uid)) || "Someone",
      weekStart: s.week_start as string, submittedAt: (s.submitted_at as string) ?? null,
      hours: Math.round(rows.reduce((n, e) => n + Number(e.hours), 0) * 100) / 100,
      entries: rows.map((e) => ({ workDate: e.work_date as string, project: e.project_id ? pName.get(e.project_id as string) ?? "Project" : null, category: (e.category as string) ?? null, description: (e.description as string) ?? null, hours: Number(e.hours) })),
    };
  });
}

export type HubSession = { name: string; userId: string; company: HubCompany; project: string | null; start: string; end: string | null; breakMinutes: number; hours: number; tz: string };

/** Every clock-in session on one day (each in its own project's time zone), in all companies they oversee. */
export async function hubAttendanceDay(companies: HubCompany[], date: string, tz: string): Promise<HubSession[]> {
  const { projectSessionsFrom, todayIn, addDays: plus } = await import("@/lib/time");
  const supabase = await createClient();
  const ids = companies.filter((c) => c.can.time || c.can.staff).map((c) => c.id);
  if (!ids.length) return [];
  const from = new Date(Date.parse(`${plus(date, -1)}T00:00:00Z`)).toISOString();
  const to = new Date(Date.parse(`${plus(date, 2)}T00:00:00Z`)).toISOString();
  const { data: events } = await supabase.from("attendance_events").select("organization_id, membership_id, kind, occurred_at, project_id")
    .in("organization_id", ids).gte("occurred_at", from).lt("occurred_at", to).order("occurred_at").limit(5000);
  const rows = (events ?? []) as (Event & { organization_id: string })[];
  if (!rows.length) return [];
  const memberships = [...new Set(rows.map((e) => e.membership_id))];
  const projectIds = [...new Set(rows.map((e) => e.project_id).filter(Boolean))] as string[];
  const [{ data: ms }, { data: projects }] = await Promise.all([
    supabase.from("organization_memberships").select("id, user_id").in("id", memberships),
    projectIds.length ? supabase.from("projects").select("id, name, code").in("id", projectIds) : Promise.resolve({ data: [] as { id: string; name: string; code: string | null }[] }),
  ]);
  const userOf = new Map((ms ?? []).map((m) => [m.id as string, m.user_id as string]));
  const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", [...new Set(userOf.values())]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  const pName = new Map((projects ?? []).map((p) => [p.id as string, p.code ? `${p.code} · ${p.name}` : (p.name as string)]));
  const company = new Map(companies.map((c) => [c.id, c]));
  const zones = await projectZones(supabase, projectIds);
  const out: HubSession[] = [];
  for (const m of memberships) {
    const own = rows.filter((e) => e.membership_id === m);
    const uid = userOf.get(m);
    if (!uid) continue;
    for (const s of projectSessionsFrom(own as unknown as Parameters<typeof projectSessionsFrom>[0])) {
      // The day is the day where the project is, not where the viewer is.
      const zone = zoneOfProject(s.projectId, zones, company.get(own[0].organization_id)?.timezone ?? tz);
      if (todayIn(zone, new Date(s.start)) !== date) continue;
      out.push({
        name: nameOf.get(uid) ?? "Someone", userId: uid, company: company.get(own[0].organization_id)!,
        project: s.projectId ? pName.get(s.projectId) ?? null : null, start: s.start, end: s.end,
        breakMinutes: s.breakMinutes, tz: zone, hours: Math.round((s.workedMinutes / 60) * 100) / 100,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
