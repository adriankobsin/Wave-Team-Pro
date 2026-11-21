"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { departmentSchema, teamSchema } from "@/lib/validation/schemas";
import { friendlyDbError, type ActionResult } from "@/lib/errors";

async function guard(orgId: string) {
  return authorize(orgId, "org.structure.manage");
}
const done = (message: string): ActionResult => {
  revalidatePath("/o/[org]", "layout");
  return { ok: true, message };
};

export async function createDepartment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = departmentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await guard(parsed.data.organization_id))) return { ok: false, error: "You don't have permission to change departments." };
  const { error } = await (await createClient()).from("departments").insert(parsed.data);
  if (error) return { ok: false, error: error.code === "23505" ? "A department with that name already exists." : friendlyDbError(error) };
  return done("Department added.");
}

export async function createTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = teamSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await guard(parsed.data.organization_id))) return { ok: false, error: "You don't have permission to change teams." };
  const { error } = await (await createClient()).from("teams").insert(parsed.data);
  if (error) return { ok: false, error: error.code === "23505" ? "A team with that name already exists." : friendlyDbError(error) };
  return done("Team added.");
}

const archiveSchema = z.object({ organization_id: uuid, id: uuid, kind: z.enum(["department", "team"]) });

/** Archive rather than delete so historical references (memberships, future timesheets) remain valid. */
export async function archiveStructure(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = archiveSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await guard(parsed.data.organization_id))) return { ok: false, error: "You don't have permission to change structure." };
  const table = parsed.data.kind === "department" ? "departments" : "teams";
  const { data, error } = await (await createClient())
    .from(table)
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("organization_id", parsed.data.organization_id)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "Not found." };
  return done(parsed.data.kind === "department" ? "Department archived." : "Team archived.");
}

const teamMemberSchema = z.object({
  organization_id: uuid,
  team_id: uuid,
  membership_id: uuid,
  is_lead: z.literal("on").optional().transform((v) => v === "on"),
});

export async function addTeamMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = teamMemberSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person and a team." };
  if (!(await guard(parsed.data.organization_id))) return { ok: false, error: "You don't have permission to change teams." };
  const { error } = await (await createClient()).from("team_memberships").insert(parsed.data);
  if (error) return { ok: false, error: error.code === "23505" ? "They're already on that team." : friendlyDbError(error) };
  return done("Added to team.");
}

const removeTeamMemberSchema = z.object({ organization_id: uuid, team_id: uuid, membership_id: uuid });

export async function removeTeamMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = removeTeamMemberSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await guard(parsed.data.organization_id))) return { ok: false, error: "You don't have permission to change teams." };
  const { error } = await (await createClient())
    .from("team_memberships")
    .delete()
    .eq("organization_id", parsed.data.organization_id)
    .eq("team_id", parsed.data.team_id)
    .eq("membership_id", parsed.data.membership_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return done("Removed from team.");
}
