import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPeople } from "@/server/services/people";
import type { TravelStatus } from "@/lib/staffing";
import { addDays, dateOf, isoWeekday, monthStart, daysInMonth, timeOf } from "@/lib/time";

export type StaffCompany = { id: string; name: string; slug: string; timezone: string; canView: boolean; canAssign: boolean; canTravel: boolean; canSettings: boolean };

/** What the signed-in person may do in each of the given companies. */
export async function staffingCompanies(companies: { id: string; name: string; slug: string; timezone: string }[]): Promise<StaffCompany[]> {
  const supabase = await createClient();
  const rows = await Promise.all(companies.map(async (c) => {
    const [view, assign, travel, settings] = await Promise.all([
      supabase.rpc("can_view_staffing", { p_org: c.id }),
      supabase.rpc("has_permission", { p_org: c.id, p_permission: "staffing.assign" }),
      supabase.rpc("can_handle_travel", { p_org: c.id }),
      supabase.rpc("has_permission", { p_org: c.id, p_permission: "org.settings.manage" }),
    ]);
    return { ...c, canView: view.data === true, canAssign: assign.data === true, canTravel: travel.data === true, canSettings: settings.data === true };
  }));
  return rows;
}

/** Colour per company (stable by position), for the calendar chips and the legend. */
export const COMPANY_TONES = [
  "border-sky-400 bg-sky-100 text-sky-950 dark:border-sky-500 dark:bg-sky-800/70 dark:text-sky-50",
  "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-800/70 dark:text-emerald-50",
  "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-500 dark:bg-amber-800/70 dark:text-amber-50",
  "border-violet-400 bg-violet-100 text-violet-950 dark:border-violet-500 dark:bg-violet-800/70 dark:text-violet-50",
  "border-rose-400 bg-rose-100 text-rose-950 dark:border-rose-500 dark:bg-rose-800/70 dark:text-rose-50",
  "border-teal-400 bg-teal-100 text-teal-950 dark:border-teal-500 dark:bg-teal-800/70 dark:text-teal-50",
] as const;
export const COMPANY_DOTS = ["bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-teal-500"] as const;

export type { TravelStatus };
export type DayEntry = {
  companyId: string;
  membershipId: string;
  userId: string;
  person: string;
  projectId: string | null;
  project: string;
  /** planned: assigned; working: assigned and clocked in; unplanned: clocked in without an assignment. */
  state: "planned" | "working" | "unplanned";
  assignmentId: string | null;
  travel: TravelStatus | null;
};
export type DayLeave = { companyId: string; userId: string; person: string; type: string };
export type DayBooking = { companyId: string; userId: string; person: string; kind: string; label: string; requestId: string };

export type MonthData = {
  month: string; // YYYY-MM-01
  days: string[]; // the grid: Monday before the 1st to Sunday after the end
  entries: Map<string, DayEntry[]>;
  leave: Map<string, DayLeave[]>;
  bookings: Map<string, DayBooking[]>;
  projects: { id: string; name: string; companyId: string }[];
  people: { userId: string; name: string }[];
};

const label = (p: { name: string; code: string | null }) => (p.code ? `${p.code} · ${p.name}` : p.name);

/**
 * Everything the month calendar shows for these companies: assignments (planned), clock-ins on
 * projects (actually working), approved leave and travel bookings. Row-level security decides
 * what the viewer sees; filters narrow it to one project or one person.
 */
export async function staffMonth(companies: StaffCompany[], monthIn: string, f: { project?: string; person?: string } = {}): Promise<MonthData> {
  const supabase = await createClient();
  const month = monthStart(monthIn);
  const first = addDays(month, -(isoWeekday(month) - 1));
  const lastOfMonth = addDays(month, daysInMonth(month) - 1);
  const last = addDays(lastOfMonth, 7 - isoWeekday(lastOfMonth));
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const ids = companies.map((c) => c.id);
  const tzOf = new Map(companies.map((c) => [c.id, c.timezone]));
  const empty: MonthData = { month, days, entries: new Map(), leave: new Map(), bookings: new Map(), projects: [], people: [] };
  if (!ids.length) return empty;

  const [peopleLists, { data: projects }, { data: assignments }, { data: punches }, { data: leave }] = await Promise.all([
    Promise.all(companies.map(async (c) => ({ c, list: await listPeople(c.id, { includeInactive: true }) }))),
    supabase.from("projects").select("id, name, code, organization_id, status, archived_at").in("organization_id", ids).order("name"),
    supabase.from("staff_assignments").select("id, organization_id, project_id, membership_id, start_date, end_date")
      .in("organization_id", ids).is("cancelled_at", null).lte("start_date", last).gte("end_date", first).limit(5000),
    supabase.from("attendance_events").select("organization_id, membership_id, project_id, occurred_at")
      .in("organization_id", ids).eq("kind", "clock_in")
      .gte("occurred_at", new Date(Date.parse(`${addDays(first, -1)}T00:00:00Z`)).toISOString())
      .lt("occurred_at", new Date(Date.parse(`${addDays(last, 2)}T00:00:00Z`)).toISOString()).limit(10000),
    supabase.from("leave_requests").select("organization_id, membership_id, start_date, end_date, leave_types(name)")
      .in("organization_id", ids).eq("status", "approved").lte("start_date", last).gte("end_date", first).limit(2000),
  ]);

  const person = new Map<string, { userId: string; name: string }>();
  for (const { list } of peopleLists) for (const p of list) person.set(p.membershipId, { userId: p.userId, name: p.name });
  const projectOf = new Map((projects ?? []).map((p) => [p.id as string, { name: label(p as { name: string; code: string | null }), companyId: p.organization_id as string }]));
  const keep = (membershipId: string, projectId: string | null) =>
    (!f.project || projectId === f.project) && (!f.person || person.get(membershipId)?.userId === f.person);

  // Travel status of each assignment, and the bookings in view.
  const aList = (assignments ?? []).filter((a) => keep(a.membership_id as string, a.project_id as string));
  const { data: requests } = aList.length
    ? await supabase.from("travel_requests").select("id, assignment_id, status").in("assignment_id", aList.map((a) => a.id as string))
    : { data: [] as { id: string; assignment_id: string; status: string }[] };
  const travelOf = new Map((requests ?? []).map((r) => [r.assignment_id as string, r.status as TravelStatus]));
  const { data: bookingRows } = (requests ?? []).length
    ? await supabase.from("travel_bookings").select("id, organization_id, request_id, kind, title, from_place, to_place, starts_at, start_tz, all_day")
      .in("request_id", (requests ?? []).map((r) => r.id as string)).is("cancelled_at", null)
    : { data: [] as { id: string; organization_id: string; request_id: string; kind: string; title: string; from_place: string | null; to_place: string | null; starts_at: string; start_tz: string; all_day: boolean }[] };

  const entries = new Map<string, DayEntry[]>();
  const put = (d: string, e: DayEntry) => entries.set(d, [...(entries.get(d) ?? []), e]);
  const planned = new Map<string, DayEntry>(); // date|membership|project
  for (const a of aList) {
    const who = person.get(a.membership_id as string);
    if (!who) continue;
    const proj = projectOf.get(a.project_id as string);
    for (let d = a.start_date as string; d <= (a.end_date as string); d = addDays(d, 1)) {
      if (d < first || d > last) continue;
      const e: DayEntry = {
        companyId: a.organization_id as string, membershipId: a.membership_id as string, userId: who.userId, person: who.name,
        projectId: a.project_id as string, project: proj?.name ?? "Project", state: "planned", assignmentId: a.id as string, travel: travelOf.get(a.id as string) ?? null,
      };
      planned.set(`${d}|${a.membership_id}|${a.project_id}`, e);
      put(d, e);
    }
  }
  const seen = new Set<string>();
  for (const p of punches ?? []) {
    if (!keep(p.membership_id as string, (p.project_id as string) ?? null)) continue;
    const d = dateOf(p.occurred_at as string, tzOf.get(p.organization_id as string) ?? "UTC");
    if (d < first || d > last) continue;
    const key = `${d}|${p.membership_id}|${p.project_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const plan = planned.get(key);
    if (plan) { plan.state = "working"; continue; }
    const who = person.get(p.membership_id as string);
    if (!who) continue;
    // The same person clocked in under two companies on one day: show it once.
    const personKey = `${d}|${who.userId}|${p.project_id ?? ""}`;
    if (seen.has(personKey)) continue;
    seen.add(personKey);
    put(d, {
      companyId: p.organization_id as string, membershipId: p.membership_id as string, userId: who.userId, person: who.name,
      projectId: (p.project_id as string) ?? null, project: p.project_id ? projectOf.get(p.project_id as string)?.name ?? "Project" : "No project chosen",
      state: "unplanned", assignmentId: null, travel: null,
    });
  }
  // Bookings first (so a full day never hides them behind clock-ins), then by name.
  for (const list of entries.values()) list.sort((a, b) => Number(a.state === "unplanned") - Number(b.state === "unplanned") || a.person.localeCompare(b.person) || a.project.localeCompare(b.project));

  const leaveMap = new Map<string, DayLeave[]>();
  for (const l of leave ?? []) {
    if (f.project) break;
    const who = person.get(l.membership_id as string);
    if (!who || (f.person && who.userId !== f.person)) continue;
    const type = (l as unknown as { leave_types: { name: string } | null }).leave_types?.name ?? "Leave";
    for (let d = l.start_date as string; d <= (l.end_date as string); d = addDays(d, 1)) {
      if (d < first || d > last) continue;
      leaveMap.set(d, [...(leaveMap.get(d) ?? []), { companyId: l.organization_id as string, userId: who.userId, person: who.name, type }]);
    }
  }

  const bookings = new Map<string, DayBooking[]>();
  const reqAssignment = new Map((requests ?? []).map((r) => [r.id as string, r.assignment_id as string]));
  const aById = new Map(aList.map((a) => [a.id as string, a]));
  for (const b of bookingRows ?? []) {
    const a = aById.get(reqAssignment.get(b.request_id as string) ?? "");
    const who = a ? person.get(a.membership_id as string) : null;
    if (!a || !who) continue;
    const tz = (b.start_tz as string) || "UTC";
    const d = dateOf(b.starts_at as string, tz);
    if (d < first || d > last) continue;
    const route = b.from_place && b.to_place ? ` ${b.from_place} → ${b.to_place}` : "";
    const at = b.all_day ? "" : ` ${timeOf(b.starts_at as string, tz)}`;
    bookings.set(d, [...(bookings.get(d) ?? []), {
      companyId: b.organization_id as string, userId: who.userId, person: who.name, kind: b.kind as string,
      label: `${b.kind === "hotel" ? "Check-in" : b.title}${route}${at}`, requestId: b.request_id as string,
    }]);
  }

  const people = new Map<string, string>();
  for (const { list } of peopleLists) for (const p of list) if (p.status === "active") people.set(p.userId, p.name);
  return {
    month, days, entries, leave: leaveMap, bookings,
    projects: (projects ?? []).filter((p) => !p.archived_at && p.status !== "cancelled").map((p) => ({ id: p.id as string, name: label(p as { name: string; code: string | null }), companyId: p.organization_id as string })),
    people: [...people].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type AssignOptions = {
  companies: { id: string; name: string }[];
  projects: { id: string; name: string; companyId: string; start: string | null; end: string | null }[];
  people: { membershipId: string; userId: string; name: string; jobTitle: string | null; companyId: string }[];
};

/** Open projects and active people of the companies where the viewer may assign staff. */
export async function assignOptions(companies: StaffCompany[]): Promise<AssignOptions> {
  const list = companies.filter((c) => c.canAssign);
  if (!list.length) return { companies: [], projects: [], people: [] };
  const supabase = await createClient();
  const [{ data: projects }, people] = await Promise.all([
    supabase.from("projects").select("id, name, code, organization_id, start_date, end_date").in("organization_id", list.map((c) => c.id))
      .in("status", ["planning", "active", "on_hold"]).is("archived_at", null).order("name"),
    Promise.all(list.map(async (c) => (await listPeople(c.id)).map((p) => ({ membershipId: p.membershipId, userId: p.userId, name: p.name, jobTitle: p.jobTitle, companyId: c.id })))),
  ]);
  return {
    companies: list.map((c) => ({ id: c.id, name: c.name })),
    projects: (projects ?? []).map((p) => ({ id: p.id as string, name: label(p as { name: string; code: string | null }), companyId: p.organization_id as string, start: (p.start_date as string) ?? null, end: (p.end_date as string) ?? null })),
    people: people.flat().sort((a, b) => a.name.localeCompare(b.name)),
  };
}


export type BookingRow = {
  id: string; kind: string; title: string; reference: string | null; from_place: string | null; to_place: string | null; address: string | null;
  all_day: boolean; starts_at: string; ends_at: string; start_tz: string; end_tz: string; notes: string | null;
  attachments: { name: string; size: number }[]; outlook: string | null;
};

export type TripDetail = {
  assignment: { id: string; organizationId: string; projectId: string; membershipId: string; start: string; end: string; notes: string | null; needsTravel: boolean; cancelled: boolean; createdAt: string };
  person: { userId: string; name: string; jobTitle: string | null; email: string | null };
  project: { id: string; name: string; site: string | null; country: string | null };
  invite: string | null; // Outlook status of the staff invite
  request: { id: string; status: TravelStatus; travelFrom: string | null; notes: string | null; coordinatorNotes: string | null; requestedAt: string; requestedBy: string | null; datesChangedFrom: string | null } | null;
  bookings: BookingRow[];
  /** Everyone assigned together with this person (including them). */
  trip: { assignmentId: string; name: string }[];
};

/** One assignment with its travel request and bookings (row-level security decides access). */
export async function tripDetail(by: { assignmentId?: string; requestId?: string }): Promise<TripDetail | null> {
  const supabase = await createClient();
  let assignmentId = by.assignmentId;
  if (!assignmentId && by.requestId) {
    const { data } = await supabase.from("travel_requests").select("assignment_id").eq("id", by.requestId).maybeSingle();
    assignmentId = (data?.assignment_id as string) ?? undefined;
  }
  if (!assignmentId) return null;
  const { data: a } = await supabase.from("staff_assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!a) return null;
  const [{ data: m }, { data: p }, { data: r }] = await Promise.all([
    supabase.from("organization_memberships").select("user_id, job_title").eq("id", a.membership_id).maybeSingle(),
    supabase.from("projects").select("id, name, code, site_label, country").eq("id", a.project_id).maybeSingle(),
    supabase.from("travel_requests").select("*").eq("assignment_id", a.id).maybeSingle(),
  ]);
  const [{ data: prof }, { data: bookings }, { data: requester }] = await Promise.all([
    supabase.from("profiles").select("display_name, email_display").eq("id", m?.user_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
    r ? supabase.from("travel_bookings").select("*").eq("request_id", r.id).is("cancelled_at", null).order("starts_at") : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    r?.requested_by ? supabase.from("profiles").select("display_name").eq("id", r.requested_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // Outlook status and attachment names come from the invites behind them (server-side read).
  const admin = createAdminClient();
  const bIds = [a.broadcast_id as string | null, ...(bookings ?? []).map((b) => b.broadcast_id as string | null)].filter((x): x is string => Boolean(x));
  const [{ data: sync }, { data: casts }] = bIds.length
    ? await Promise.all([
      admin.from("calendar_sync").select("ref_id, status").eq("kind", "manual").in("ref_id", bIds),
      admin.from("calendar_broadcasts").select("id, attachments").in("id", bIds),
    ])
    : [{ data: [] }, { data: [] }];
  const status = new Map((sync ?? []).map((s) => [s.ref_id as string, s.status as string]));
  const files = new Map((casts ?? []).map((c) => [c.id as string, ((c.attachments ?? []) as { name: string; size: number }[]).map((f) => ({ name: f.name, size: f.size }))]));
  return {
    assignment: {
      id: a.id as string, organizationId: a.organization_id as string, projectId: a.project_id as string, membershipId: a.membership_id as string,
      start: a.start_date as string, end: a.end_date as string, notes: (a.notes as string) ?? null, needsTravel: Boolean(a.needs_travel), cancelled: Boolean(a.cancelled_at), createdAt: a.created_at as string,
    },
    person: { userId: (m?.user_id as string) ?? "", name: (prof?.display_name as string) ?? "Someone", jobTitle: (m?.job_title as string) ?? null, email: (prof?.email_display as string) ?? null },
    project: { id: (p?.id as string) ?? (a.project_id as string), name: p ? label(p as { name: string; code: string | null }) : "Project", site: (p?.site_label as string) ?? null, country: (p?.country as string) ?? null },
    invite: a.broadcast_id ? status.get(a.broadcast_id as string) ?? "pending" : null,
    request: r ? {
      id: r.id as string, status: r.status as TravelStatus, travelFrom: (r.travel_from as string) ?? null, notes: (r.notes as string) ?? null,
      coordinatorNotes: (r.coordinator_notes as string) ?? null, requestedAt: r.requested_at as string, requestedBy: (requester?.display_name as string) ?? null,
      datesChangedFrom: (r.dates_changed_from as string) ?? null,
    } : null,
    trip: await tripMembers(a.batch_id as string | null, a.id as string, a.organization_id as string),
    bookings: (bookings ?? []).map((b) => ({
      id: b.id as string, kind: b.kind as string, title: b.title as string, reference: (b.reference as string) ?? null, from_place: (b.from_place as string) ?? null,
      to_place: (b.to_place as string) ?? null, address: (b.address as string) ?? null, all_day: Boolean(b.all_day), starts_at: b.starts_at as string, ends_at: b.ends_at as string,
      start_tz: b.start_tz as string, end_tz: b.end_tz as string, notes: (b.notes as string) ?? null,
      attachments: b.broadcast_id ? files.get(b.broadcast_id as string) ?? [] : [], outlook: b.broadcast_id ? status.get(b.broadcast_id as string) ?? "pending" : null,
    })),
  };
}

export type TravelListRow = {
  id: string; status: TravelStatus; person: string; project: string; start: string; end: string; travelFrom: string | null; bookings: number; requestedAt: string; assignmentId: string;
};

/** A company's travel requests, newest trips first (open ones only unless `all`). */
export async function travelRequests(orgId: string, all: boolean): Promise<TravelListRow[]> {
  const supabase = await createClient();
  let q = supabase.from("travel_requests").select("id, status, travel_from, requested_at, assignment_id").eq("organization_id", orgId).order("requested_at", { ascending: false }).limit(300);
  if (!all) q = q.in("status", ["requested", "in_progress"]);
  const { data: rs } = await q;
  if (!rs?.length) return [];
  const [{ data: as }, { data: bs }] = await Promise.all([
    supabase.from("staff_assignments").select("id, membership_id, project_id, start_date, end_date").in("id", rs.map((r) => r.assignment_id as string)),
    supabase.from("travel_bookings").select("request_id").in("request_id", rs.map((r) => r.id as string)).is("cancelled_at", null),
  ]);
  const [people, { data: ps }] = await Promise.all([
    listPeople(orgId, { includeInactive: true }),
    supabase.from("projects").select("id, name, code").in("id", [...new Set((as ?? []).map((a) => a.project_id as string))]),
  ]);
  const aBy = new Map((as ?? []).map((a) => [a.id as string, a]));
  const who = new Map(people.map((p) => [p.membershipId, p.name]));
  const proj = new Map((ps ?? []).map((p) => [p.id as string, label(p as { name: string; code: string | null })]));
  const count = new Map<string, number>();
  for (const b of bs ?? []) count.set(b.request_id as string, (count.get(b.request_id as string) ?? 0) + 1);
  return rs.flatMap((r) => {
    const a = aBy.get(r.assignment_id as string);
    if (!a) return [];
    return [{
      id: r.id as string, status: r.status as TravelStatus, person: who.get(a.membership_id as string) ?? "Someone", project: proj.get(a.project_id as string) ?? "Project",
      start: a.start_date as string, end: a.end_date as string, travelFrom: (r.travel_from as string) ?? null, bookings: count.get(r.id as string) ?? 0,
      requestedAt: r.requested_at as string, assignmentId: a.id as string,
    }];
  }).sort((x, y) => x.start.localeCompare(y.start));
}

async function tripMembers(batch: string | null, self: string, orgId: string) {
  const supabase = await createClient();
  const { data } = batch
    ? await supabase.from("staff_assignments").select("id, membership_id").eq("batch_id", batch).is("cancelled_at", null)
    : { data: [] as { id: string; membership_id: string }[] };
  if (!data?.length) return [];
  const people = await listPeople(orgId, { includeInactive: true });
  const name = new Map(people.map((p) => [p.membershipId, p.name]));
  return data.map((a) => ({ assignmentId: a.id as string, name: name.get(a.membership_id as string) ?? "Someone", self: a.id === self }))
    .sort((x, y) => x.name.localeCompare(y.name)).map(({ assignmentId, name }) => ({ assignmentId, name }));
}

export type TripRow = { key: string; firstId: string; companyId: string; slug: string; project: string; start: string; end: string; people: string[]; travel: TravelStatus | null };

/** Trips (people assigned together) overlapping the month, for the list under the calendar. */
export async function tripsInMonth(companies: StaffCompany[], monthIn: string): Promise<TripRow[]> {
  const list = companies.filter((c) => c.canView);
  if (!list.length) return [];
  const supabase = await createClient();
  const month = monthStart(monthIn);
  const last = addDays(month, daysInMonth(month) - 1);
  const { data: as } = await supabase.from("staff_assignments").select("id, batch_id, organization_id, project_id, membership_id, start_date, end_date, created_at")
    .in("organization_id", list.map((c) => c.id)).is("cancelled_at", null).lte("start_date", last).gte("end_date", month).order("start_date").limit(1000);
  if (!as?.length) return [];
  const [{ data: ps }, { data: rs }, people] = await Promise.all([
    supabase.from("projects").select("id, name, code").in("id", [...new Set(as.map((a) => a.project_id as string))]),
    supabase.from("travel_requests").select("assignment_id, status").in("assignment_id", as.map((a) => a.id as string)),
    Promise.all(list.map((c) => listPeople(c.id, { includeInactive: true }))),
  ]);
  const proj = new Map((ps ?? []).map((p) => [p.id as string, label(p as { name: string; code: string | null })]));
  const travel = new Map((rs ?? []).map((r) => [r.assignment_id as string, r.status as TravelStatus]));
  const who = new Map(people.flat().map((p) => [p.membershipId, p.name]));
  const slug = new Map(list.map((c) => [c.id, c.slug]));
  const order: TravelStatus[] = ["requested", "in_progress", "booked", "cancelled"];
  const trips = new Map<string, TripRow>();
  for (const a of as) {
    const key = (a.batch_id as string) ?? (a.id as string);
    const t = trips.get(key) ?? {
      key, firstId: a.id as string, companyId: a.organization_id as string, slug: slug.get(a.organization_id as string) ?? "",
      project: proj.get(a.project_id as string) ?? "Project", start: a.start_date as string, end: a.end_date as string, people: [], travel: null,
    };
    t.people.push(who.get(a.membership_id as string) ?? "Someone");
    const st = travel.get(a.id as string) ?? null;
    if (st && st !== "cancelled" && (!t.travel || order.indexOf(st) < order.indexOf(t.travel))) t.travel = st; // the least advanced status
    trips.set(key, t);
  }
  return [...trips.values()].map((t) => ({ ...t, people: t.people.sort() }));
}
