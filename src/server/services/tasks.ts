import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaskRow } from "@/components/projects/task-card";

export async function listTasks(orgId: string, opts: { projectId?: string; assignee?: string; ids?: string[]; includeDone?: boolean; createdBy?: string } = {}): Promise<TaskRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, project_id, position, outcome, created_by, completed_at, task_assignees(user_id), task_checklist_items(done)")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(500);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  if (opts.createdBy) q = q.eq("created_by", opts.createdBy);
  if (opts.ids) q = q.in("id", opts.ids.length ? opts.ids : ["00000000-0000-0000-0000-000000000000"]);
  if (!opts.includeDone) q = q.or(`status.neq.done,completed_at.gt.${new Date(Date.now() - 14 * 86400000).toISOString()}`);
  const { data } = await q;
  return ((data ?? []) as unknown as {
    id: string; title: string; status: string; priority: string; due_date: string | null; project_id: string | null; outcome: string | null; created_by: string; completed_at: string | null;
    task_assignees: { user_id: string }[]; task_checklist_items: { done: boolean }[];
  }[]).map((t) => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, project_id: t.project_id, outcome: t.outcome, created_by: t.created_by, completed_at: t.completed_at,
    assignees: t.task_assignees.map((a) => a.user_id),
    checklist_total: t.task_checklist_items.length,
    checklist_done: t.task_checklist_items.filter((c) => c.done).length,
  }));
}

export async function myTaskIds(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("task_assignees").select("task_id").eq("user_id", userId);
  return (data ?? []).map((r) => r.task_id as string);
}

export type TeamTask = {
  id: string; orgId: string; title: string; status: string; priority: string; due_date: string | null;
  project: string | null; outcome: string | null; createdBy: string; assignees: string[]; own: boolean; updatedAt: string;
  outcomeNote: string | null; outcomeBy: string | null; completedAt: string | null;
};
export type TeamTaskPerson = { userId: string; name: string };

/** Every task the viewer may see in these companies (management sees all, via tasks.view.all), with names. */
export async function teamTasks(orgIds: string[], opts: { status?: string; includeDone?: boolean; outcome?: string } = {}): Promise<{ tasks: TeamTask[]; people: Map<string, TeamTaskPerson> }> {
  const supabase = await createClient();
  if (!orgIds.length) return { tasks: [], people: new Map() };
  let q = supabase
    .from("tasks")
    .select("id, organization_id, title, status, priority, due_date, outcome, outcome_note, outcome_by, completed_at, created_by, updated_at, projects(name), task_assignees(user_id)")
    .in("organization_id", orgIds)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (opts.outcome === "none") q = q.is("outcome", null);
  else if (opts.outcome) q = q.eq("outcome", opts.outcome);
  if (opts.status) q = q.eq("status", opts.status);
  else if (!opts.includeDone) q = q.or(`status.neq.done,completed_at.gt.${new Date(Date.now() - 14 * 86400000).toISOString()}`);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; organization_id: string; title: string; status: string; priority: string; due_date: string | null; outcome: string | null;
    outcome_note: string | null; outcome_by: string | null; completed_at: string | null; created_by: string; updated_at: string; projects: { name: string } | null; task_assignees: { user_id: string }[];
  }[];
  const tasks = rows.map((t) => {
    const assignees = t.task_assignees.map((a) => a.user_id);
    return {
      id: t.id, orgId: t.organization_id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date,
      project: t.projects?.name ?? null, outcome: t.outcome, createdBy: t.created_by, assignees,
      own: assignees.length > 0 && assignees.every((a) => a === t.created_by), updatedAt: t.updated_at,
      outcomeNote: t.outcome_note, outcomeBy: t.outcome_by, completedAt: t.completed_at,
    };
  });
  const ids = [...new Set(tasks.flatMap((t) => [t.createdBy, ...t.assignees, ...(t.outcomeBy ? [t.outcomeBy] : [])]))];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
  const people = new Map(((profiles ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, { userId: p.id, name: p.display_name }]));
  return { tasks, people };
}
