import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listTasks, myTaskIds } from "@/server/services/tasks";
import { createTask } from "@/server/actions/projects";
import { STATUS_LABEL, TaskCard } from "@/components/projects/task-card";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { buttonClass } from "@/components/ui/button";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const ids = await myTaskIds(ctx.userId);
  const canAssign = ctx.perms.has("work.self_manage") || ctx.perms.hasAnyScope("tasks.assign");
  const canSeeAll = ctx.perms.has("tasks.view.all");
  const [tasks, people, { data: projects }, setByMe] = await Promise.all([
    listTasks(ctx.org.id, { ids }),
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id).in("status", ["planning", "active", "on_hold"]).order("name"),
    canAssign ? listTasks(ctx.org.id, { createdBy: ctx.userId, includeDone: true }) : Promise.resolve([]),
  ]);
  // Tasks this manager handed to other people, with how each one was reported back.
  const delegated = setByMe.filter((t) => t.assignees.some((u) => u !== ctx.userId));
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const today = todayIn(ctx.profile.timezone);
  const open = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const done = tasks.filter((t) => t.status === "done");
  const groups = [
    { title: "Overdue", items: open.filter((t) => t.due_date && t.due_date < today) },
    { title: "Due today", items: open.filter((t) => t.due_date === today) },
    { title: "Upcoming", items: open.filter((t) => !t.due_date || t.due_date > today) },
  ];
  const base = `/o/${ctx.org.slug}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My tasks"
        description={canAssign ? "Assign tasks to your people, follow up on what they report back, and keep your own list." : "Everything assigned to you, plus tasks you add yourself. Open a task to add notes and photos, and report it completed, in progress or not completed."}
        actions={canSeeAll ? <Link href={`${base}/tasks/team`} className={buttonClass("secondary")}>Team tasks</Link> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {groups.map((g) => g.items.length ? (
            <section key={g.title} aria-label={g.title}>
              <h2 className="mb-2 text-sm font-medium text-ink-muted">{g.title} ({g.items.length})</h2>
              <div className="space-y-2">
                {g.items.map((t) => (
                  <div key={t.id}>
                    {t.project_id ? <p className="mb-0.5 text-xs text-ink-muted">{projectName.get(t.project_id) ?? "Project"} · {STATUS_LABEL[t.status]}</p> : <p className="mb-0.5 text-xs text-ink-muted">Personal · {STATUS_LABEL[t.status]}</p>}
                    <TaskCard task={t} people={byUser} href={`${base}/tasks/${t.id}`} today={today} />
                  </div>
                ))}
              </div>
            </section>
          ) : null)}
          {!open.length ? <Panel><EmptyState title="Nothing on your list">Tasks assigned to you, and tasks you add, will appear here.</EmptyState></Panel> : null}
          {done.length ? (
            <details>
              <summary className="cursor-pointer text-sm text-ink-muted">Recently completed ({done.length})</summary>
              <div className="mt-2 space-y-2">{done.map((t) => <TaskCard key={t.id} task={t} people={byUser} href={`${base}/tasks/${t.id}`} today={today} />)}</div>
            </details>
          ) : null}
        </div>
        {canAssign ? (
        <div className="space-y-6">
          <Panel className="h-fit">
            <PanelHeader title="Assign a task" description="The people you pick get a notification and see it on their Tasks page." />
            <ActionForm action={createTask} className="space-y-3 p-4" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <TextField label="Task" name="title" required maxLength={200} placeholder="Install RJ45 sockets in crew cabins" />
              <TextAreaField label="Instructions" name="description" optional rows={3} maxLength={8000} />
              <SelectField label="Project" name="project_id" optional defaultValue="" hint="Leave empty for a general task">
                <option value="">No project</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <fieldset>
                <legend className="text-sm font-medium">Assign to</legend>
                <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-line p-2">
                  {people.filter((p) => p.status === "active").sort((a, b) => (a.userId === ctx.userId ? 1 : b.userId === ctx.userId ? -1 : a.name.localeCompare(b.name))).map((p) => (
                    <label key={p.userId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="assignees" value={p.userId} className="size-4" />
                      <span>{p.userId === ctx.userId ? "Me" : p.name}</span>
                      {p.jobTitle ? <span className="text-xs text-ink-muted">{p.jobTitle}</span> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Priority" name="priority" defaultValue="normal">
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </SelectField>
                <TextField label="Due" name="due_date" type="date" optional />
              </div>
              <SubmitButton pendingLabel="Sending…">Send task</SubmitButton>
            </ActionForm>
          </Panel>
          {delegated.length ? (
            <Panel className="h-fit">
              <PanelHeader title={`Tasks you've set (${delegated.length})`} />
              <ul className="divide-y divide-line">
                {delegated.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`${base}/tasks/${t.id}`} className="min-w-0 font-medium hover:underline">{t.title}</Link>
                      {t.outcome === "completed" ? <Badge tone="ok">Completed</Badge> : t.outcome === "not_completed" ? <Badge tone="danger">Not completed</Badge> : t.status === "in_progress" ? <Badge tone="warn">In progress</Badge> : <Badge>{STATUS_LABEL[t.status]}</Badge>}
                    </div>
                    <p className="text-xs text-ink-muted">{t.assignees.map((u) => byUser.get(u)?.name ?? "Someone").join(", ")}{t.due_date ? ` · due ${t.due_date}` : ""}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        ) : (
          <Panel className="h-fit">
            <PanelHeader title="Add my own task" description="Only you and your managers see it. Open it afterwards to add notes and photos, and report it." />
            <ActionForm action={createTask} className="space-y-3 p-4" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="assignees" value={ctx.userId} />
              <TextField label="Task" name="title" required maxLength={200} placeholder="Check spare RJ45 stock" />
              <TextAreaField label="Notes" name="description" optional rows={3} maxLength={8000} />
              <SelectField label="Project" name="project_id" optional defaultValue="" hint="Only projects you're on">
                <option value="">No project (personal)</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Priority" name="priority" defaultValue="normal">
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </SelectField>
                <TextField label="Due" name="due_date" type="date" optional />
              </div>
              <SubmitButton pendingLabel="Adding…">Add task</SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </div>
  );
}
