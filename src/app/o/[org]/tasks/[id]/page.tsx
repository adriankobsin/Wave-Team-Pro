import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { addChecklistItem, addTaskNote, assignTask, reportTask, toggleChecklistItem, updateTask } from "@/server/actions/projects";
import { STATUS_LABEL } from "@/components/projects/task-card";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar, PersonLabel } from "@/components/ui/avatar";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (!task || task.organization_id !== ctx.org.id) notFound();
  const [{ data: assignees }, { data: checklist }, { data: comments }, { data: canWork }, { data: canAssign }, { data: project }, people, { data: photos }] = await Promise.all([
    supabase.from("task_assignees").select("user_id").eq("task_id", id),
    supabase.from("task_checklist_items").select("id, title, done").eq("task_id", id).order("position"),
    supabase.from("task_comments").select("id, author_id, body, created_at").eq("task_id", id).order("created_at"),
    supabase.rpc("can_work_on_task", { p_task: id }),
    supabase.rpc("can_assign_in", { p_org: ctx.org.id, p_project: task.project_id }),
    task.project_id ? supabase.from("projects").select("id, name").eq("id", task.project_id).maybeSingle() : Promise.resolve({ data: null }),
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.from("files").select("id, file_name, mime_type, uploaded_by, created_at").eq("context_type", "task").eq("context_id", id).order("created_at"),
  ]);
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const assigned = new Set((assignees ?? []).map((a) => a.user_id));
  // Staff who add their own task assign only themselves; managers (and trusted self-managers) anyone.
  const mayAssignOthers = Boolean(canAssign) || (task.created_by === ctx.userId && ctx.perms.has("work.self_manage"));
  const base = `/o/${ctx.org.slug}`;
  const creator = byUser.get(task.created_by);
  // Management edits the task; the people doing it report back, add notes and photos.
  const canEdit = Boolean(canAssign) || task.created_by === ctx.userId;
  const reporter = task.outcome_by ? byUser.get(task.outcome_by) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="text-sm text-ink-muted">
        {project ? <Link href={`${base}/projects/${project.id}`} className="hover:underline">{project.name}</Link> : <Link href={`${base}/tasks`} className="hover:underline">My tasks</Link>}
      </nav>
      <PageHeader title={task.title} description={creator ? `Created by ${creator.name}, ${formatDateTime(task.created_at, ctx.profile.timezone)}` : undefined} />

      {task.outcome || (task.outcome_at && task.status === "in_progress") ? (
        <Notice tone={task.outcome === "completed" ? "ok" : task.outcome === "not_completed" ? "danger" : "warn"} title={`${task.outcome === "completed" ? "Completed" : task.outcome === "not_completed" ? "Not completed" : "In progress"}${reporter ? ` — reported by ${reporter.name}` : ""}${task.outcome_at ? `, ${formatDateTime(task.outcome_at, ctx.profile.timezone)}` : ""}`}>
          {task.outcome_note ? <span className="whitespace-pre-wrap">{task.outcome_note}</span> : "No notes."}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {canWork ? (
            <Panel>
              <PanelHeader title={task.outcome ? "Update your report" : "Report back"} description="Tell whoever set the task how it went. They're notified straight away." />
              <ActionForm action={reportTask} className="space-y-3 p-4" resetOnSuccess>
                <input type="hidden" name="task_id" value={id} />
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="sr-only">Outcome</legend>
                  <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-ok has-[:checked]:bg-ok-soft">
                    <input type="radio" name="outcome" value="completed" required className="size-4" /> Completed
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-brass has-[:checked]:bg-brass-soft">
                    <input type="radio" name="outcome" value="in_progress" required className="size-4" /> In progress
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
                    <input type="radio" name="outcome" value="not_completed" required className="size-4" /> Not completed
                  </label>
                </fieldset>
                <TextAreaField label="Notes and reasoning" name="note" optional rows={3} maxLength={4000} hint="What you've done so far. Required if not completed: say what's left and why." />
                <label className="block text-sm">
                  <span className="font-medium">Photos</span> <span className="text-ink-muted">(optional, up to 10)</span>
                  <input type="file" name="photos" accept="image/*,application/pdf" multiple className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
                </label>
                <SubmitButton pendingLabel="Sending…">Send report</SubmitButton>
              </ActionForm>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Details" />
            {canEdit ? (
              <ActionForm action={updateTask} className="grid gap-3 p-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <div className="sm:col-span-2"><TextField label="Title" name="title" required defaultValue={task.title} maxLength={200} /></div>
                <SelectField label="Status" name="status" defaultValue={task.status}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <SelectField label="Priority" name="priority" defaultValue={task.priority}>
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </SelectField>
                <TextField label="Due" name="due_date" type="date" optional defaultValue={task.due_date ?? ""} />
                <TextField label="Estimate (hours)" name="estimate_hours" type="number" min={0} step="0.5" optional defaultValue={task.estimate_hours ?? ""} />
                <div className="sm:col-span-2"><TextAreaField label="Description" name="description" optional rows={4} defaultValue={task.description ?? ""} maxLength={8000} /></div>
                <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
              </ActionForm>
            ) : (
              <div className="space-y-2 p-4 text-sm">
                <p>Status: <strong>{STATUS_LABEL[task.status]}</strong> · Priority: {task.priority}{task.due_date ? ` · Due ${task.due_date}` : ""}</p>
                {task.description ? <><p className="font-medium">Instructions</p><p className="whitespace-pre-wrap">{task.description}</p></> : null}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Checklist" />
            <ul className="divide-y divide-line">
              {(checklist ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                  {canWork ? (
                    <InlineActionForm action={toggleChecklistItem}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="done" value={c.done ? "0" : "1"} />
                      <button type="submit" aria-pressed={c.done} aria-label={c.done ? `Mark “${c.title}” not done` : `Mark “${c.title}” done`} className={`size-5 rounded border ${c.done ? "border-ok bg-ok text-white" : "border-line"} text-xs`}>{c.done ? "✓" : ""}</button>
                    </InlineActionForm>
                  ) : <span aria-hidden>{c.done ? "☑" : "☐"}</span>}
                  <span className={`flex-1 text-sm ${c.done ? "text-ink-muted line-through" : ""}`}>{c.title}</span>
                  {canWork ? (
                    <InlineActionForm action={toggleChecklistItem}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="done" value="0" />
                      <input type="hidden" name="remove" value="1" />
                      <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                    </InlineActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {canWork ? (
              <ActionForm action={addChecklistItem} className="flex items-end gap-2 border-t border-line p-4" resetOnSuccess hideMessage>
                <input type="hidden" name="task_id" value={id} />
                <div className="flex-1"><TextField label="New item" name="title" required maxLength={200} /></div>
                <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
              </ActionForm>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title={`Notes and photos (${(comments?.length ?? 0) + (photos?.length ?? 0)})`} />
            {(photos ?? []).length ? (
              <ul className="grid grid-cols-3 gap-2 border-b border-line p-4 sm:grid-cols-4">
                {(photos ?? []).map((f) => (
                  <li key={f.id}>
                    <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="block" title={`${f.file_name} — ${byUser.get(f.uploaded_by)?.name ?? ""}`}>
                      {f.mime_type.startsWith("image/") && f.mime_type !== "image/heic" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/files/${f.id}`} alt={f.file_name} loading="lazy" className="aspect-square w-full rounded-md border border-line object-cover" />
                      ) : (
                        <span className="flex aspect-square w-full items-center justify-center rounded-md border border-line bg-panel-sunk p-2 text-center text-xs">{f.file_name}</span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <ol className="divide-y divide-line">
              {(comments ?? []).map((c) => {
                const a = byUser.get(c.author_id);
                return (
                  <li key={c.id} className="flex gap-3 px-4 py-3 sm:px-5">
                    <Avatar id={c.author_id} name={a?.name ?? "?"} src={a?.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm"><strong>{a?.name ?? "Former colleague"}</strong> <span className="text-xs text-ink-muted">{formatDateTime(c.created_at, ctx.profile.timezone)}</span></p>
                      <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <ActionForm action={addTaskNote} className="space-y-2 border-t border-line p-4" resetOnSuccess>
              <input type="hidden" name="task_id" value={id} />
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <TextAreaField label="Add a note" name="body" optional rows={2} maxLength={4000} />
              {canWork ? (
                <label className="block text-sm">
                  <span className="font-medium">Photos</span>
                  <input type="file" name="photos" accept="image/*,application/pdf" multiple className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
                </label>
              ) : null}
              <SubmitButton size="sm" variant="secondary" pendingLabel="Posting…">Post</SubmitButton>
            </ActionForm>
          </Panel>
        </div>

        <Panel className="h-fit">
          <PanelHeader title="Assigned to" />
          <ul className="divide-y divide-line">
            {[...assigned].map((u) => {
              const p = byUser.get(u);
              return (
                <li key={u} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <PersonLabel id={u} name={p?.name ?? "Former colleague"} src={p?.avatarUrl} sub={p?.jobTitle} inactive={p?.status !== "active"} />
                  {mayAssignOthers || u === ctx.userId ? (
                    <InlineActionForm action={assignTask}>
                      <input type="hidden" name="task_id" value={id} />
                      <input type="hidden" name="organization_id" value={ctx.org.id} />
                      <input type="hidden" name="user_id" value={u} />
                      <input type="hidden" name="remove" value="1" />
                      <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                    </InlineActionForm>
                  ) : null}
                </li>
              );
            })}
            {!assigned.size ? <li className="px-4 py-3 text-sm text-ink-muted">Nobody yet.</li> : null}
          </ul>
          {canEdit ? (
            <ActionForm action={assignTask} className="flex items-end gap-2 border-t border-line p-4" hideMessage>
              <input type="hidden" name="task_id" value={id} />
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <div className="flex-1">
                <SelectField label="Assign" name="user_id" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {(mayAssignOthers ? people.filter((p) => p.status === "active" && !assigned.has(p.userId)) : people.filter((p) => p.userId === ctx.userId && !assigned.has(p.userId))).map((p) => <option key={p.userId} value={p.userId}>{p.userId === ctx.userId ? "Me" : p.name}</option>)}
                </SelectField>
              </div>
              <SubmitButton size="sm" variant="secondary">Add</SubmitButton>
            </ActionForm>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
