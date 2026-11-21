"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import { addDays, isDateString, zonedToUtc } from "@/lib/time";
import { escapeHtml } from "@/lib/email";
import { logServerError, type ActionResult } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth/session";
import { syncCalendarsSoon, type StoredAttachment } from "@/server/services/outlook";
import { MAX_ATTACHMENT_BYTES } from "@/lib/outlook/graph";
import { UploadError, validateUpload, type ValidatedUpload } from "@/lib/files/validate";
import { BOOKING_KINDS, describeBooking, fmtRange } from "@/lib/staffing";

type Admin = ReturnType<typeof createAdminClient>;

const refresh = () => {
  revalidatePath("/hub", "layout");
  revalidatePath("/o/[org]", "layout");
};

const zoneOk = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz.length > 0 && tz.length <= 64;
  } catch {
    return false;
  }
};

async function allowed(orgId: string, perm: "staffing.assign" | "travel" | "settings") {
  const supabase = await createClient();
  if (perm === "travel") return (await supabase.rpc("can_handle_travel", { p_org: orgId })).data === true;
  if (perm === "settings") {
    const [a, b] = await Promise.all([
      supabase.rpc("has_permission", { p_org: orgId, p_permission: "org.settings.manage" }),
      supabase.rpc("has_permission", { p_org: orgId, p_permission: "travel.manage" }),
    ]);
    return a.data === true || b.data === true;
  }
  return (await supabase.rpc("has_permission", { p_org: orgId, p_permission: perm })).data === true;
}

/** Puts an invite/email back in the Outlook queue (sent within seconds, retried on failure). */
async function queue(admin: Admin, orgId: string, broadcastId: string) {
  await admin.from("calendar_sync").upsert(
    { organization_id: orgId, kind: "manual", ref_id: broadcastId, status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() },
    { onConflict: "kind,ref_id" },
  );
}

const row = (k: string, v: string | null | undefined) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#556770;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v).replace(/\n/g, "<br>")}</td></tr>` : "");
const table = (rows: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 16px">${rows}</table>`;

type Ctx = {
  org: { id: string; name: string; slug: string; tz: string };
  project: { id: string; name: string; site: string | null; country: string | null };
};

async function context(admin: Admin, orgId: string, projectId: string): Promise<Ctx | null> {
  const [{ data: o }, { data: p }] = await Promise.all([
    admin.from("organizations").select("id, name, slug, timezone").eq("id", orgId).maybeSingle(),
    admin.from("projects").select("id, name, code, site_label, country, organization_id, status, archived_at").eq("id", projectId).maybeSingle(),
  ]);
  if (!o || !p || p.organization_id !== orgId) return null;
  return {
    org: { id: o.id as string, name: o.name as string, slug: o.slug as string, tz: (o.timezone as string) || "UTC" },
    project: { id: p.id as string, name: p.code ? `${p.code} · ${p.name}` : (p.name as string), site: (p.site_label as string) ?? null, country: (p.country as string) ?? null },
  };
}

async function peopleOf(admin: Admin, membershipIds: string[]) {
  if (!membershipIds.length) return [];
  const { data: ms } = await admin.from("organization_memberships").select("id, user_id, organization_id, status, job_title").in("id", membershipIds);
  const userIds = [...new Set((ms ?? []).map((m) => m.user_id as string))];
  const { data: ps } = userIds.length ? await admin.from("profiles").select("id, display_name, email_display, status").in("id", userIds) : { data: [] };
  const prof = new Map((ps ?? []).map((p) => [p.id as string, p]));
  return (ms ?? []).map((m) => {
    const p = prof.get(m.user_id as string);
    return {
      membershipId: m.id as string, userId: m.user_id as string, orgId: m.organization_id as string, active: m.status === "active",
      name: (p?.display_name as string) ?? "Someone", email: p?.status === "active" && p.email_display ? String(p.email_display).toLowerCase() : null,
      jobTitle: (m.job_title as string) ?? null,
    };
  });
}

/** The company's travel coordinators: leads get the request email, the others are copied. */
async function coordinatorsOf(admin: Admin, orgId: string) {
  const { data } = await admin.from("travel_coordinators").select("membership_id, is_lead").eq("organization_id", orgId);
  const people = (await peopleOf(admin, (data ?? []).map((c) => c.membership_id as string))).filter((p) => p.active);
  const lead = new Set((data ?? []).filter((c) => c.is_lead).map((c) => c.membership_id as string));
  const leads = people.filter((p) => lead.has(p.membershipId));
  const others = people.filter((p) => !lead.has(p.membershipId));
  return { all: people, to: (leads.length ? leads : others), cc: leads.length ? others : [] };
}

function assignmentHtml(c: Ctx, a: { start: string; end: string; notes: string | null; travel: boolean }) {
  return `<p>You're assigned to <strong>${escapeHtml(c.project.name)}</strong>.</p>${table(
    row("Company", c.org.name) + row("Dates", fmtRange(a.start, a.end)) + row("Site", [c.project.site, c.project.country].filter(Boolean).join(", ") || null) +
    row("Notes", a.notes) + row("Travel & accommodation", a.travel ? "Requested — your flights and hotel will be added to your calendar once booked." : null),
  )}`;
}

async function writeAssignmentInvite(admin: Admin, c: Ctx, a: { id: string; start: string; end: string; notes: string | null; travel: boolean; broadcastId: string | null }, who: { userId: string; email: string | null }, actor: string) {
  const fields = {
    title: `Project: ${c.project.name} (${c.org.name})`.slice(0, 200),
    body: assignmentHtml(c, a),
    location: [c.project.site, c.project.country].filter(Boolean).join(", ") || null,
    starts_at: zonedToUtc(a.start, "00:00", c.org.tz),
    ends_at: zonedToUtc(addDays(a.end, 1), "00:00", c.org.tz),
    all_day: true, time_zone: c.org.tz,
    attendee_emails: who.email ? [who.email] : [], attendee_user_ids: [who.userId],
    link_path: `/o/${c.org.slug}/staffing/${a.id}`,
  };
  if (a.broadcastId) {
    await admin.from("calendar_broadcasts").update(fields).eq("id", a.broadcastId);
    await queue(admin, c.org.id, a.broadcastId);
    return a.broadcastId;
  }
  const { data: b, error } = await admin.from("calendar_broadcasts").insert({
    ...fields, organization_id: c.org.id, kind: "invite", category: "project", source: "staffing", audience: "Staff calendar", created_by: actor,
  }).select("id").single();
  if (error || !b) throw error ?? new Error("broadcast insert");
  await admin.from("staff_assignments").update({ broadcast_id: b.id }).eq("id", a.id);
  await queue(admin, c.org.id, b.id as string);
  return b.id as string;
}

type TravelLine = {
  requestId: string; name: string; jobTitle: string | null; email: string | null; start: string; end: string; from: string | null; notes: string | null;
  /** The dates before a change. */ previous?: string;
  /** Bookings already made, for changes and cancellations. */ bookings?: string[];
  requesterId?: string | null;
};

async function emailsOfUsers(admin: Admin, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return [] as string[];
  const { data } = await admin.from("profiles").select("email_display, status").in("id", list);
  return (data ?? []).filter((p) => p.status === "active" && p.email_display).map((p) => String(p.email_display).toLowerCase());
}

async function bookingLines(admin: Admin, requestId: string) {
  const { data } = await admin.from("travel_bookings").select("kind, title, reference, from_place, to_place, all_day, starts_at, ends_at, start_tz").eq("request_id", requestId).is("cancelled_at", null).order("starts_at");
  return (data ?? []).map((b) => describeBooking(b as Parameters<typeof describeBooking>[0]));
}

/** Addresses: coordinators (leads in To), and everyone else on the trip copied — travellers, whoever requested it and whoever made the change. */
async function tripRecipients(admin: Admin, orgId: string, extra: { travellers: (string | null)[]; userIds: (string | null | undefined)[] }) {
  const co = await coordinatorsOf(admin, orgId);
  let to = co.to.map((p) => p.email).filter((e): e is string => Boolean(e));
  const others = [...co.cc.map((p) => p.email), ...extra.travellers, ...(await emailsOfUsers(admin, extra.userIds))].filter((e): e is string => Boolean(e));
  let cc = [...new Set(others)].filter((e) => !to.includes(e));
  if (!to.length) { to = cc; cc = []; }
  return { co, to, cc };
}

/** One email about one or more travellers on the same project: new request, changed dates or cancelled. */
async function emailCoordinators(admin: Admin, c: Ctx, kind: "new" | "reminder" | "changed" | "cancelled", lines: TravelLine[], actor: { id: string; name: string }) {
  if (!lines.length) return { sent: false, names: [] as string[] };
  const { co, to, cc } = await tripRecipients(admin, c.org.id, { travellers: lines.map((l) => l.email), userIds: [actor.id, ...lines.map((l) => l.requesterId)] });
  if (!to.length || (!co.all.length && (kind === "new" || kind === "reminder"))) return { sent: false, names: [] as string[] };
  const intro = {
    new: "Please arrange travel and accommodation for:",
    reminder: "Reminder: this travel and accommodation request is still waiting. Please arrange it, or reply if it is already done:",
    changed: "The dates of this trip have changed. Please change the travel and accommodation to match:",
    cancelled: "This trip is cancelled. Please cancel the travel and accommodation already booked (they have been taken out of the traveller's calendar):",
  }[kind];
  const head = { new: "Travel & accommodation request", reminder: "Reminder — travel request", changed: "Trip changed", cancelled: "Trip cancelled" }[kind];
  const blocks = lines.map((l) => `<h2 style="font-size:16px;margin:16px 0 4px">${escapeHtml(l.name)}${l.jobTitle ? ` <span style="color:#556770;font-weight:normal">· ${escapeHtml(l.jobTitle)}</span>` : ""}</h2>${table(
    (l.previous ? row("Was", l.previous) + row("Now", fmtRange(l.start, l.end)) : row(kind === "cancelled" ? "Was on site" : "Dates on site", fmtRange(l.start, l.end))) +
    row("Travelling from", l.from) + row("Notes", l.notes) +
    (l.bookings?.length ? row(kind === "cancelled" ? "Cancel these bookings" : "Already booked — check or change", l.bookings.join("\n")) : ""),
  )}`).join("");
  const base = `<p>${escapeHtml(intro)}</p>${table(row("Project", c.project.name) + row("Company", c.org.name) + row("Site", [c.project.site, c.project.country].filter(Boolean).join(", ") || null) + row(kind === "new" ? "Requested by" : kind === "reminder" ? "Reminder sent by" : "Changed by", actor.name))}${blocks}` +
    (kind === "cancelled" ? "" : `<p>Coordinators: enter or edit each flight, hotel and transfer on the request page (with the booking confirmation). Every booking goes straight into the traveller's Outlook calendar.</p>`);
  const first = lines[0];
  const title = `${head}: ${lines.length === 1 ? first.name : `${lines.length} people`} — ${c.project.name}, ${fmtRange(first.start, first.end)}`.slice(0, 200);
  const link = lines.length === 1 ? `/o/${c.org.slug}/travel/${first.requestId}` : `/o/${c.org.slug}/travel`;
  const { data: b } = await admin.from("calendar_broadcasts").insert({
    organization_id: c.org.id, kind: "update", category: "travel", source: "travel_request", title, body: base,
    attendee_emails: to, cc_emails: cc, attendee_user_ids: co.all.map((p) => p.userId), created_by: actor.id, audience: "Trip",
    link_path: link,
  }).select("id").single();
  if (b) await queue(admin, c.org.id, b.id as string);
  await admin.from("notifications").insert(co.all.filter((p) => p.userId !== actor.id).map((p) => ({
    organization_id: c.org.id, user_id: p.userId, kind: "travel", actor_id: actor.id, title: title.slice(0, 200), body: `${c.org.name}`, link,
  })));
  return { sent: true, names: co.to.map((p) => p.name) };
}

/** Booking added, changed or removed: the coordinators and the requester get an email (the traveller gets the Outlook invite). */
async function emailBooking(admin: Admin, c: Ctx, kind: "added" | "changed" | "cancelled", what: string, traveller: string, requestId: string, requesterId: string | null, actor: { id: string; name: string }) {
  const { to, cc } = await tripRecipients(admin, c.org.id, { travellers: [], userIds: [actor.id, requesterId] });
  if (!to.length) return;
  const head = { added: "Booked", changed: "Booking changed", cancelled: "Booking cancelled" }[kind];
  const title = `${head} for ${traveller}: ${what}`.slice(0, 200);
  const body = `<p>${escapeHtml(head)} for <strong>${escapeHtml(traveller)}</strong> by ${escapeHtml(actor.name)}.</p>${table(row("Booking", what) + row("Project", c.project.name) + row("Company", c.org.name))}` +
    `<p>${kind === "cancelled" ? `It has been taken out of ${escapeHtml(traveller)}'s calendar.` : `It is in ${escapeHtml(traveller)}'s Outlook calendar.`}</p>`;
  const { data: b } = await admin.from("calendar_broadcasts").insert({
    organization_id: c.org.id, kind: "update", category: "travel", source: "travel_request", title, body,
    attendee_emails: to, cc_emails: cc, attendee_user_ids: [], created_by: actor.id, audience: "Trip", link_path: `/o/${c.org.slug}/travel/${requestId}`,
  }).select("id").single();
  if (b) await queue(admin, c.org.id, b.id as string);
}

async function actorName(admin: Admin, id: string) {
  const { data } = await admin.from("profiles").select("display_name").eq("id", id).maybeSingle();
  return (data?.display_name as string) ?? "Management";
}

const assignSchema = z.object({
  organization_id: uuid,
  project_id: uuid,
  start_date: z.string().refine(isDateString, "Choose the first day"),
  end_date: z.string().refine(isDateString, "Choose the last day"),
  notes: z.string().trim().max(1000, "Keep notes under 1000 characters").optional().default(""),
  needs_travel: z.string().optional(),
  travel_from: z.string().trim().max(200).optional().default(""),
  travel_notes: z.string().trim().max(2000).optional().default(""),
  force: z.string().optional(),
});

export type AssignResult = ActionResult<{ conflicts: string[] }>;

/** Who is already booked elsewhere (or on leave) on any of those days, across every company. */
async function conflictsFor(admin: Admin, userIds: string[], start: string, end: string, skipAssignment?: string) {
  if (!userIds.length) return [];
  const { data: ms } = await admin.from("organization_memberships").select("id, user_id").in("user_id", userIds);
  const mIds = (ms ?? []).map((m) => m.id as string);
  if (!mIds.length) return [];
  const userOf = new Map((ms ?? []).map((m) => [m.id as string, m.user_id as string]));
  const [{ data: as }, { data: lv }, { data: ps }] = await Promise.all([
    admin.from("staff_assignments").select("id, membership_id, project_id, start_date, end_date, projects(name, code), organizations(name)")
      .in("membership_id", mIds).is("cancelled_at", null).lte("start_date", end).gte("end_date", start),
    admin.from("leave_requests").select("membership_id, start_date, end_date").in("membership_id", mIds).eq("status", "approved").lte("start_date", end).gte("end_date", start),
    admin.from("profiles").select("id, display_name").in("id", userIds),
  ]);
  const name = new Map((ps ?? []).map((p) => [p.id as string, p.display_name as string]));
  const out: string[] = [];
  for (const a of (as ?? []) as unknown as { id: string; membership_id: string; start_date: string; end_date: string; projects: { name: string; code: string | null } | null; organizations: { name: string } | null }[]) {
    if (a.id === skipAssignment) continue;
    const p = a.projects ? (a.projects.code ? `${a.projects.code} · ${a.projects.name}` : a.projects.name) : "another project";
    out.push(`${name.get(userOf.get(a.membership_id)!) ?? "Someone"} is already on ${p}${a.organizations ? ` (${a.organizations.name})` : ""}, ${fmtRange(a.start_date, a.end_date)}.`);
  }
  for (const l of lv ?? []) out.push(`${name.get(userOf.get(l.membership_id as string)!) ?? "Someone"} is on approved leave, ${fmtRange(l.start_date as string, l.end_date as string)}.`);
  return out;
}

/**
 * Assigns people to a project for a run of days: each gets an Outlook invite, and when travel is
 * needed the company's travel coordinators get one request email covering everyone.
 */
export async function assignStaff(_prev: AssignResult, formData: FormData): Promise<AssignResult> {
  const parsed = assignSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  const d = parsed.data;
  if (d.end_date < d.start_date) return { ok: false, error: "The last day is before the first day.", fieldErrors: { end_date: ["On or after the first day"] } };
  if (addDays(d.start_date, 366) < d.end_date) return { ok: false, error: "Assign up to a year at a time.", fieldErrors: { end_date: ["Up to a year"] } };
  const membershipIds = [...new Set(formData.getAll("people").map(String).filter((x) => uuid.safeParse(x).success))];
  if (!membershipIds.length) return { ok: false, error: "Tick at least one person.", fieldErrors: { people: ["Tick at least one person"] } };
  if (membershipIds.length > 50) return { ok: false, error: "Assign up to 50 people at a time." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  if (!(await allowed(d.organization_id, "staffing.assign"))) return { ok: false, error: "You can't assign staff in this company." };

  const admin = createAdminClient();
  const c = await context(admin, d.organization_id, d.project_id);
  if (!c) return { ok: false, error: "Choose a project of this company.", fieldErrors: { project_id: ["Choose a project"] } };
  const people = (await peopleOf(admin, membershipIds)).filter((p) => p.orgId === d.organization_id && p.active);
  if (people.length !== membershipIds.length) return { ok: false, error: "Someone you ticked isn't an active member of this company." };

  if (d.force !== "1") {
    const conflicts = await conflictsFor(admin, people.map((p) => p.userId), d.start_date, d.end_date);
    if (conflicts.length) return { ok: true, data: { conflicts } };
  }

  const travel = d.needs_travel === "on";
  const lines: TravelLine[] = [];
  const batch = randomUUID(); // everyone assigned together is one trip
  try {
    for (const p of people) {
      const { data: a, error } = await admin.from("staff_assignments").insert({
        organization_id: d.organization_id, project_id: d.project_id, membership_id: p.membershipId, start_date: d.start_date, end_date: d.end_date,
        notes: d.notes || null, needs_travel: travel, batch_id: batch, created_by: user.id, updated_by: user.id,
      }).select("id").single();
      if (error || !a) throw error ?? new Error("assignment insert");
      await writeAssignmentInvite(admin, c, { id: a.id as string, start: d.start_date, end: d.end_date, notes: d.notes || null, travel, broadcastId: null }, p, user.id);
      if (travel) {
        const { data: r } = await admin.from("travel_requests").insert({
          organization_id: d.organization_id, assignment_id: a.id, travel_from: d.travel_from || null, notes: d.travel_notes || null, requested_by: user.id, updated_by: user.id,
        }).select("id").single();
        if (r) lines.push({ requestId: r.id as string, name: p.name, jobTitle: p.jobTitle, email: p.email, requesterId: user.id, start: d.start_date, end: d.end_date, from: d.travel_from || null, notes: d.travel_notes || null });
      }
    }
  } catch (e) {
    logServerError("staffing.assign", e);
    return { ok: false, error: "Couldn't save every assignment. Check the calendar and try again." };
  }
  const name = await actorName(admin, user.id);
  await admin.from("notifications").insert(people.filter((p) => p.userId !== user.id).map((p) => ({
    organization_id: d.organization_id, user_id: p.userId, kind: "staffing", actor_id: user.id,
    title: `You're on ${c.project.name}`.slice(0, 200), body: `${fmtRange(d.start_date, d.end_date)} · ${c.org.name}`, link: `/o/${c.org.slug}/staffing`,
  })));
  const mail = travel ? await emailCoordinators(admin, c, "new", lines, { id: user.id, name }) : { sent: false, names: [] };
  syncCalendarsSoon();
  refresh();
  const who = people.length === 1 ? people[0].name : `${people.length} people`;
  const travelMsg = travel ? (mail.sent ? ` Travel request emailed to ${mail.names.join(" and ")}.` : " No travel coordinator is set for this company yet, so the travel request is waiting on the Travel page.") : "";
  return { ok: true, message: `${who} assigned to ${c.project.name}, ${fmtRange(d.start_date, d.end_date)}. Outlook invites are on their way.${travelMsg}` };
}

const updateSchema = z.object({
  id: uuid,
  start_date: z.string().refine(isDateString, "Choose the first day"),
  end_date: z.string().refine(isDateString, "Choose the last day"),
  notes: z.string().trim().max(1000).optional().default(""),
  needs_travel: z.string().optional(),
  travel_from: z.string().trim().max(200).optional().default(""),
  travel_notes: z.string().trim().max(2000).optional().default(""),
});

async function loadAssignment(admin: Admin, id: string) {
  const { data } = await admin.from("staff_assignments").select("*").eq("id", id).maybeSingle();
  return data;
}

async function cancelBookings(admin: Admin, requestId: string) {
  const { data: bs } = await admin.from("travel_bookings").update({ cancelled_at: new Date().toISOString() }).eq("request_id", requestId).is("cancelled_at", null).select("id, organization_id, broadcast_id");
  for (const b of bs ?? []) if (b.broadcast_id) {
    await admin.from("calendar_broadcasts").update({ attendee_emails: [] }).eq("id", b.broadcast_id);
    await queue(admin, b.organization_id as string, b.broadcast_id as string);
  }
}

/** The assignments a change applies to: just this one, or everyone on the same trip. */
async function targetsOf(admin: Admin, a: Record<string, unknown>, scope: string) {
  if (scope !== "trip" || !a.batch_id) return [a];
  const { data } = await admin.from("staff_assignments").select("*").eq("batch_id", a.batch_id as string).is("cancelled_at", null);
  return data?.length ? data : [a];
}

/**
 * Changes the dates, notes or travel of an assignment (or of everyone on the trip). The staff get
 * an updated Outlook invite; the coordinators, travellers and requester get one email.
 */
export async function updateAssignment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  const d = parsed.data;
  if (d.end_date < d.start_date) return { ok: false, error: "The last day is before the first day.", fieldErrors: { end_date: ["On or after the first day"] } };
  if (addDays(d.start_date, 366) < d.end_date) return { ok: false, error: "Up to a year at a time.", fieldErrors: { end_date: ["Up to a year"] } };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const a = await loadAssignment(admin, d.id);
  if (!a || a.cancelled_at) return { ok: false, error: "This assignment no longer exists." };
  if (!(await allowed(a.organization_id as string, "staffing.assign"))) return { ok: false, error: "You can't change assignments in this company." };
  const c = await context(admin, a.organization_id as string, a.project_id as string);
  if (!c) return { ok: false, error: "Couldn't load the assignment." };
  const scope = String(formData.get("scope") ?? "");
  const targets = await targetsOf(admin, a, scope);
  const people = new Map((await peopleOf(admin, targets.map((t) => t.membership_id as string))).map((p) => [p.membershipId, p]));
  const travel = d.needs_travel === "on";
  const name = await actorName(admin, user.id);
  const now = new Date().toISOString();
  const lines = { new: [] as TravelLine[], changed: [] as TravelLine[], cancelled: [] as TravelLine[] };

  for (const t of targets) {
    const p = people.get(t.membership_id as string);
    if (!p) continue;
    const datesChanged = d.start_date !== t.start_date || d.end_date !== t.end_date;
    const { error } = await admin.from("staff_assignments").update({
      start_date: d.start_date, end_date: d.end_date, notes: d.notes || null, needs_travel: travel, updated_by: user.id, updated_at: now,
      // Someone given their own dates leaves the trip, so a later "everyone on the trip" change skips them.
      ...(scope !== "trip" && datesChanged && t.batch_id ? { batch_id: randomUUID() } : {}),
    }).eq("id", t.id);
    if (error) return { ok: false, error: "Couldn't save. Try again." };
    await writeAssignmentInvite(admin, c, { id: t.id as string, start: d.start_date, end: d.end_date, notes: d.notes || null, travel, broadcastId: (t.broadcast_id as string) ?? null }, p, user.id);

    const { data: req } = await admin.from("travel_requests").select("id, status, travel_from, notes, requested_by").eq("assignment_id", t.id).maybeSingle();
    const line = (rid: string, extra: Partial<TravelLine> = {}): TravelLine => ({
      requestId: rid, name: p.name, jobTitle: p.jobTitle, email: p.email, start: d.start_date, end: d.end_date,
      from: d.travel_from || (req?.travel_from as string) || null, notes: d.travel_notes || (req?.notes as string) || null, requesterId: (req?.requested_by as string) ?? user.id, ...extra,
    });
    if (travel && (!req || req.status === "cancelled")) {
      const { data: r } = req
        ? await admin.from("travel_requests").update({ status: "requested", travel_from: d.travel_from || null, notes: d.travel_notes || null, requested_by: user.id, requested_at: now, updated_by: user.id, updated_at: now, dates_changed_from: null, dates_changed_at: null }).eq("id", req.id).select("id").single()
        : await admin.from("travel_requests").insert({ organization_id: a.organization_id, assignment_id: t.id, travel_from: d.travel_from || null, notes: d.travel_notes || null, requested_by: user.id, updated_by: user.id }).select("id").single();
      if (r) lines.new.push(line(r.id as string, { requesterId: user.id }));
    } else if (!travel && req && req.status !== "cancelled") {
      const bookings = await bookingLines(admin, req.id as string);
      await admin.from("travel_requests").update({ status: "cancelled", updated_by: user.id, updated_at: now }).eq("id", req.id);
      await cancelBookings(admin, req.id as string);
      lines.cancelled.push(line(req.id as string, { bookings, start: t.start_date as string, end: t.end_date as string }));
    } else if (travel && req) {
      const bookings = datesChanged ? await bookingLines(admin, req.id as string) : [];
      await admin.from("travel_requests").update({
        travel_from: d.travel_from || null, notes: d.travel_notes || null, updated_by: user.id, updated_at: now,
        ...(datesChanged ? { dates_changed_from: fmtRange(t.start_date as string, t.end_date as string), dates_changed_at: now, status: bookings.length ? "in_progress" : "requested" } : {}),
      }).eq("id", req.id);
      if (datesChanged) lines.changed.push(line(req.id as string, { previous: fmtRange(t.start_date as string, t.end_date as string), bookings }));
    }
    if (datesChanged && p.userId !== user.id) {
      await admin.from("notifications").insert({ organization_id: a.organization_id, user_id: p.userId, kind: "staffing", actor_id: user.id, title: `New dates on ${c.project.name}`.slice(0, 200), body: fmtRange(d.start_date, d.end_date), link: `/o/${c.org.slug}/staffing/${t.id}` });
    }
  }
  const sent: string[] = [];
  for (const k of ["new", "changed", "cancelled"] as const) {
    const m = await emailCoordinators(admin, c, k, lines[k], { id: user.id, name });
    if (m.sent) sent.push(k === "new" ? "travel requested" : k === "changed" ? "new dates sent to the travel team" : "travel cancelled");
  }
  syncCalendarsSoon();
  refresh();
  const who = targets.length === 1 ? `${people.get(targets[0].membership_id as string)?.name ?? "The"}'s Outlook invite is` : `All ${targets.length} Outlook invites are`;
  const mail = sent.length ? ` Emailed the travel team, travellers and requester: ${sent.join(", ")}.` : "";
  return { ok: true, message: `Saved. ${who} updated.${mail}` };
}

/** Takes someone (or everyone on the trip) off the project: invites cancelled, travel cancelled, everyone emailed. */
export async function cancelAssignment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Not found." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const a = await loadAssignment(admin, parsed.data.id);
  if (!a || a.cancelled_at) return { ok: false, error: "This assignment no longer exists." };
  if (!(await allowed(a.organization_id as string, "staffing.assign"))) return { ok: false, error: "You can't change assignments in this company." };
  const c = await context(admin, a.organization_id as string, a.project_id as string);
  const targets = await targetsOf(admin, a, String(formData.get("scope") ?? ""));
  const people = new Map((await peopleOf(admin, targets.map((t) => t.membership_id as string))).map((p) => [p.membershipId, p]));
  const now = new Date().toISOString();
  const lines: TravelLine[] = [];
  for (const t of targets) {
    const p = people.get(t.membership_id as string);
    await admin.from("staff_assignments").update({ cancelled_at: now, updated_by: user.id, updated_at: now }).eq("id", t.id);
    if (t.broadcast_id) {
      await admin.from("calendar_broadcasts").update({ attendee_emails: [] }).eq("id", t.broadcast_id);
      await queue(admin, t.organization_id as string, t.broadcast_id as string);
    }
    const { data: req } = await admin.from("travel_requests").select("id, status, travel_from, notes, requested_by").eq("assignment_id", t.id).maybeSingle();
    if (req && req.status !== "cancelled" && p) {
      const bookings = await bookingLines(admin, req.id as string);
      await admin.from("travel_requests").update({ status: "cancelled", updated_by: user.id, updated_at: now }).eq("id", req.id);
      await cancelBookings(admin, req.id as string);
      lines.push({ requestId: req.id as string, name: p.name, jobTitle: p.jobTitle, email: p.email, start: t.start_date as string, end: t.end_date as string, from: (req.travel_from as string) ?? null, notes: (req.notes as string) ?? null, bookings, requesterId: (req.requested_by as string) ?? null });
    }
    if (c && p && p.userId !== user.id) {
      await admin.from("notifications").insert({ organization_id: t.organization_id, user_id: p.userId, kind: "staffing", actor_id: user.id, title: `Taken off ${c.project.name}`.slice(0, 200), body: fmtRange(t.start_date as string, t.end_date as string), link: `/o/${c.org.slug}/staffing` });
    }
  }
  const m = c && lines.length ? await emailCoordinators(admin, c, "cancelled", lines, { id: user.id, name: await actorName(admin, user.id) }) : { sent: false };
  syncCalendarsSoon();
  refresh();
  return { ok: true, message: `Removed${targets.length > 1 ? ` all ${targets.length} people` : ""}. The Outlook invite${targets.length > 1 ? "s are" : " is"} cancelled${m.sent ? ", and the travel team, travellers and requester have been emailed" : ""}.` };
}

/**
 * Sends the travel request to the travel team again (the PA missed the email): one email to the
 * coordinators covering everyone on the trip whose travel is still open, plus a notification.
 * `id` is any assignment on the trip; `scope=trip` includes everyone on it.
 */
export async function resendTravelRequest(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Not found." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const a = await loadAssignment(admin, parsed.data.id);
  if (!a || a.cancelled_at) return { ok: false, error: "This assignment no longer exists." };
  const orgId = a.organization_id as string;
  if (!(await allowed(orgId, "staffing.assign")) && !(await allowed(orgId, "travel"))) return { ok: false, error: "You can't send travel requests in this company." };
  const c = await context(admin, orgId, a.project_id as string);
  if (!c) return { ok: false, error: "Couldn't load the assignment." };
  const targets = await targetsOf(admin, a, String(formData.get("scope") ?? ""));
  const people = new Map((await peopleOf(admin, targets.map((t) => t.membership_id as string))).map((p) => [p.membershipId, p]));
  const lines: TravelLine[] = [];
  for (const t of targets) {
    const p = people.get(t.membership_id as string);
    const { data: req } = await admin.from("travel_requests").select("id, status, travel_from, notes, requested_by").eq("assignment_id", t.id).maybeSingle();
    if (!p || !req || req.status === "cancelled" || req.status === "booked") continue;
    lines.push({
      requestId: req.id as string, name: p.name, jobTitle: p.jobTitle, email: p.email, start: t.start_date as string, end: t.end_date as string,
      from: (req.travel_from as string) ?? null, notes: (req.notes as string) ?? null, bookings: await bookingLines(admin, req.id as string), requesterId: (req.requested_by as string) ?? user.id,
    });
  }
  if (!lines.length) return { ok: false, error: "There's no open travel request to send. It may already be booked or cancelled." };
  const m = await emailCoordinators(admin, c, "reminder", lines, { id: user.id, name: await actorName(admin, user.id) });
  if (!m.sent) return { ok: false, error: "No travel coordinator is set for this company yet. Add one under Travel → Coordinators." };
  refresh();
  return { ok: true, message: `Reminder emailed to ${m.names.join(" and ")}.` };
}

// ---- Travel coordinators' side -------------------------------------------------------------

export async function updateTravelRequest(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    id: uuid,
    status: z.enum(["requested", "in_progress", "booked"]),
    coordinator_notes: z.string().trim().max(2000).optional().default(""),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the fields." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const { data: r } = await admin.from("travel_requests").select("id, organization_id, assignment_id, status, requested_by").eq("id", parsed.data.id).maybeSingle();
  if (!r || r.status === "cancelled") return { ok: false, error: "This request is cancelled." };
  if (!(await allowed(r.organization_id as string, "travel"))) return { ok: false, error: "You can't handle travel for this company." };
  await admin.from("travel_requests").update({
    status: parsed.data.status, coordinator_notes: parsed.data.coordinator_notes || null, updated_by: user.id, updated_at: new Date().toISOString(),
    ...(parsed.data.status === "booked" ? { dates_changed_from: null, dates_changed_at: null } : {}),
  }).eq("id", r.id);
  if (parsed.data.status === "booked" && r.status !== "booked") {
    const a = await loadAssignment(admin, r.assignment_id as string);
    const [p] = a ? await peopleOf(admin, [a.membership_id as string]) : [];
    const { data: o } = await admin.from("organizations").select("slug").eq("id", r.organization_id).single();
    if (a && p && p.userId !== user.id) {
      await admin.from("notifications").insert({ organization_id: r.organization_id, user_id: p.userId, kind: "travel", actor_id: user.id, title: "Your travel is booked", body: fmtRange(a.start_date as string, a.end_date as string), link: `/o/${o?.slug}/staffing/${a.id}` });
    }
    // One summary of the whole trip: to the traveller, copied to the coordinators and the requester.
    const c = a ? await context(admin, a.organization_id as string, a.project_id as string) : null;
    if (a && p && c) {
      const { to, cc } = await tripRecipients(admin, c.org.id, { travellers: [], userIds: [user.id, (r.requested_by as string) ?? null] });
      const traveller = p.email ? [p.email] : [];
      const all = traveller.length ? { to: traveller, cc: [...new Set([...to, ...cc])].filter((e) => !traveller.includes(e)) } : { to, cc };
      const bookings = await bookingLines(admin, r.id as string);
      if (all.to.length) {
        const title = `Travel booked: ${p.name} — ${c.project.name}, ${fmtRange(a.start_date as string, a.end_date as string)}`.slice(0, 200);
        const body = `<p>All travel and accommodation for <strong>${escapeHtml(p.name)}</strong> is booked.</p>${table(
          row("Project", c.project.name) + row("Company", c.org.name) + row("Dates on site", fmtRange(a.start_date as string, a.end_date as string)) +
          row("Bookings", bookings.join("\n") || "—") + row("Note from the travel team", parsed.data.coordinator_notes || null),
        )}<p>Each booking is in ${escapeHtml(p.name)}'s Outlook calendar with its confirmation.</p>`;
        const { data: b } = await admin.from("calendar_broadcasts").insert({
          organization_id: c.org.id, kind: "update", category: "travel", source: "travel_request", title, body,
          attendee_emails: all.to, cc_emails: all.cc, attendee_user_ids: [p.userId], created_by: user.id, audience: "Trip", link_path: `/o/${c.org.slug}/staffing/${a.id}`,
        }).select("id").single();
        if (b) await queue(admin, c.org.id, b.id as string);
        syncCalendarsSoon();
      }
    }
  }
  refresh();
  return { ok: true, message: parsed.data.status === "booked" && r.status !== "booked" ? "Saved. The traveller, the requester and the travel team have been emailed the full trip." : "Saved." };
}

const bookingSchema = z.object({
  request_id: uuid,
  booking_id: z.union([z.literal(""), uuid]).optional().default(""),
  kind: z.enum(Object.keys(BOOKING_KINDS) as [keyof typeof BOOKING_KINDS, ...(keyof typeof BOOKING_KINDS)[]]),
  title: z.string().trim().min(1, "Required").max(200),
  reference: z.string().trim().max(100).optional().default(""),
  from_place: z.string().trim().max(200).optional().default(""),
  to_place: z.string().trim().max(200).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  start_date: z.string().refine(isDateString, "Choose the date"),
  start_time: z.string().optional().default(""),
  start_tz: z.string().min(1),
  end_date: z.string().optional().default(""),
  end_time: z.string().optional().default(""),
  end_tz: z.string().optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

const hhmm = (v: string) => /^\d{2}:\d{2}$/.test(v);

/** Adds or changes a flight, hotel or transfer. It goes into the traveller's Outlook calendar. */
export async function saveBooking(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  const d = parsed.data;
  const endTz = d.end_tz || d.start_tz;
  if (!zoneOk(d.start_tz) || !zoneOk(endTz)) return { ok: false, error: "Choose the time zones.", fieldErrors: { start_tz: ["Choose a time zone"] } };
  const allDay = d.kind === "hotel";
  let startsAt: string;
  let endsAt: string;
  if (allDay) {
    if (!isDateString(d.end_date) || d.end_date <= d.start_date) return { ok: false, error: "Check-out must be after check-in.", fieldErrors: { end_date: ["After check-in"] } };
    startsAt = zonedToUtc(d.start_date, "00:00", d.start_tz);
    endsAt = zonedToUtc(addDays(d.end_date, 1), "00:00", d.start_tz); // the calendar shows the check-out day too
  } else {
    if (!hhmm(d.start_time)) return { ok: false, error: "Enter the departure time.", fieldErrors: { start_time: ["Required"] } };
    startsAt = zonedToUtc(d.start_date, d.start_time, d.start_tz);
    const endDate = isDateString(d.end_date) ? d.end_date : d.start_date;
    endsAt = hhmm(d.end_time) ? zonedToUtc(endDate, d.end_time, endTz) : new Date(Date.parse(startsAt) + 3600_000).toISOString();
    if (!(Date.parse(endsAt) > Date.parse(startsAt))) return { ok: false, error: "The arrival is before the departure. Check the dates, times and time zones.", fieldErrors: { end_time: ["After the departure"] } };
  }
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 3) return { ok: false, error: "Attach up to 3 files.", fieldErrors: { attachments: ["Up to 3 files"] } };
  const uploads: ValidatedUpload[] = [];
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${f.name} is bigger than 3 MB.`, fieldErrors: { attachments: ["3 MB per file"] } };
    try {
      uploads.push(await validateUpload(f, "any"));
    } catch (e) {
      return { ok: false, error: e instanceof UploadError ? `${f.name}: ${e.message}` : `${f.name} couldn't be read.`, fieldErrors: { attachments: ["Check the files"] } };
    }
  }
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const { data: r } = await admin.from("travel_requests").select("id, organization_id, assignment_id, status, requested_by").eq("id", d.request_id).maybeSingle();
  if (!r || r.status === "cancelled") return { ok: false, error: "This request is cancelled." };
  if (!(await allowed(r.organization_id as string, "travel"))) return { ok: false, error: "You can't handle travel for this company." };
  const a = await loadAssignment(admin, r.assignment_id as string);
  if (!a) return { ok: false, error: "Couldn't load the trip." };
  const c = await context(admin, a.organization_id as string, a.project_id as string);
  const [p] = await peopleOf(admin, [a.membership_id as string]);
  if (!c || !p) return { ok: false, error: "Couldn't load the trip." };

  const fields = {
    kind: d.kind, title: d.title, reference: d.reference || null, from_place: d.from_place || null, to_place: d.to_place || null, address: d.address || null,
    all_day: allDay, starts_at: startsAt, ends_at: endsAt, start_tz: d.start_tz, end_tz: allDay ? d.start_tz : endTz, notes: d.notes || null, updated_at: new Date().toISOString(),
  };
  let bookingId = d.booking_id;
  let existing: { broadcast_id: string | null } | null = null;
  if (bookingId) {
    const { data: b } = await admin.from("travel_bookings").select("id, request_id, broadcast_id, cancelled_at").eq("id", bookingId).maybeSingle();
    if (!b || b.request_id !== r.id || b.cancelled_at) return { ok: false, error: "That booking no longer exists." };
    existing = { broadcast_id: (b.broadcast_id as string) ?? null };
    await admin.from("travel_bookings").update(fields).eq("id", bookingId);
  } else {
    const { data: b, error } = await admin.from("travel_bookings").insert({ ...fields, organization_id: r.organization_id, request_id: r.id, created_by: user.id }).select("id").single();
    if (error || !b) {
      logServerError("travel.booking", error);
      return { ok: false, error: "Couldn't save the booking. Try again." };
    }
    bookingId = b.id as string;
  }

  // The traveller's calendar invite (with the confirmation attached).
  const stored: StoredAttachment[] = [];
  try {
    for (const u of uploads) {
      const path = `${r.organization_id}/travel/${bookingId}/${randomUUID()}.${u.ext}`;
      const { error: upErr } = await admin.storage.from("files").upload(path, u.bytes, { contentType: u.mime, upsert: false });
      if (upErr) throw upErr;
      stored.push({ path, name: u.fileName, mime: u.mime, size: u.size });
    }
  } catch (e) {
    logServerError("travel.attach", e);
    return { ok: false, error: "The booking is saved, but the files couldn't be uploaded. Try adding them again." };
  }
  const label = BOOKING_KINDS[d.kind];
  const route = d.from_place && d.to_place ? `${d.from_place} → ${d.to_place}` : d.to_place || d.from_place || "";
  const subject = `${label}: ${d.title}${route && d.kind !== "hotel" ? ` · ${route}` : ""}`.slice(0, 200);
  const body = `<p>${escapeHtml(label)} for your trip to <strong>${escapeHtml(c.project.name)}</strong> (${escapeHtml(c.org.name)}).</p>${table(
    row(d.kind === "hotel" ? "Hotel" : "Booking", d.title) + row("Reference", d.reference || null) + (d.kind === "hotel" ? "" : row("Route", route || null)) +
    row("Address", d.address || null) + (allDay ? row("Check-in", fmtRange(d.start_date, d.start_date)) + row("Check-out", fmtRange(d.end_date, d.end_date)) : "") + row("Notes", d.notes || null),
  )}`;
  const bFields = {
    title: subject, body, location: d.address || route || null, starts_at: startsAt, ends_at: endsAt, all_day: allDay, time_zone: d.start_tz,
    attendee_emails: p.email ? [p.email] : [], attendee_user_ids: [p.userId], link_path: `/o/${c.org.slug}/staffing/${a.id}`,
  };
  let broadcastId = existing?.broadcast_id ?? null;
  if (broadcastId) {
    const { data: prev } = await admin.from("calendar_broadcasts").select("attachments").eq("id", broadcastId).maybeSingle();
    const keep = ((prev?.attachments ?? []) as StoredAttachment[]);
    await admin.from("calendar_broadcasts").update({ ...bFields, attachments: [...keep, ...stored].slice(0, 6) }).eq("id", broadcastId);
  } else {
    const { data: b } = await admin.from("calendar_broadcasts").insert({
      ...bFields, organization_id: r.organization_id, kind: "invite", category: "travel", source: "travel_booking", audience: "Traveller", created_by: user.id, attachments: stored,
    }).select("id").single();
    broadcastId = (b?.id as string) ?? null;
    if (broadcastId) await admin.from("travel_bookings").update({ broadcast_id: broadcastId }).eq("id", bookingId);
  }
  if (broadcastId) await queue(admin, r.organization_id as string, broadcastId);
  if (r.status === "requested") await admin.from("travel_requests").update({ status: "in_progress", updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", r.id);
  if (p.userId !== user.id) {
    await admin.from("notifications").insert({ organization_id: r.organization_id, user_id: p.userId, kind: "travel", actor_id: user.id, title: subject, body: c.project.name, link: `/o/${c.org.slug}/staffing/${a.id}` });
  }
  await emailBooking(admin, c, d.booking_id ? "changed" : "added", describeBooking({ ...fields, start_tz: d.start_tz }), p.name, r.id as string, (r.requested_by as string) ?? null, { id: user.id, name: await actorName(admin, user.id) });
  syncCalendarsSoon();
  refresh();
  return { ok: true, message: `${label} ${d.booking_id ? "updated" : "added"}. It's going into ${p.name}'s Outlook calendar${stored.length ? " with the confirmation attached" : ""}.` };
}

export async function cancelBooking(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Not found." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  const { data: b } = await admin.from("travel_bookings").select("*").eq("id", parsed.data.id).maybeSingle();
  if (!b || b.cancelled_at) return { ok: false, error: "That booking no longer exists." };
  if (!(await allowed(b.organization_id as string, "travel"))) return { ok: false, error: "You can't handle travel for this company." };
  await admin.from("travel_bookings").update({ cancelled_at: new Date().toISOString() }).eq("id", b.id);
  if (b.broadcast_id) {
    await admin.from("calendar_broadcasts").update({ attendee_emails: [] }).eq("id", b.broadcast_id);
    await queue(admin, b.organization_id as string, b.broadcast_id as string);
  }
  // Tell the coordinators and the requester (the traveller gets the Outlook cancellation).
  const { data: r } = await admin.from("travel_requests").select("id, assignment_id, requested_by").eq("id", b.request_id).maybeSingle();
  const a = r ? await loadAssignment(admin, r.assignment_id as string) : null;
  const c = a ? await context(admin, a.organization_id as string, a.project_id as string) : null;
  const [p] = a ? await peopleOf(admin, [a.membership_id as string]) : [];
  if (r && c && p) await emailBooking(admin, c, "cancelled", describeBooking(b as Parameters<typeof describeBooking>[0]), p.name, r.id as string, (r.requested_by as string) ?? null, { id: user.id, name: await actorName(admin, user.id) });
  syncCalendarsSoon();
  refresh();
  return { ok: true, message: "Removed. It's taken out of the traveller's calendar." };
}

/** Who handles travel for a company: leads get the request email, the others are copied. */
export async function saveCoordinators(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Not found." };
  const org = parsed.data.organization_id;
  if (!(await allowed(org, "settings"))) return { ok: false, error: "You can't change who handles travel." };
  const pick = (k: string) => [...new Set(formData.getAll(k).map(String).filter((x) => uuid.safeParse(x).success))];
  const leads = pick("lead");
  const copied = pick("cc").filter((x) => !leads.includes(x));
  const admin = createAdminClient();
  const valid = (await peopleOf(admin, [...leads, ...copied])).filter((p) => p.orgId === org && p.active).map((p) => p.membershipId);
  const rows = [...leads.map((m) => ({ organization_id: org, membership_id: m, is_lead: true })), ...copied.map((m) => ({ organization_id: org, membership_id: m, is_lead: false }))].filter((r) => valid.includes(r.membership_id));
  const { error: delErr } = await admin.from("travel_coordinators").delete().eq("organization_id", org);
  if (delErr) return { ok: false, error: "Couldn't save. Try again." };
  if (rows.length) {
    const { error } = await admin.from("travel_coordinators").insert(rows);
    if (error) return { ok: false, error: "Couldn't save. Try again." };
  }
  refresh();
  return { ok: true, message: rows.length ? "Saved. New travel requests go to these people." : "Saved. Nobody is set, so requests wait on this page." };
}
