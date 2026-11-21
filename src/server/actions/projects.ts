"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { isDateString } from "@/lib/time";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { storeFile } from "@/server/services/files";
import { syncCalendarsSoon } from "@/server/services/outlook";
import { UploadError, validateUpload } from "@/lib/files/validate";

const optUuid = z.union([z.literal(""), uuid]).optional().transform((v) => v || null);
const optDate = z.union([z.literal(""), z.string().refine(isDateString)]).optional().transform((v) => v || null);
const optText = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const optNum = z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}
// Every change here may touch a calendar invite (tasks, projects, teams): push it to Outlook.
const refresh = () => {
  revalidatePath("/o/[org]", "layout");
  syncCalendarsSoon();
};

const projectSchema = z.object({
  organization_id: uuid,
  org_slug: z.string().regex(/^[a-z0-9-]+$/),
  id: optUuid,
  name: z.string().trim().min(2, "Enter a name").max(120),
  code: optText(32),
  description: optText(4000),
  site_label: optText(160),
  timezone: z.string().trim().max(64).optional().transform((v) => v || null),
  team_id: optUuid,
  manager_membership_id: optUuid,
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).default("active"),
  start_date: optDate,
  end_date: optDate,
  budget_hours: optNum,
  budget_amount: optNum,
  budget_currency: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/).optional().transform((v) => v || null),
  cost_center: optText(64),
  country: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/).optional().transform((v) => v || null),
});

export async function saveProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, org_slug, ...p } = parsed.data;
  if (p.budget_amount === null) p.budget_currency = null;
  if ((p.budget_amount === null) !== (p.budget_currency === null)) {
    return { ok: false, error: "Enter both a budget amount and its currency, or neither.", fieldErrors: { budget_currency: ["Required with an amount"] } };
  }
  if (p.start_date && p.end_date && p.end_date < p.start_date) return { ok: false, error: "The end date is before the start date." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (id) {
    const { organization_id: _o, ...upd } = p;
    void _o;
    const { data, error } = await supabase.from("projects").update(upd).eq("id", id).select("id");
    if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't edit this project.") };
    refresh();
    return { ok: true, message: "Project saved." };
  }
  const { data, error } = await supabase.from("projects").insert({ ...p, created_by: userId }).select("id").single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "That project code is already used." : friendlyDbError(error, "You can't create projects.") };
  redirect(`/o/${org_slug}/projects/${data.id}`);
}

/** Moves a project to another company in the group (or copies it there if time or expenses are already booked). */
export async function moveProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ project_id: uuid, target_org: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose the company." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("move_project", { p_project: parsed.data.project_id, p_target: parsed.data.target_org });
  if (error) return { ok: false, error: error.code === "23505" ? error.message : friendlyDbError(error, "You can't move this project.") };
  const r = data as { mode: "moved" | "copied" | "none"; project_id: string };
  if (r.mode === "none") return { ok: true, message: "It's already in that company." };
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", parsed.data.target_org).single();
  refresh();
  revalidatePath("/hub", "layout");
  redirect(`/o/${org?.slug}/projects/${r.project_id}?moved=${r.mode}`);
}

export async function addProjectMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, project_id: uuid, membership_id: uuid, role: z.enum(["member", "lead"]).default("member") }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person." };
  const { supabase } = await session();
  const { error } = await supabase.from("project_members").insert(parsed.data);
  if (error) return { ok: false, error: error.code === "23505" ? "Already on this project." : friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Added to project." };
}

export async function removeProjectMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ project_id: uuid, membership_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = await supabase.from("project_members").delete().eq("project_id", parsed.data.project_id).eq("membership_id", parsed.data.membership_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

const taskSchema = z.object({
  organization_id: uuid,
  project_id: optUuid,
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: optText(8000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_date: optDate,
  estimate_hours: optNum,
  assignee: optUuid,
});

export async function createTask(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = taskSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { assignee, ...t } = parsed.data;
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data, error } = await supabase.from("tasks").insert(t).select("id").single();
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  // Several people can be assigned at once ("assignees" checkboxes); a personal to-do is yours.
  const many = formData.getAll("assignees").map(String).filter((v) => uuid.safeParse(v).success);
  const people = [...new Set(many.length ? many : [assignee ?? (t.project_id ? null : userId)].filter((v): v is string => Boolean(v)))];
  const failed: string[] = [];
  for (const who of people) {
    const { error: aErr } = await supabase.from("task_assignees").insert({ task_id: data.id, organization_id: t.organization_id, user_id: who });
    if (aErr) failed.push(friendlyDbError(aErr));
  }
  refresh();
  if (failed.length) return { ok: true, message: `Task created, but ${failed.length} ${failed.length === 1 ? "person" : "people"} couldn't be assigned: ${failed[0]}` };
  return { ok: true, message: people.length > 1 || (people.length === 1 && people[0] !== userId) ? `Task sent to ${people.length} ${people.length === 1 ? "person" : "people"}. They've been notified.` : "Task created." };
}

export async function updateTask(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    id: uuid,
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(8000).optional(),
    due_date: optDate,
    estimate_hours: optNum,
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the form." };
  const { id, ...rest } = parsed.data;
  const upd: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (formData.has(k)) upd[k] = v;
  if ("description" in upd) upd.description = upd.description || null;
  const { supabase } = await session();
  const { data, error } = await supabase.from("tasks").update(upd).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't edit this task.") };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function assignTask(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ task_id: uuid, organization_id: uuid, user_id: uuid, remove: z.enum(["1"]).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person." };
  const { supabase } = await session();
  const { error } = parsed.data.remove
    ? await supabase.from("task_assignees").delete().eq("task_id", parsed.data.task_id).eq("user_id", parsed.data.user_id)
    : await supabase.from("task_assignees").insert({ task_id: parsed.data.task_id, organization_id: parsed.data.organization_id, user_id: parsed.data.user_id });
  if (error) return { ok: false, error: error.code === "23505" ? "Already assigned." : friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function addChecklistItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ task_id: uuid, title: z.string().trim().min(1).max(200) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Enter an item." };
  const { supabase } = await session();
  const { error } = await supabase.from("task_checklist_items").insert({ ...parsed.data, position: Date.now() % 2147483647 });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function toggleChecklistItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, done: z.enum(["1", "0"]), remove: z.enum(["1"]).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = parsed.data.remove
    ? await supabase.from("task_checklist_items").delete().eq("id", parsed.data.id)
    : await supabase.from("task_checklist_items").update({ done: parsed.data.done === "1" }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function addTaskComment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ task_id: uuid, organization_id: uuid, body: z.string().trim().min(1, "Write a comment").max(4000) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Write a comment." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { error } = await supabase.from("task_comments").insert({ ...parsed.data, author_id: userId });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ notes, photos, report back

async function attachTaskPhotos(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, userId: string, formData: FormData): Promise<{ count: number } | { error: string }> {
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { count: 0 };
  if (files.length > 10) return { error: "Up to 10 photos at a time." };
  const { data: task } = await supabase.from("tasks").select("organization_id").eq("id", taskId).maybeSingle();
  const { data: canWork } = await supabase.rpc("can_work_on_task", { p_task: taskId });
  if (!task || !canWork) return { error: "You can't add photos to this task." };
  const uploads = [];
  for (const f of files) {
    try {
      uploads.push(await validateUpload(f, "image-or-pdf"));
    } catch (e) {
      return { error: e instanceof UploadError ? `${f.name}: ${e.message}` : `${f.name} couldn't be processed.` };
    }
  }
  try {
    for (const upload of uploads) await storeFile({ orgId: task.organization_id, userId, context: "task", contextId: taskId, upload });
  } catch (e) {
    logServerError("task.photos", e);
    return { error: "Couldn't save the photos. Try again." };
  }
  return { count: uploads.length };
}

/** A progress note, photos, or both. Everyone else on the task is notified. */
export async function addTaskNote(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ task_id: uuid, organization_id: uuid, body: z.string().trim().max(4000).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the note." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const photos = await attachTaskPhotos(supabase, parsed.data.task_id, userId, formData);
  if ("error" in photos) return { ok: false, error: photos.error };
  const body = parsed.data.body || (photos.count ? `Added ${photos.count} photo${photos.count === 1 ? "" : "s"}.` : "");
  if (!body) return { ok: false, error: "Write a note or add a photo." };
  const { error } = await supabase.from("task_comments").insert({ task_id: parsed.data.task_id, organization_id: parsed.data.organization_id, author_id: userId, body: parsed.data.body && photos.count ? `${body}\n(${photos.count} photo${photos.count === 1 ? "" : "s"} added)` : body });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Added." };
}

/** Report back: completed or not completed, with the reasoning and optional photos. */
export async function reportTask(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ task_id: uuid, outcome: z.enum(["completed", "in_progress", "not_completed"]), note: z.string().trim().max(4000).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose completed, in progress or not completed." };
  if (parsed.data.outcome === "not_completed" && !parsed.data.note) return { ok: false, error: "Say why it isn't completed.", fieldErrors: { note: ["Required when not completed"] } };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const photos = await attachTaskPhotos(supabase, parsed.data.task_id, userId, formData);
  if ("error" in photos) return { ok: false, error: photos.error };
  const note = [parsed.data.note, photos.count ? `(${photos.count} photo${photos.count === 1 ? "" : "s"} attached)` : null].filter(Boolean).join(" ");
  const { error } = await supabase.rpc("report_task", { p_task: parsed.data.task_id, p_outcome: parsed.data.outcome, p_note: note || null });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't report on this task.") };
  refresh();
  return { ok: true, message: { completed: "Marked completed.", in_progress: "Marked in progress.", not_completed: "Marked not completed." }[parsed.data.outcome] + " Your manager has been told." };
}

// ------------------------------------------------------------------ projects across the group

/**
 * The person's membership in a company, adding them there (as Employee) when they work in
 * another company of the group but not this one yet. Returns null when that isn't allowed.
 */
async function ensureMembership(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, userId: string): Promise<string | null> {
  const { data: m } = await supabase.from("organization_memberships").select("id, status").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  if (m?.status === "active") return m.id as string;
  const { data: role } = await supabase.from("roles").select("id").eq("organization_id", orgId).eq("key", "employee").maybeSingle();
  if (!role) return null;
  const { data, error } = await supabase.rpc("add_to_company", { p_org: orgId, p_user: userId, p_role: role.id });
  return error ? null : (data as string);
}

async function putOnProject(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, projectId: string, userIds: string[]) {
  const added: string[] = [];
  let failed = 0;
  for (const u of userIds) {
    const membership = await ensureMembership(supabase, orgId, u);
    if (!membership) { failed++; continue; }
    const { error } = await supabase.from("project_members").insert({ project_id: projectId, organization_id: orgId, membership_id: membership });
    if (error && error.code !== "23505") failed++;
    else added.push(u);
  }
  return { added, failed };
}

const userIds = (formData: FormData, key: string) => [...new Set(formData.getAll(key).map(String).filter((v) => uuid.safeParse(v).success))];

/** Group Hub: create a project in any company and staff it with people from anywhere in the group. */
export async function createGroupProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = projectSchema.omit({ org_slug: true, id: true, team_id: true, manager_membership_id: true }).extend({ manager_user: optUuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { manager_user, ...p } = parsed.data;
  if (p.budget_amount === null) p.budget_currency = null;
  if (p.start_date && p.end_date && p.end_date < p.start_date) return { ok: false, error: "The end date is before the start date." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", p.organization_id).maybeSingle();
  if (!org) return { ok: false, error: "Choose the company." };
  const { data, error } = await supabase.from("projects").insert({ ...p, created_by: userId }).select("id").single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "That project code is already used in this company." : friendlyDbError(error, "You can't create projects in that company.") };
  if (manager_user) {
    const m = await ensureMembership(supabase, p.organization_id, manager_user);
    if (m) await supabase.from("projects").update({ manager_membership_id: m }).eq("id", data.id);
  }
  const team = userIds(formData, "members").filter((u) => u !== manager_user);
  const r = await putOnProject(supabase, p.organization_id, data.id, team);
  refresh();
  revalidatePath("/hub", "layout");
  redirect(`/o/${org.slug}/projects/${data.id}${r.failed ? `?team_failed=${r.failed}` : ""}`);
}

/** Add people to a project's team; people from other companies in the group are added to this company first. */
export async function addPeopleToProject(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, project_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const people = userIds(formData, "members");
  if (!people.length) return { ok: false, error: "Tick at least one person." };
  const { supabase } = await session();
  const { data: canEdit } = await supabase.rpc("can_edit_project", { p_project: parsed.data.project_id });
  if (!canEdit) return { ok: false, error: "You can't change this project's team." };
  const r = await putOnProject(supabase, parsed.data.organization_id, parsed.data.project_id, people);
  refresh();
  revalidatePath("/hub", "layout");
  if (!r.added.length) return { ok: false, error: "Couldn't add them. You need to be able to add people to this company." };
  return { ok: true, message: `Added ${r.added.length} ${r.added.length === 1 ? "person" : "people"} to the team.${r.failed ? ` ${r.failed} couldn't be added.` : ""}` };
}
