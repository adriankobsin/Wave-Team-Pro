"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import { isDateString, zonedToUtc, addDays } from "@/lib/time";
import { logServerError, type ActionResult } from "@/lib/errors";
import { getMyProfile, getSessionUser } from "@/lib/auth/session";
import { getHub } from "@/server/services/hub";
import { AUTO_KINDS, getOutlookSettings, outlookReady, runOutlookSync, syncCalendarsSoon } from "@/server/services/outlook";
import { createEvent, MAX_ATTACHMENT_BYTES } from "@/lib/outlook/graph";
import { randomUUID } from "node:crypto";
import { UploadError, validateUpload, type ValidatedUpload } from "@/lib/files/validate";
import type { StoredAttachment } from "@/server/services/outlook";
import { GraphError } from "@/lib/sharepoint/graph";
import { BRAND } from "@/lib/brand";

const refresh = () => {
  revalidatePath("/hub", "layout");
  revalidatePath("/o/[org]", "layout");
};

/** Outlook settings are group-wide: super admins (or platform admins) only. */
async function outlookAdmin() {
  const hub = await getHub();
  return hub && (hub.isPlatform || hub.companies.some((c) => c.can.settings)) ? hub : null;
}

export async function saveOutlookSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (!(await outlookAdmin())) return { ok: false, error: "Only super admins can change the Outlook connection." };
  const parsed = z.object({ mailbox: z.union([z.literal(""), z.email("Enter an email address")]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Enter the shared mailbox's email address.", fieldErrors: { mailbox: ["Enter an email address"] } };
  const kinds = formData.getAll("auto_kinds").map(String).filter((k) => k in AUTO_KINDS);
  const user = await getSessionUser();
  const { error } = await createAdminClient().from("outlook_settings")
    .update({ mailbox: parsed.data.mailbox.toLowerCase() || null, auto_kinds: kinds, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  syncCalendarsSoon();
  refresh();
  return { ok: true, message: "Saved." };
}

/** Sends the signed-in admin a short test invite for tomorrow morning. */
export async function testOutlook(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  void _prev; void _formData;
  if (!(await outlookAdmin())) return { ok: false, error: "Only super admins can test the connection." };
  const settings = await getOutlookSettings();
  if (!outlookReady(settings)) return { ok: false, error: !settings.mailbox ? "Save the shared mailbox address first." : "Microsoft 365 isn't connected yet: the MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET settings are missing in Vercel." };
  const profile = await getMyProfile();
  if (!profile?.email_display) return { ok: false, error: "Your account has no email address." };
  const tz = profile.timezone || "UTC";
  const day = addDays(new Date().toISOString().slice(0, 10), 1);
  try {
    await createEvent(settings.mailbox!, {
      subject: `${BRAND.product} — test invite`,
      html: `<p>If you can see this in Outlook, calendar invites from ${BRAND.product} are working. You can delete it.</p>`,
      attendees: [String(profile.email_display)], allDay: false, timeZone: tz, start: `${day}T09:00:00`, end: `${day}T09:15:00`, showAs: "free",
    });
    return { ok: true, message: `Test invite sent to ${profile.email_display} for tomorrow 09:00. Check Outlook.` };
  } catch (e) {
    logServerError("outlook.test", e);
    return { ok: false, error: e instanceof GraphError ? e.message : "The test failed. Check the Microsoft 365 setup." };
  }
}

export async function runOutlookNow(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  void _prev; void _formData;
  if (!(await outlookAdmin())) return { ok: false, error: "Only super admins can do that." };
  const r = await runOutlookSync(100);
  refresh();
  if (r.waiting) return { ok: false, error: "Outlook isn't connected yet, so invites are waiting." };
  return { ok: true, message: `${r.sent} sent${r.failed ? `, ${r.failed} failed (see below)` : ""}.` };
}

export async function retryOutlookItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success || !(await outlookAdmin())) return { ok: false, error: "Not allowed." };
  await createAdminClient().from("calendar_sync").update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null }).eq("id", parsed.data.id);
  syncCalendarsSoon();
  refresh();
  return { ok: true, message: "Queued again." };
}

// ------------------------------------------------------------------ PAs and super admins send

const inviteSchema = z.object({
  organization_id: uuid,
  category: z.enum(["travel", "company", "project", "meeting", "other"]),
  from_place: z.string().trim().max(140).optional(),
  to_place: z.string().trim().max(140).optional(),
  transport: z.string().trim().max(200).optional(),
  accommodation: z.string().trim().max(200).optional(),
  title: z.string().trim().min(2, "Enter a title").max(200),
  body: z.string().trim().max(8000).optional(),
  location: z.string().trim().max(300).optional(),
  start_date: z.string().optional(),
  start_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  all_day: z.literal("on").optional(),
  use_signature: z.literal("on").optional(),
  time_zone: z.string().min(1).max(64),
  end_time_zone: z.string().max(64).optional(),
});

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const ids = (fd: FormData, key: string) => [...new Set(fd.getAll(key).map(String).filter((v) => uuid.safeParse(v).success))];
const time = (v: string | undefined, fallback: string) => (v && /^\d{2}:\d{2}$/.test(v) ? v : fallback);

/**
 * A calendar invite (travel, meeting, project kick-off…) or an email update, to everyone in
 * chosen companies, project teams and/or named people. Everyone also gets an in-app notification.
 */
export async function sendInvite(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  const d = parsed.data;
  if (!validZone(d.time_zone)) return { ok: false, error: "Choose a time zone.", fieldErrors: { time_zone: ["Choose a time zone"] } };
  // Travel and meetings are calendar invites; company and project updates are emails; "other"
  // becomes an invite when it has a date.
  const kind: "invite" | "update" = d.category === "travel" || d.category === "meeting" ? "invite" : d.category === "other" && isDateString(d.start_date) ? "invite" : "update";
  if (kind === "update" && !d.body) return { ok: false, error: "Write the update.", fieldErrors: { body: ["Required"] } };
  if (d.category === "travel") {
    if (!d.from_place || !d.to_place) return { ok: false, error: "Fill in where they travel from and to.", fieldErrors: { ...(d.from_place ? {} : { from_place: ["Required"] }), ...(d.to_place ? {} : { to_place: ["Required"] }) } };
    d.location = `${d.from_place} → ${d.to_place}`;
    d.body = [
      `From: ${d.from_place}`,
      `To: ${d.to_place}`,
      d.transport ? `Transport: ${d.transport}` : null,
      d.accommodation ? `Accommodation: ${d.accommodation}` : null,
      d.body ? `\n${d.body}` : null,
    ].filter(Boolean).join("\n");
  }
  if (d.category === "travel" || d.category === "meeting") d.all_day = undefined;

  // Attachments: up to 5 files, 3 MB each (what Outlook accepts per file), 8 MB together.
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5) return { ok: false, error: "Attach up to 5 files.", fieldErrors: { attachments: ["Up to 5 files"] } };
  if (files.reduce((n, f) => n + f.size, 0) > 8 * 1024 * 1024) return { ok: false, error: "Attachments can be 8 MB in total.", fieldErrors: { attachments: ["8 MB in total"] } };
  const uploads: ValidatedUpload[] = [];
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${f.name} is bigger than 3 MB. Share large files from SharePoint and paste the link in the notes.`, fieldErrors: { attachments: ["3 MB per file"] } };
    try {
      uploads.push(await validateUpload(f, "any"));
    } catch (e) {
      return { ok: false, error: e instanceof UploadError ? `${f.name}: ${e.message}` : `${f.name} couldn't be read.`, fieldErrors: { attachments: ["Check the files"] } };
    }
  }
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };

  // Companies where this person may send: the sending company plus any other chosen ones.
  const { data: mine } = await supabase.rpc("my_companies");
  const companyIds = ((mine ?? []) as { organization_id: string }[]).map((c) => c.organization_id);
  const checks = await Promise.all(companyIds.map((id) => supabase.rpc("has_permission", { p_org: id, p_permission: "invites.send" })));
  const allowed = new Set(companyIds.filter((_, i) => checks[i].data === true));
  if (!allowed.has(d.organization_id)) return { ok: false, error: "You can't send invites for this company." };

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (kind === "invite") {
    if (!isDateString(d.start_date)) return { ok: false, error: "Choose the date.", fieldErrors: { start_date: ["Required"] } };
    const endDate = isDateString(d.end_date) ? d.end_date : d.start_date;
    if (d.all_day) {
      startsAt = zonedToUtc(d.start_date, "00:00", d.time_zone);
      endsAt = zonedToUtc(addDays(endDate, 1), "00:00", d.time_zone);
    } else {
      const st = time(d.start_time, "09:00");
      startsAt = zonedToUtc(d.start_date, st, d.time_zone);
      // Travel: arrival can be in another zone (London → Bangkok, each in local time).
      const endTz = d.end_time_zone && validZone(d.end_time_zone) ? d.end_time_zone : d.time_zone;
      endsAt = d.end_time ? zonedToUtc(endDate, time(d.end_time, st), endTz) : new Date(Date.parse(startsAt) + 3600_000).toISOString();
    }
    if (!(Date.parse(endsAt) > Date.parse(startsAt))) return { ok: false, error: "The end is before the start.", fieldErrors: { end_time: ["After the start"] } };
  }

  // Who: everyone in the ticked companies, project teams, and named people (only where allowed).
  const admin = createAdminClient();
  const companies = ids(formData, "companies").filter((id) => allowed.has(id));
  const projects = ids(formData, "projects");
  const people = ids(formData, "people");
  const recipients = new Map<string, string>(); // user -> company for the in-app notification
  if (companies.length) {
    const { data } = await admin.from("organization_memberships").select("user_id, organization_id").in("organization_id", companies).eq("status", "active");
    for (const m of data ?? []) if (!recipients.has(m.user_id as string)) recipients.set(m.user_id as string, m.organization_id as string);
  }
  if (projects.length) {
    const { data: ps } = await admin.from("projects").select("id, organization_id, manager_membership_id").in("id", projects);
    const okProjects = (ps ?? []).filter((p) => allowed.has(p.organization_id as string));
    const { data: pm } = await admin.from("project_members").select("membership_id").in("project_id", okProjects.map((p) => p.id));
    const mIds = [...(pm ?? []).map((m) => m.membership_id as string), ...okProjects.map((p) => p.manager_membership_id as string).filter(Boolean)];
    if (mIds.length) {
      const { data } = await admin.from("organization_memberships").select("user_id, organization_id").in("id", mIds).eq("status", "active");
      for (const m of data ?? []) if (!recipients.has(m.user_id as string)) recipients.set(m.user_id as string, m.organization_id as string);
    }
  }
  if (people.length) {
    const { data } = await admin.from("organization_memberships").select("user_id, organization_id").in("user_id", people).in("organization_id", [...allowed]).eq("status", "active");
    for (const m of data ?? []) if (!recipients.has(m.user_id as string)) recipients.set(m.user_id as string, m.organization_id as string);
  }
  if (!recipients.size) return { ok: false, error: "Choose who it's for: companies, project teams or people." };
  const { data: profiles } = await admin.from("profiles").select("id, email_display, status").in("id", [...recipients.keys()]);
  const emails = [...new Set((profiles ?? []).filter((p) => p.status === "active" && p.email_display).map((p) => String(p.email_display).toLowerCase()))];
  const userIds = (profiles ?? []).filter((p) => p.status === "active").map((p) => p.id as string);

  const { data: sig } = d.use_signature ? await supabase.from("email_signatures").select("signature").eq("user_id", user.id).maybeSingle() : { data: null };
  const signature = (sig?.signature as string | undefined)?.trim() || null;
  const { data: b, error } = await admin.from("calendar_broadcasts").insert({
    organization_id: d.organization_id, kind, category: d.category, title: d.title, body: d.body || null, location: d.location || null,
    starts_at: startsAt, ends_at: endsAt, all_day: Boolean(d.all_day), time_zone: d.time_zone,
    audience: [companies.length ? `${companies.length} compan${companies.length === 1 ? "y" : "ies"}` : "", projects.length ? `${projects.length} project team${projects.length === 1 ? "" : "s"}` : "", people.length ? `${people.length} named` : ""].filter(Boolean).join(", "),
    attendee_emails: emails, attendee_user_ids: userIds, created_by: user.id, signature,
  }).select("id").single();
  if (error || !b) {
    logServerError("invite.save", error);
    return { ok: false, error: "Couldn't save it. Try again." };
  }
  if (uploads.length) {
    const stored: StoredAttachment[] = [];
    try {
      for (const u of uploads) {
        const path = `${d.organization_id}/broadcast/${b.id}/${randomUUID()}.${u.ext}`;
        const { error: upErr } = await admin.storage.from("files").upload(path, u.bytes, { contentType: u.mime, upsert: false });
        if (upErr) throw upErr;
        stored.push({ path, name: u.fileName, mime: u.mime, size: u.size });
      }
    } catch (e) {
      logServerError("invite.attach", e);
      return { ok: false, error: "Couldn't save the attachments. Try again." };
    }
    await admin.from("calendar_broadcasts").update({ attachments: stored }).eq("id", b.id);
  }
  await admin.from("calendar_sync").insert({ organization_id: d.organization_id, kind: "manual", ref_id: b.id });
  const { data: slugs } = await admin.from("organizations").select("id, slug").in("id", [...new Set(recipients.values())]);
  const slugOf = new Map((slugs ?? []).map((o) => [o.id as string, o.slug as string]));
  const when = startsAt ? ` · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", ...(d.all_day ? {} : { timeStyle: "short" }), timeZone: d.time_zone }).format(new Date(startsAt))}` : "";
  await admin.from("notifications").insert(userIds.filter((u) => u !== user.id).map((u) => ({
    organization_id: recipients.get(u)!, user_id: u, kind: "invite", actor_id: user.id,
    title: `${kind === "invite" ? "Invite" : "Update"}: ${d.title}`.slice(0, 200),
    body: `${d.location ? `${d.location}` : ""}${when}`.replace(/^ · /, "").slice(0, 300) || null,
    link: `/o/${slugOf.get(recipients.get(u)!)}/invites/${b.id}`,
  })));
  syncCalendarsSoon();
  refresh();
  const ready = outlookReady(await getOutlookSettings(admin));
  return {
    ok: true,
    message: `${kind === "invite" ? "Invite" : "Update"} sent to ${userIds.length} ${userIds.length === 1 ? "person" : "people"}${ready ? " — in the app now, in Outlook within a minute." : ". They have it in the app; it goes to Outlook once Microsoft 365 is connected."}`,
  };
}

/** The sender's own email signature, added to invites and updates they send. */
export async function saveSignature(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ signature: z.string().max(2000, "Keep it under 2000 characters") }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Keep the signature under 2000 characters." };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.from("email_signatures").upsert({ user_id: user.id, signature: parsed.data.signature.trim(), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save the signature." };
  refresh();
  return { ok: true, message: "Signature saved." };
}
