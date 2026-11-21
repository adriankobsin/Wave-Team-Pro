"use server";

import { projectZones } from "@/server/services/project-zones";

import { syncCalendarsSoon } from "@/server/services/outlook";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { emailManagement } from "@/server/services/management-email";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { isDateString, zonedToUtc } from "@/lib/time";
import { logServerError, friendlyDbError, type ActionResult } from "@/lib/errors";
import { fileInBackground } from "@/server/services/sharepoint";
import { syncAllMyTimesheets } from "@/server/services/timesheet-sync";

const date = z.string().refine(isDateString, "Choose a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const optUuid = z.union([z.literal(""), uuid]).optional().transform((v) => v || null);
const bool = z.literal("on").optional().transform((v) => v === "on");

function refresh() {
  syncCalendarsSoon(); // shifts and leave become Outlook invites
  revalidatePath("/o/[org]", "layout");
}

// ---------------------------------------------------------------- attendance

export async function clockAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid,
    kind: z.enum(["clock_in", "clock_out", "break_start", "break_end", "switch"]),
    project_id: z.union([uuid, z.literal("")]).optional(),
    // "orgId|projectId" from the all-companies picker; overrides organization_id / project_id.
    target: z.string().regex(/^[0-9a-f-]{36}\|([0-9a-f-]{36})?$/).optional().or(z.literal("")),
    note: z.string().max(300).optional(),
    require_target: z.literal("1").optional(),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (parsed.data.require_target && !parsed.data.target) return { ok: false, error: "Choose the company and project first." };
  const supabase = await createClient();
  if (parsed.data.target) {
    const [org, proj] = parsed.data.target.split("|");
    // Switching to another company's project = clocking in there (which clocks you out here).
    if (parsed.data.kind === "switch" && org !== parsed.data.organization_id) parsed.data.kind = "clock_in";
    parsed.data.organization_id = org;
    parsed.data.project_id = proj ?? "";
  }
  const project = parsed.data.project_id || null;
  if (parsed.data.kind === "switch" && !project) return { ok: false, error: "Choose the project you're switching to." };
  const { error } = await supabase.rpc("clock_on", { p_org: parsed.data.organization_id, p_kind: parsed.data.kind, p_project: project, p_note: parsed.data.note ?? null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  // Clocked time flows into this week's timesheets (every company: clocking in here may have clocked you out elsewhere).
  after(async () => {
    try {
      await syncAllMyTimesheets();
    } catch (e) {
      logServerError("timesheet.sync", e);
    }
  });
  refresh();
  const label = { clock_in: "Clocked in", clock_out: "Clocked out", break_start: "Break started", break_end: "Back from break", switch: "Switched project" }[parsed.data.kind];
  if (parsed.data.kind === "clock_in" || parsed.data.kind === "clock_out") {
    const { data: u } = await supabase.auth.getUser();
    const name = (u.user?.user_metadata?.display_name as string | undefined) ?? u.user?.email ?? "An employee";
    const orgId = parsed.data.organization_id;
    after(async () => {
      const { data: org } = await supabase.from("organizations").select("slug, timezone").eq("id", orgId).single();
      // The time is local time where the project is (Bangkok for a Thailand project…).
      const { data: lastIn } = await supabase.from("attendance_events").select("project_id").eq("organization_id", orgId).eq("kind", "clock_in").order("occurred_at", { ascending: false }).limit(1).maybeSingle();
      const zone = lastIn?.project_id ? (await projectZones(supabase, [lastIn.project_id])).get(lastIn.project_id as string) : undefined;
      const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone ?? org?.timezone ?? "UTC" }).format(new Date());
      await emailManagement(orgId, "clock", `${name} ${parsed.data.kind === "clock_in" ? "clocked in" : "clocked out"} at ${time}`, "Attendance update.", `/o/${org?.slug ?? ""}/attendance`, u.user?.id);
    });
  }
  return { ok: true, message: `${label}.` };
}

export async function requestCorrection(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, membership_id: uuid, timezone: z.string(),
    kind: z.enum(["clock_in", "clock_out", "break_start", "break_end"]), date, time: hhmm,
    reason: z.string().trim().min(3, "Explain what happened").max(500),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const at = zonedToUtc(parsed.data.date, parsed.data.time, parsed.data.timezone);
  if (Date.parse(at) > Date.now() + 60_000) return { ok: false, error: "Corrections can't be in the future.", fieldErrors: { time: ["Choose a past time"] } };
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_corrections").insert({
    organization_id: parsed.data.organization_id, membership_id: parsed.data.membership_id,
    kind: parsed.data.kind, occurred_at: at, reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Correction sent for approval." };
}

const review = z.object({ id: uuid, decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() });

export async function reviewCorrection(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = review.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_attendance_correction", { p_id: parsed.data.id, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: parsed.data.decision === "approve" ? "Approved." : "Rejected." };
}

// ---------------------------------------------------------------- schedule

export async function createShift(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, timezone: z.string(), membership_id: uuid, date, start: hhmm, end: hhmm,
    break_minutes: z.coerce.number().int().min(0).max(600).default(0),
    location: z.string().trim().max(160).optional(), notes: z.string().trim().max(1000).optional(), project_id: optUuid,
    repeat_days: z.coerce.number().int().min(1).max(7).default(1),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const rows = [];
  for (let i = 0; i < d.repeat_days; i++) {
    const day = new Date(`${d.date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + i);
    const ds = day.toISOString().slice(0, 10);
    const startsAt = zonedToUtc(ds, d.start, d.timezone);
    const endDay = d.end <= d.start ? new Date(day.getTime() + 86400000).toISOString().slice(0, 10) : ds; // overnight
    const endsAt = zonedToUtc(endDay, d.end, d.timezone);
    rows.push({
      organization_id: d.organization_id, membership_id: d.membership_id, starts_at: startsAt, ends_at: endsAt,
      break_minutes: d.break_minutes, location: d.location || null, notes: d.notes || null, project_id: d.project_id, created_by: auth.user?.id,
    });
  }
  const { error } = await supabase.from("shifts").insert(rows);
  if (error) return { ok: false, error: friendlyDbError(error, "You can't schedule this person.") };
  refresh();
  return { ok: true, message: rows.length > 1 ? `${rows.length} shifts added.` : "Shift added." };
}

export async function deleteShift(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown shift." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("shifts").delete().eq("id", parsed.data.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't remove this shift.") };
  refresh();
  return { ok: true, message: "Shift removed." };
}

// ---------------------------------------------------------------- timesheets

export async function addTimesheetEntry(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, timesheet_id: uuid, work_date: date,
    hours: z.coerce.number().min(0.25, "At least 15 minutes").max(24),
    project_id: optUuid, task_id: optUuid,
    category: z.enum(["work", "travel", "training", "admin", "standby"]).default("work"),
    description: z.string().trim().max(500).optional(), is_overtime: bool,
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("timesheet_entries").insert({ ...parsed.data, hours: Math.round(parsed.data.hours * 4) / 4, description: parsed.data.description || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Time added." };
}

export async function deleteTimesheetEntry(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown entry." };
  const supabase = await createClient();
  const { error } = await supabase.from("timesheet_entries").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function submitTimesheet(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown timesheet." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_timesheet", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  after(async () => {
    const { data: t } = await supabase.from("timesheets").select("organization_id, week_start").eq("id", parsed.data.id).single();
    const { data: u } = await supabase.auth.getUser();
    if (!t) return;
    const { data: org } = await supabase.from("organizations").select("slug").eq("id", t.organization_id).single();
    await emailManagement(t.organization_id, "timesheet_submitted", `${(u.user?.user_metadata?.display_name as string | undefined) ?? "An employee"} submitted a timesheet`, `Week of ${t.week_start}.`, `/o/${org?.slug ?? ""}/approvals`, u.user?.id);
  });
  return { ok: true, message: "Submitted for approval." };
}

export async function reviewTimesheet(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = review.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_timesheet", { p_id: parsed.data.id, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (parsed.data.decision === "approve") fileInBackground();
  refresh();
  return { ok: true, message: parsed.data.decision === "approve" ? "Timesheet approved." : "Returned for changes." };
}

// ---------------------------------------------------------------- leave

export async function requestLeave(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, leave_type_id: uuid, start_date: date, end_date: date,
    start_half: bool, end_half: bool, reason: z.string().trim().max(1000).optional(),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (parsed.data.end_date < parsed.data.start_date) return { ok: false, error: "The end date is before the start date.", fieldErrors: { end_date: ["Must be on or after the start"] } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_leave", {
    p_org: parsed.data.organization_id, p_type: parsed.data.leave_type_id, p_start: parsed.data.start_date, p_end: parsed.data.end_date,
    p_start_half: parsed.data.start_half, p_end_half: parsed.data.end_half, p_reason: parsed.data.reason || null,
  });
  if (error) return { ok: false, error: error.code === "23P01" ? "You already have leave booked or pending on some of those days." : friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Leave requested. Your manager has been notified." };
}

export async function cancelLeave(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_leave", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Request cancelled." };
}

export async function reviewLeave(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = review.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_leave", { p_id: parsed.data.id, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: parsed.data.decision === "approve" ? "Leave approved." : "Leave declined." };
}

export async function saveLeaveType(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, id: optUuid, name: z.string().trim().min(2).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2f7d5b"),
    annual_days: z.union([z.literal(""), z.coerce.number().min(0).max(365)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
    paid: bool, requires_note: bool, active: bool,
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, organization_id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("leave_types").update(rest).eq("id", id)
    : await supabase.from("leave_types").insert({ organization_id, ...rest, active: true });
  if (error) return { ok: false, error: error.code === "23505" ? "A leave type with that name exists." : friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Leave type saved." };
}

export async function addHoliday(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, holiday_date: date, name: z.string().trim().min(2).max(80) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Enter a date and name.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").insert(parsed.data);
  if (error) return { ok: false, error: error.code === "23505" ? "There's already a holiday on that date." : friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Holiday added." };
}

export async function deleteHoliday(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown holiday." };
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function adjustLeaveBalance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, membership_id: uuid, leave_type_id: uuid, year: z.coerce.number().int().min(2000).max(2100),
    days: z.coerce.number().min(-365).max(365).refine((n) => n !== 0, "Enter a non-zero number"), reason: z.string().trim().min(3).max(300),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("leave_balance_adjustments").insert({ ...parsed.data, created_by: auth.user?.id });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't adjust this person's balance.") };
  refresh();
  return { ok: true, message: "Balance adjusted." };
}
