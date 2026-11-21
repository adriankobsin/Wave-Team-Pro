"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";
import { CREDENTIAL_CATEGORIES } from "@/lib/credentials";

const text = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const optUuid = z.union([z.literal(""), uuid]).optional().transform((v) => v || null);

const schema = z.object({
  id: optUuid,
  orgId: uuid,
  projectId: uuid,
  name: z.string().trim().min(1, "Give it a name, e.g. Fortigate 200F or Starlink portal.").max(120),
  category: z.enum(Object.keys(CREDENTIAL_CATEGORIES) as [string, ...string[]]),
  address: text(300),
  username: z.string().max(200).optional().transform((v) => v || null),
  // Passwords are kept exactly as typed (spaces included).
  password: z.string().max(1000, "That password is too long.").optional(),
  setPassword: z.string().optional(),
  deviceId: optUuid,
  notes: text(2000),
});

/** Adds or changes a stored login. The password goes straight into the encrypted vault. */
export async function saveCredential(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  const setPassword = d.id ? d.setPassword === "on" : true;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_credential", {
    p_id: d.id, p_org: d.orgId, p_project: d.projectId, p_name: d.name, p_category: d.category, p_address: d.address,
    p_username: d.username, p_set_password: setPassword, p_password: setPassword ? d.password ?? "" : null, p_device: d.deviceId, p_notes: d.notes,
  });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change stored passwords.") };
  revalidatePath("/o/[org]/projects/[id]/passwords");
  return { ok: true, message: d.id ? `${d.name} saved.` : `${d.name} added.` };
}

/** Shows a password to someone allowed to see it; every look is recorded. */
export async function revealCredential(id: string): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_credential", { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't see this password.") };
  return { ok: true, password: (data as string | null) ?? "" };
}

/** Removes a stored login and wipes its password. */
export async function removeCredential(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_credential", { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't remove this login.") };
  revalidatePath("/o/[org]/projects/[id]/passwords");
  return { ok: true, message: "Removed." };
}
