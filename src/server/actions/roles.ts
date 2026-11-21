"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject, uuid, withScope } from "@/lib/validation/common";
import { assignmentSchema, overrideSchema, roleSchema } from "@/lib/validation/schemas";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

function slugifyKey(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return `${/^[a-z]/.test(base) ? base : `r_${base}`}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Creates or edits a custom role. Permission changes are applied as row inserts/deletes so
 * the database escalation guard checks every permission individually.
 */
export async function saveRole(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ roleId: string }>> {
  const parsed = roleSchema.safeParse({ ...formObject(formData), permissions: formData.getAll("permissions") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { organization_id, role_id, name, description, permissions } = parsed.data;
  if (!(await authorize(organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to manage roles." };
  const supabase = await createClient();

  let roleId = role_id;
  if (!roleId) {
    const { data, error } = await supabase
      .from("roles")
      .insert({ organization_id, name, description, key: slugifyKey(name) })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendlyDbError(error) };
    roleId = data.id as string;
  } else {
    const { error } = await supabase.from("roles").update({ name, description }).eq("id", roleId).eq("organization_id", organization_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
  }

  const { data: current } = await supabase.from("role_permissions").select("permission_key").eq("role_id", roleId);
  const have = new Set((current ?? []).map((r) => r.permission_key as string));
  const want = new Set<string>(permissions);
  const toAdd = [...want].filter((k) => !have.has(k));
  const toRemove = [...have].filter((k) => !want.has(k));

  if (toAdd.length) {
    const { error } = await supabase
      .from("role_permissions")
      .insert(toAdd.map((permission_key) => ({ organization_id, role_id: roleId, permission_key })));
    if (error) return { ok: false, error: friendlyDbError(error) };
  }
  if (toRemove.length) {
    const { error } = await supabase.from("role_permissions").delete().eq("role_id", roleId).in("permission_key", toRemove);
    if (error) return { ok: false, error: friendlyDbError(error) };
  }
  revalidatePath("/o/[org]/admin/roles", "layout");
  const slug = String(formData.get("org_slug") ?? "");
  if (!role_id && /^[a-z0-9-]+$/.test(slug)) redirect(`/o/${slug}/admin/roles/${roleId}?created=1`);
  return { ok: true, data: { roleId: roleId! }, message: "Role saved." };
}

const roleRef = z.object({ organization_id: uuid, role_id: uuid });

export async function deleteRole(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = roleRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown role." };
  if (!(await authorize(parsed.data.organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to manage roles." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .delete()
    .eq("id", parsed.data.role_id)
    .eq("organization_id", parsed.data.organization_id)
    .select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Remove this role from everyone (and pending invitations) before deleting it." };
    return { ok: false, error: friendlyDbError(error) };
  }
  if (!data?.length) return { ok: false, error: "Role not found." };
  revalidatePath("/o/[org]/admin/roles", "layout");
  return { ok: true, message: "Role deleted." };
}

export async function addRoleAssignment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = assignmentSchema.safeParse(withScope(formObject(formData)));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await authorize(parsed.data.organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to assign roles." };
  const supabase = await createClient();
  const { error } = await supabase.from("membership_role_assignments").insert(parsed.data);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Role assigned." };
}

const assignmentRef = z.object({ organization_id: uuid, assignment_id: uuid });

export async function removeRoleAssignment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = assignmentRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown assignment." };
  if (!(await authorize(parsed.data.organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to assign roles." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("membership_role_assignments")
    .delete()
    .eq("id", parsed.data.assignment_id)
    .eq("organization_id", parsed.data.organization_id)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "Assignment not found." };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Role removed." };
}

export async function addOverride(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = overrideSchema.safeParse(withScope(formObject(formData)));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await authorize(parsed.data.organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to change permissions." };
  const supabase = await createClient();
  const { error } = await supabase.from("scoped_permission_overrides").insert(parsed.data);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "An override for this permission and scope already exists. Remove it first." };
    return { ok: false, error: friendlyDbError(error) };
  }
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: parsed.data.effect === "deny" ? "Permission blocked." : "Permission granted." };
}

const overrideRef = z.object({ organization_id: uuid, override_id: uuid });

export async function removeOverride(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = overrideRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown override." };
  if (!(await authorize(parsed.data.organization_id, "roles.manage"))) return { ok: false, error: "You don't have permission to change permissions." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoped_permission_overrides")
    .delete()
    .eq("id", parsed.data.override_id)
    .eq("organization_id", parsed.data.organization_id)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "Override not found." };
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message: "Override removed." };
}
