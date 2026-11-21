"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createInvitationLink, deliverInvitation } from "@/server/services/invitations";
import { inviteToCompanies, invitableCompanies, summarise } from "@/server/services/multi-company";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { inviteSchema, membershipUpdateSchema } from "@/lib/validation/schemas";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { BRAND } from "@/lib/brand";

async function inviteContext(orgId: string, userId: string) {
  const supabase = await createClient();
  const [{ data: org }, { data: me }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).single(),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
  ]);
  return { orgName: org?.name ?? BRAND.group, inviterName: me?.display_name ?? "Your administrator" };
}

function deliveryMessage(email: string, r: { emailed: boolean; via: string }) {
  if (r.via === "app") return `Invitation emailed to ${email}. You can also copy their personal link below.`;
  if (r.via === "supabase") return `Invitation emailed to ${email}. If it doesn't arrive, use “Copy link” and send it to them directly.`;
  return `Invitation saved, but the email couldn't be sent. Use “Copy link” and send it to ${email} directly (WhatsApp, Teams or your own email).`;
}

export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const actor = await authorize(input.organization_id, "users.invite");
  if (!actor) return { ok: false, error: "You don't have permission to invite people here." };
  if (!(await consumeRateLimit(["invite", actor.userId], 60, 60 * 60))) {
    return { ok: false, error: "Invitation limit reached for this hour. Try again later." };
  }

  const supabase = await createClient();
  const { data: inv, error } = await supabase
    .from("invitations")
    .insert({ ...input, expires_at: new Date().toISOString() }) // expiry is set by the database
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "This email already has a pending invitation. Resend it instead." };
    return { ok: false, error: friendlyDbError(error) };
  }

  // Other companies the same person works for: invited with the same role, joined with the same link.
  const wanted = new Set(formData.getAll("also_org").map(String).filter((id) => id !== input.organization_id));
  let extra = { added: [] as string[], skipped: [] as { name: string; reason: string }[] };
  if (wanted.size) {
    const companies = (await invitableCompanies()).filter((co) => wanted.has(co.id));
    const { data: role } = await supabase.from("roles").select("key").eq("id", input.role_id).maybeSingle();
    extra = await inviteToCompanies(supabase, { email: input.email, display_name: input.display_name ?? null, job_title: input.job_title ?? null, start_date: input.start_date, employee_number: input.employee_number ?? null }, role?.key ?? "employee", companies);
  }

  const c = await inviteContext(input.organization_id, actor.userId);
  let result;
  try {
    result = await deliverInvitation({ invitationId: inv.id, email: input.email, displayName: input.display_name ?? null, ...c, createdBy: actor.userId, alsoCompanies: extra.added });
  } catch (e) {
    logServerError("invite.deliver", e);
    revalidatePath("/o/[org]", "layout");
    return { ok: true, message: `Invitation saved. Use “Copy link” to send it. ${summarise(extra)}`.trim() };
  }
  revalidatePath("/o/[org]", "layout");
  return { ok: true, data: { link: result.link }, message: `${deliveryMessage(input.email, result)} ${summarise(extra)}`.trim() };
}

const invitationRef = z.object({ organization_id: uuid, invitation_id: uuid });

export async function revokeInvitation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = invitationRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown invitation." };
  if (!(await authorize(parsed.data.organization_id, "users.invite"))) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.invitation_id)
    .eq("organization_id", parsed.data.organization_id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "That invitation is no longer pending." };
  revalidatePath("/o/[org]/admin/invitations", "page");
  return { ok: true, message: "Invitation revoked." };
}

export async function resendInvitation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = invitationRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown invitation." };
  const actor = await authorize(parsed.data.organization_id, "users.invite");
  if (!actor) return { ok: false, error: "You don't have permission to do that." };
  if (!(await consumeRateLimit(["resend", parsed.data.invitation_id], 3, 60 * 60))) {
    return { ok: false, error: "This invitation was resent recently. Wait an hour before sending it again." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ expires_at: new Date().toISOString() }) // database extends from now
    .eq("id", parsed.data.invitation_id)
    .eq("status", "pending")
    .select("email, display_name")
    .single();
  if (error || !data) return { ok: false, error: friendlyDbError(error, "That invitation is no longer pending.") };

  const c = await inviteContext(parsed.data.organization_id, actor.userId);
  try {
    const r = await deliverInvitation({ invitationId: parsed.data.invitation_id, email: data.email, displayName: data.display_name, ...c, createdBy: actor.userId });
    revalidatePath("/o/[org]/admin/invitations", "page");
    return { ok: true, data: { link: r.link }, message: deliveryMessage(data.email, r) };
  } catch (e) {
    logServerError("invite.resend", e);
    return { ok: false, error: "Couldn't create a new link. Try again." };
  }
}

/** Creates a fresh personal link an admin can send by any channel. */
export async function copyInvitationLink(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ link: string }>> {
  const parsed = invitationRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown invitation." };
  const actor = await authorize(parsed.data.organization_id, "users.invite");
  if (!actor) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { data } = await supabase.from("invitations").select("id, status, expires_at").eq("id", parsed.data.invitation_id).eq("organization_id", parsed.data.organization_id).maybeSingle();
  if (!data || data.status !== "pending") return { ok: false, error: "That invitation is no longer pending." };
  if (new Date(data.expires_at) <= new Date()) return { ok: false, error: "This invitation has expired. Press Resend to extend it first." };
  try {
    return { ok: true, data: { link: await createInvitationLink(data.id, actor.userId) } };
  } catch (e) {
    logServerError("invite.link", e);
    return { ok: false, error: "Couldn't create a link. Try again." };
  }
}

export async function updateMembership(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = membershipUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { organization_id, membership_id, ...fields } = parsed.data;
  if (!(await authorize(organization_id, "users.edit"))) return { ok: false, error: "You don't have permission to edit employment details." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .update(fields)
    .eq("id", membership_id)
    .eq("organization_id", organization_id)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "That person isn't in this organization." };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Employment details saved." };
}

const statusSchema = z.object({
  organization_id: uuid,
  membership_id: uuid,
  status: z.enum(["active", "deactivated"]),
});

/**
 * Deactivation takes effect on the next database request (RLS checks membership status),
 * so access stops immediately. If the person has no other active organization, their
 * account is also banned so the session cannot be refreshed. History stays attributable.
 */
export async function setMembershipStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { organization_id, membership_id, status } = parsed.data;
  if (!(await authorize(organization_id, "users.deactivate"))) return { ok: false, error: "You don't have permission to change employment status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .update({ status })
    .eq("id", membership_id)
    .eq("organization_id", organization_id)
    .select("user_id")
    .single();
  if (error || !data) return { ok: false, error: friendlyDbError(error, "That person isn't in this organization.") };

  const admin = createAdminClient();
  const { data: remaining } = await admin
    .from("organization_memberships")
    .select("id")
    .eq("user_id", data.user_id)
    .eq("status", "active");
  const hasActive = (remaining?.length ?? 0) > 0;
  try {
    if (!hasActive && status === "deactivated") {
      await admin.auth.admin.updateUserById(data.user_id, { ban_duration: "876000h" });
      await admin.from("profiles").update({ status: "deactivated", deactivated_at: new Date().toISOString() }).eq("id", data.user_id);
    } else if (status === "active") {
      await admin.auth.admin.updateUserById(data.user_id, { ban_duration: "none" });
      await admin.from("profiles").update({ status: "active", deactivated_at: null }).eq("id", data.user_id);
    }
  } catch (e) {
    logServerError("membership.status.account", e);
    return { ok: true, message: "Membership updated. The account-level lock couldn't be applied; access is still blocked by the database." };
  }
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: status === "deactivated" ? "Access removed. Their history stays attributed to them." : "Access restored." };
}

/**
 * Adds an existing member to more companies, straight away: they're active there with the chosen
 * role (matched by key, Employee where that company has no such role). No invitation or Join step.
 */
export async function addToCompanies(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, membership_id: uuid, role_key: z.string().regex(/^[a-z0-9_-]{1,60}$/) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose the companies and a role." };
  const d = parsed.data;
  const wanted = new Set(formData.getAll("org").map(String).filter((id) => id !== d.organization_id));
  if (!wanted.size) return { ok: false, error: "Tick at least one company." };
  const supabase = await createClient();
  const { data: m } = await supabase.from("organization_memberships").select("user_id, job_title").eq("id", d.membership_id).eq("organization_id", d.organization_id).maybeSingle();
  if (!m) return { ok: false, error: "That person isn't in this company." };
  const companies = (await invitableCompanies()).filter((c) => wanted.has(c.id));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const c of companies) {
    const { data: roles } = await supabase.from("roles").select("id, key").eq("organization_id", c.id).in("key", [d.role_key, "employee"]);
    const role = roles?.find((r) => r.key === d.role_key) ?? roles?.find((r) => r.key === "employee");
    if (!role) {
      skipped.push(`${c.name} (no matching role)`);
      continue;
    }
    const { error } = await supabase.rpc("add_to_company", { p_org: c.id, p_user: m.user_id, p_role: role.id, p_job_title: m.job_title });
    if (error) skipped.push(`${c.name} (${friendlyDbError(error, "couldn't add")})`);
    else added.push(c.name);
  }
  for (const c of wanted) if (!companies.some((x) => x.id === c)) skipped.push("a company where you can't add people");
  revalidatePath("/o/[org]", "layout");
  revalidatePath("/hub", "layout");
  if (!added.length) return { ok: false, error: `Not added: ${skipped.join(", ")}.` };
  return { ok: true, message: `Added to ${added.join(", ")}. They can work there now.${skipped.length ? ` Not added: ${skipped.join(", ")}.` : ""}` };
}

/** Someone invited who has since registered (or already works in another company): add them now. */
export async function addInvitedNow(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = invitationRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown invitation." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_invited_now", { p_invitation: parsed.data.invitation_id });
  if (error) return { ok: false, error: friendlyDbError(error, "Couldn't add them.") };
  revalidatePath("/o/[org]", "layout");
  revalidatePath("/hub", "layout");
  return { ok: true, message: "Added. They can work there now." };
}

/** Management sets the project a person clocks in to (when today's shift doesn't name one). */
export async function setAssignedProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, membership_id: uuid, project_id: z.union([uuid, z.literal("")]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a project." };
  const d = parsed.data;
  const allowed = (await authorize(d.organization_id, "users.edit")) ?? (await authorize(d.organization_id, "tasks.assign"));
  if (!allowed) return { ok: false, error: "Only management can assign projects." };
  const admin = createAdminClient();
  if (d.project_id) {
    const { data: p } = await admin.from("projects").select("id").eq("id", d.project_id).eq("organization_id", d.organization_id).maybeSingle();
    if (!p) return { ok: false, error: "That project isn't in this company." };
    // They need to be on the project to see it in their tasks and timesheets.
    await admin.from("project_members").upsert({ project_id: d.project_id, organization_id: d.organization_id, membership_id: d.membership_id }, { onConflict: "project_id,membership_id", ignoreDuplicates: true });
  }
  const { data, error } = await admin.from("organization_memberships").update({ assigned_project_id: d.project_id || null })
    .eq("id", d.membership_id).eq("organization_id", d.organization_id).select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't save the assignment." };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: d.project_id ? "Project assigned. Their next clock-in counts against it." : "Assignment cleared." };
}
