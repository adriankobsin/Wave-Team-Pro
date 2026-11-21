"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

export async function acceptInvitation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = z.uuid().safeParse(formData.get("invitation_id"));
  const slug = z.string().regex(/^[a-z0-9-]+$/).safeParse(formData.get("organization_slug"));
  if (!id.success || !slug.success) return { ok: false, error: "This invitation link is not valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_invitation: id.data });
  if (error) return { ok: false, error: friendlyDbError(error, "This invitation is no longer valid.") };
  redirect(`/o/${slug.data}?welcome=1`);
}
