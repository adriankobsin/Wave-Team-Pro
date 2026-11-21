import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyOrganizations } from "@/lib/auth/session";
import { projectZones } from "@/server/services/project-zones";
import { addDays, minutesByDayProject, projectSessionsFrom, todayIn, weekStart, type ProjectPunch } from "@/lib/time";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Brings the caller's own timesheet for one company and week in line with their clock-ins:
 * one row per day and project, marked "from clock". Rows people typed themselves are never
 * touched, and nothing changes once the week is submitted or approved.
 */
export async function syncTimesheetFromClock(supabase: SupabaseClient, org: { id: string; timezone: string }, membershipId: string, week: string) {
  const { data: sheetId, error } = await supabase.rpc("ensure_timesheet", { p_org: org.id, p_week: week });
  if (error || !sheetId) return { ok: false as const };
  const { data: sheet } = await supabase.from("timesheets").select("status").eq("id", sheetId).single();
  if (sheet?.status !== "draft" && sheet?.status !== "rejected") return { ok: true as const, locked: true };

  const [{ data: punches }, { data: existing }] = await Promise.all([
    supabase.from("attendance_events").select("kind, occurred_at, project_id").eq("membership_id", membershipId)
      .gte("occurred_at", new Date(Date.parse(`${addDays(week, -1)}T00:00:00Z`)).toISOString())
      .lt("occurred_at", new Date(Date.parse(`${addDays(week, 8)}T00:00:00Z`)).toISOString()),
    supabase.from("timesheet_entries").select("id, work_date, project_id, hours").eq("timesheet_id", sheetId).eq("from_clock", true),
  ]);
  const sessions = projectSessionsFrom((punches ?? []) as ProjectPunch[]).filter((s) => s.end !== null);
  // Each session's day is the day in its project's own time zone.
  const zones = await projectZones(supabase, sessions.map((s) => s.projectId));
  const want = new Map<string, number>();
  for (const [k, min] of minutesByDayProject(sessions, org.timezone, zones)) {
    const day = k.split("|")[0];
    if (day >= week && day <= addDays(week, 6) && min >= 1) want.set(k, r2(min / 60));
  }
  // Clock rows are written by the server only (people can't type or edit them).
  const writer = createAdminClient();
  let changed = 0;
  const have = new Map((existing ?? []).map((e) => [`${e.work_date}|${e.project_id ?? ""}`, e]));
  for (const [k, hours] of want) {
    const e = have.get(k);
    const [day, project] = k.split("|");
    if (!e) {
      const { error: insErr } = await writer.from("timesheet_entries").insert({
        organization_id: org.id, timesheet_id: sheetId, work_date: day, project_id: project || null,
        hours, category: "work", from_clock: true, description: "From clock-ins",
      });
      if (!insErr) changed++;
    } else if (Number(e.hours) !== hours) {
      await writer.from("timesheet_entries").update({ hours }).eq("id", e.id).eq("timesheet_id", sheetId);
      changed++;
    }
  }
  for (const [k, e] of have) {
    if (!want.has(k)) {
      await writer.from("timesheet_entries").delete().eq("id", e.id).eq("timesheet_id", sheetId).eq("from_clock", true);
      changed++;
    }
  }
  return { ok: true as const, changed };
}

/** After a clock action: refresh this week's timesheet in every company the person works for. */
export async function syncAllMyTimesheets() {
  const supabase = await createClient();
  const orgs = (await getMyOrganizations()).filter((o) => o.membership_status === "active" && o.organization_status === "active");
  const { data: tzs } = await supabase.from("organizations").select("id, timezone").in("id", orgs.map((o) => o.organization_id));
  const tz = new Map((tzs ?? []).map((o) => [o.id, o.timezone as string]));
  for (const o of orgs) {
    const zone = tz.get(o.organization_id) ?? "UTC";
    const { data: can } = await supabase.rpc("has_permission", { p_org: o.organization_id, p_permission: "timesheets.submit" });
    if (can !== true) continue;
    await syncTimesheetFromClock(supabase, { id: o.organization_id, timezone: zone }, o.membership_id, weekStart(todayIn(zone)));
  }
}
