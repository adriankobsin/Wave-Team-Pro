import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphConfigured, GraphError } from "@/lib/sharepoint/graph";
import { cancelEvent, createEvent, sendMail, updateEvent, type Attachment, type EventSpec } from "@/lib/outlook/graph";
import { escapeHtml } from "@/lib/email";
import { serverEnv } from "@/lib/env";
import { addDays, todayIn } from "@/lib/time";
import { logServerError } from "@/lib/errors";
import { BRAND } from "@/lib/brand";

export const AUTO_KINDS = {
  task: "Task due dates",
  shift: "Shifts",
  project: "Project assignments",
  leave: "Approved leave",
} as const;
export type AutoKind = keyof typeof AUTO_KINDS;

export type OutlookSettings = { mailbox: string | null; auto_kinds: string[] };

type Admin = ReturnType<typeof createAdminClient>;
type SyncRow = { id: string; organization_id: string; kind: "task" | "shift" | "project" | "leave" | "manual"; ref_id: string; graph_event_id: string | null; attempts: number };
// A built item: a calendar event, an email, or nothing (cancel whatever was sent).
type Built = { event: EventSpec; attachments?: Attachment[] } | { mail: { subject: string; html: string; bcc: string[]; to?: string[]; cc?: string[]; attachments?: Attachment[] } } | null;

export type StoredAttachment = { path: string; name: string; mime: string; size: number };

export async function getOutlookSettings(admin: Admin = createAdminClient()): Promise<OutlookSettings> {
  const { data } = await admin.from("outlook_settings").select("mailbox, auto_kinds").eq("id", true).maybeSingle();
  return { mailbox: (data?.mailbox as string) ?? null, auto_kinds: (data?.auto_kinds as string[]) ?? Object.keys(AUTO_KINDS) };
}

export const outlookReady = (s: OutlookSettings) => graphConfigured() && Boolean(s.mailbox);

const link = (path: string) => `${serverEnv().APP_BASE_URL.replace(/\/$/, "")}${path}`;
const para = (s: string | null | undefined) => (s ? `<p>${escapeHtml(s).replace(/\n/g, "<br>")}</p>` : "");
const footer = (path: string, label: string) => `<p><a href="${escapeHtml(link(path))}">${escapeHtml(label)}</a></p><p style="color:#556770;font-size:12px">Sent by ${escapeHtml(BRAND.product)}.</p>`;
const utc = (iso: string) => new Date(iso).toISOString().slice(0, 19);
const allDay = (from: string, toInclusive: string, tz: string) => ({ allDay: true, start: `${from}T00:00:00`, end: `${addDays(toInclusive, 1)}T00:00:00`, timeZone: tz });

async function emailsOf(admin: Admin, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  if (!ids.length) return [];
  const { data } = await admin.from("profiles").select("email_display, status").in("id", ids);
  return [...new Set((data ?? []).filter((p) => p.status === "active" && p.email_display).map((p) => String(p.email_display).toLowerCase()))];
}

async function userOfMembership(admin: Admin, ids: (string | null | undefined)[]) {
  const list = ids.filter((x): x is string => Boolean(x));
  if (!list.length) return [];
  const { data } = await admin.from("organization_memberships").select("user_id").in("id", list).eq("status", "active");
  return (data ?? []).map((m) => m.user_id as string);
}

async function org(admin: Admin, id: string) {
  const { data } = await admin.from("organizations").select("name, slug, timezone").eq("id", id).single();
  return { name: data?.name as string, slug: data?.slug as string, tz: (data?.timezone as string) || "UTC" };
}

async function buildTask(admin: Admin, id: string): Promise<Built> {
  const { data: t } = await admin.from("tasks").select("id, organization_id, title, description, due_date, archived_at, project_id").eq("id", id).maybeSingle();
  if (!t || !t.due_date || t.archived_at) return null;
  const [{ data: assignees }, o, { data: project }] = await Promise.all([
    admin.from("task_assignees").select("user_id").eq("task_id", id),
    org(admin, t.organization_id),
    t.project_id ? admin.from("projects").select("name, site_label").eq("id", t.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const attendees = await emailsOf(admin, (assignees ?? []).map((a) => a.user_id as string));
  if (!attendees.length) return null;
  return {
    event: {
      subject: `Task due: ${t.title}`,
      html: `${project ? `<p><strong>Project:</strong> ${escapeHtml(project.name as string)}</p>` : ""}<p><strong>Company:</strong> ${escapeHtml(o.name)}</p>${para(t.description as string)}${footer(`/o/${o.slug}/tasks/${t.id}`, "Open the task — add notes, photos and report back")}`,
      location: (project?.site_label as string) ?? null,
      attendees, showAs: "free", category: `${BRAND.product} tasks`,
      ...allDay(t.due_date as string, t.due_date as string, o.tz),
    },
  };
}

async function buildShift(admin: Admin, id: string): Promise<Built> {
  const { data: s } = await admin.from("shifts").select("id, organization_id, membership_id, starts_at, ends_at, location, notes, project_id").eq("id", id).maybeSingle();
  if (!s) return null;
  const [o, users, { data: project }] = await Promise.all([
    org(admin, s.organization_id),
    userOfMembership(admin, [s.membership_id as string]),
    s.project_id ? admin.from("projects").select("name, site_label").eq("id", s.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const attendees = await emailsOf(admin, users);
  if (!attendees.length) return null;
  return {
    event: {
      subject: `Shift — ${o.name}${project ? ` · ${project.name}` : ""}`,
      html: `${para(s.notes as string)}${footer(`/o/${o.slug}/schedule`, "Open the schedule")}`,
      location: (s.location as string) ?? (project?.site_label as string) ?? null,
      attendees, allDay: false, start: utc(s.starts_at as string), end: utc(s.ends_at as string), timeZone: "UTC", category: `${BRAND.product} shifts`,
    },
  };
}

async function buildProject(admin: Admin, id: string): Promise<Built> {
  const { data: p } = await admin.from("projects").select("id, organization_id, name, description, site_label, country, start_date, end_date, status, manager_membership_id").eq("id", id).maybeSingle();
  if (!p || !p.start_date || p.status === "cancelled") return null;
  const [o, { data: members }] = await Promise.all([org(admin, p.organization_id), admin.from("project_members").select("membership_id").eq("project_id", id)]);
  const attendees = await emailsOf(admin, await userOfMembership(admin, [p.manager_membership_id as string, ...(members ?? []).map((m) => m.membership_id as string)]));
  if (!attendees.length) return null;
  const end = (p.end_date as string) && (p.end_date as string) >= (p.start_date as string) ? (p.end_date as string) : (p.start_date as string);
  return {
    event: {
      subject: `Project: ${p.name}`,
      html: `<p><strong>Company:</strong> ${escapeHtml(o.name)}</p>${p.site_label ? `<p><strong>Site:</strong> ${escapeHtml(p.site_label as string)}</p>` : ""}${para(p.description as string)}${footer(`/o/${o.slug}/projects/${p.id}`, "Open the project")}`,
      location: [p.site_label, p.country].filter(Boolean).join(", ") || null,
      attendees, showAs: "free", category: `${BRAND.product} projects`,
      ...allDay(p.start_date as string, end, o.tz),
    },
  };
}

async function buildLeave(admin: Admin, id: string): Promise<Built> {
  const { data: l } = await admin.from("leave_requests").select("id, organization_id, membership_id, start_date, end_date, status, leave_types(name)").eq("id", id).maybeSingle();
  if (!l || l.status !== "approved") return null;
  const { data: m } = await admin.from("organization_memberships").select("user_id, manager_membership_id").eq("id", l.membership_id).maybeSingle();
  const [o, managers, { data: who }] = await Promise.all([
    org(admin, l.organization_id),
    userOfMembership(admin, [m?.manager_membership_id as string]),
    admin.from("profiles").select("display_name").eq("id", m?.user_id ?? "").maybeSingle(),
  ]);
  const attendees = await emailsOf(admin, [m?.user_id as string, ...managers]);
  if (!attendees.length) return null;
  const type = ((l as unknown as { leave_types: { name: string } | null }).leave_types?.name) ?? "Leave";
  return {
    event: {
      subject: `${who?.display_name ?? "Leave"} — ${type}`,
      html: `<p>${escapeHtml(type)} approved in ${escapeHtml(o.name)}.</p>${footer(`/o/${o.slug}/leave`, "Open leave")}`,
      attendees, showAs: "oof", category: `${BRAND.product} leave`,
      ...allDay(l.start_date as string, l.end_date as string, o.tz),
    },
  };
}

/** Rows written by the staff calendar and travel pages (their body is already HTML). */
const SOURCE = {
  staffing: { category: `${BRAND.product} staffing`, link: "Open the assignment" },
  travel_request: { category: `${BRAND.product} travel`, link: "Open the travel request — enter the bookings there" },
  travel_booking: { category: `${BRAND.product} travel`, link: "Open your trip" },
} as const;

const CATEGORY = { travel: "Travel", company: "Company update", project: "Project update", meeting: "Meeting", other: "Update" } as const;

async function buildManual(admin: Admin, id: string): Promise<Built> {
  const { data: b } = await admin.from("calendar_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!b || !(b.attendee_emails as string[]).length) return null;
  const o = await org(admin, b.organization_id);
  const label = CATEGORY[b.category as keyof typeof CATEGORY] ?? "Update";
  const stored = ((b.attachments ?? []) as StoredAttachment[]);
  const attachments: Attachment[] = [];
  for (const a of stored) {
    const { data, error } = await admin.storage.from("files").download(a.path);
    if (error || !data) throw new GraphError(`Couldn't read the attachment ${a.name}.`, 0, "attachment", true);
    attachments.push({ name: a.name, contentType: a.mime, bytes: Buffer.from(await data.arrayBuffer()) });
  }
  const signature = b.signature ? `<p style="margin-top:24px;color:#33454f">${escapeHtml(b.signature as string).replace(/\n/g, "<br>")}</p>` : "";
  const files = stored.length ? `<p><strong>Attachments:</strong> ${stored.map((a) => escapeHtml(a.name)).join(", ")}</p>` : "";
  const source = (b.source as keyof typeof SOURCE | null) ?? null;
  const path = (b.link_path as string | null) ?? `/o/${o.slug}/invites/${b.id}`;
  const linkLabel = source ? SOURCE[source].link : stored.length ? `Open in ${BRAND.product} (attachments are there too)` : `Open in ${BRAND.product}`;
  const html = `${source ? (b.body as string) ?? "" : para(b.body as string)}${!source && b.location ? `<p><strong>Where:</strong> ${escapeHtml(b.location as string)}</p>` : ""}${source ? "" : files}${signature}${footer(path, linkLabel)}`;
  if (b.kind === "update") {
    // Travel requests go openly to the coordinators (leads in To, the rest copied).
    if (source) return { mail: { subject: b.title as string, html, bcc: [], to: b.attendee_emails as string[], cc: (b.cc_emails as string[]) ?? [], attachments } };
    return { mail: { subject: `${label}: ${b.title}`, html, bcc: b.attendee_emails as string[], attachments } };
  }
  if (source) {
    const tz0 = (b.time_zone as string) || "UTC";
    return {
      event: {
        subject: b.title as string, html, location: (b.location as string) ?? null, attendees: b.attendee_emails as string[], category: SOURCE[source].category,
        showAs: source === "staffing" ? "free" : "busy",
        ...(b.all_day
          ? allDay(todayIn(tz0, new Date(b.starts_at as string)), todayIn(tz0, new Date(new Date(b.ends_at as string).getTime() - 1)), tz0)
          : { allDay: false, start: utc(b.starts_at as string), end: utc(b.ends_at as string), timeZone: "UTC" }),
      },
      attachments,
    };
  }
  const tz = (b.time_zone as string) || "UTC";
  return {
    event: {
      subject: b.category === "meeting" || b.category === "other" ? (b.title as string) : `${label}: ${b.title}`,
      html, location: (b.location as string) ?? null, attendees: b.attendee_emails as string[], category: `${BRAND.product} ${label.toLowerCase()}`,
      ...(b.all_day
        ? allDay(todayIn(tz, new Date(b.starts_at as string)), todayIn(tz, new Date(new Date(b.ends_at as string).getTime() - 1)), tz)
        : { allDay: false, start: utc(b.starts_at as string), end: utc(b.ends_at as string), timeZone: "UTC" }),
    },
    attachments,
  };
}

const BUILDERS = { task: buildTask, shift: buildShift, project: buildProject, leave: buildLeave, manual: buildManual } as const;

async function syncOne(admin: Admin, mailbox: string, row: SyncRow, enabled: boolean) {
  const built = enabled ? await BUILDERS[row.kind](admin, row.ref_id) : null;
  if (!built || !("event" in built)) {
    if (row.graph_event_id) await cancelEvent(mailbox, row.graph_event_id, `This has been cancelled or changed in ${BRAND.product}.`);
    if (built && "mail" in built) await sendMail(mailbox, built.mail);
    return { status: built ? "synced" : enabled ? "synced" : "skipped", graph_event_id: null };
  }
  if (row.graph_event_id && (await updateEvent(mailbox, row.graph_event_id, built.event))) return { status: "synced", graph_event_id: row.graph_event_id };
  return { status: "synced", graph_event_id: await createEvent(mailbox, built.event, built.attachments ?? []) };
}

/**
 * Sends everything waiting in the queue to Outlook: new invites, updates (Outlook emails the
 * changes) and cancellations. Failures retry with back-off (2, 4, 8… minutes, six tries).
 */
export async function runOutlookSync(limit = 40) {
  const admin = createAdminClient();
  const settings = await getOutlookSettings(admin);
  if (!outlookReady(settings)) return { sent: 0, failed: 0, waiting: true };
  const { data } = await admin.from("calendar_sync").select("id, organization_id, kind, ref_id, graph_event_id, attempts")
    .in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).lt("attempts", 6)
    .order("next_attempt_at").limit(limit);
  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as SyncRow[]) {
    // Claim it so a parallel run doesn't send it twice.
    const { data: claimed } = await admin.from("calendar_sync").update({ next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString() })
      .eq("id", row.id).lte("next_attempt_at", new Date().toISOString()).select("id");
    if (!claimed?.length) continue;
    try {
      const enabled = row.kind === "manual" || settings.auto_kinds.includes(row.kind);
      const r = await syncOne(admin, settings.mailbox!, row, enabled);
      await admin.from("calendar_sync").update({ ...r, attempts: 0, last_error: null, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } catch (e) {
      failed++;
      const attempts = row.attempts + 1;
      const retry = !(e instanceof GraphError) || e.retryable || attempts < 3;
      await admin.from("calendar_sync").update({
        status: "failed", attempts: retry ? attempts : 6, last_error: e instanceof Error ? e.message.slice(0, 500) : "Unknown error",
        next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      logServerError("outlook.sync", e);
    }
  }
  return { sent, failed, waiting: false };
}

/** Runs the sync after the response is sent (changes reach Outlook within seconds). */
export function syncCalendarsSoon() {
  after(async () => {
    try {
      await runOutlookSync();
    } catch (e) {
      logServerError("outlook.sync", e);
    }
  });
}

let lastRetryCheck = 0;
/**
 * Invites and emails that failed are retried with a back-off; with no frequent cron, whoever opens
 * the app next picks up the ones that are due (at most once a minute per server).
 */
export function retryDueSyncSoon() {
  if (Date.now() - lastRetryCheck < 60_000) return;
  lastRetryCheck = Date.now();
  after(async () => {
    try {
      const admin = createAdminClient();
      const { count } = await admin.from("calendar_sync").select("id", { count: "exact", head: true })
        .in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).lt("attempts", 6);
      if (count) await runOutlookSync();
    } catch (e) {
      logServerError("outlook.retry", e);
    }
  });
}
