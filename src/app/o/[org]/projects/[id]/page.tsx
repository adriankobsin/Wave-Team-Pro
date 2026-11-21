import type { Metadata } from "next";
import { CountrySelect, CurrencySelect } from "@/components/ui/region-select";
import { getHub, groupPeople } from "@/server/services/hub";
import { countryName } from "@/lib/regions";
import { buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { getStructure, listPeople } from "@/server/services/people";
import { listTasks } from "@/server/services/tasks";
import { addPeopleToProject, addProjectMember, createTask, moveProject, removeProjectMember, saveProject } from "@/server/actions/projects";
import { PROJECT_STATUS, PROJECT_TONE, STATUS_LABEL, TaskCard } from "@/components/projects/task-card";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ZoneSelect } from "@/components/ui/zone-select";
import { SubmitButton } from "@/components/ui/submit-button";
import { PersonLabel } from "@/components/ui/avatar";
import { Badge, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";
import { timeOf, todayIn } from "@/lib/time";
import { addProjectNote, removeProjectNote } from "@/server/actions/project-log";
import { NOTE_KIND } from "@/server/services/project-report";
import { TaskOverview, type OverviewTask } from "@/components/projects/task-overview";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ edit?: string; moved?: string }> }) {
  const { org: slug, id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project || project.organization_id !== ctx.org.id) notFound();

  const [{ data: canEdit }, { data: canAssign }, { data: members }, people, structure, tasks, { data: hoursRows }] = await Promise.all([
    supabase.rpc("can_edit_project", { p_project: id }),
    supabase.rpc("can_assign_in", { p_org: ctx.org.id, p_project: id }),
    supabase.from("project_members").select("membership_id, role").eq("project_id", id),
    listPeople(ctx.org.id, { includeInactive: true }),
    getStructure(ctx.org.id),
    listTasks(ctx.org.id, { projectId: id, includeDone: true }),
    supabase.rpc("project_hours", { p_project: id }),
  ]);
  // Companies this project can be moved to: the other companies where the viewer creates projects.
  const hub = await getHub();
  const others = (hub?.companies ?? []).filter((c) => c.id !== ctx.org.id);
  const movable = canEdit ? others : []; // the server checks rights in the target company
  const [{ data: spendRows }, { data: logRows }, { data: canLog }] = await Promise.all([
    supabase.rpc("project_expense_totals", { p_project: id }),
    supabase.from("project_notes").select("id, kind, title, body, supplier, reference, amount, currency, occurred_at, created_by, project_note_files(id, file_name, mime_type)")
      .eq("project_id", id).is("archived_at", null).order("occurred_at", { ascending: false }).limit(300),
    supabase.rpc("can_log_on_project", { p_project: id }),
  ]);
  const byUser = new Map(people.map((p) => [p.userId, p]));
  // Overview at the top: every task with who owns or completed it, and its latest note.
  const taskIds = tasks.map((t) => t.id);
  const [{ data: taskExtra }, { data: taskComments }, { data: taskPhotos }] = taskIds.length ? await Promise.all([
    supabase.from("tasks").select("id, outcome_by, outcome_at, outcome_note").in("id", taskIds),
    supabase.from("task_comments").select("task_id, author_id, body, created_at").in("task_id", taskIds).order("created_at", { ascending: false }).limit(2000),
    supabase.from("files").select("context_id").eq("context_type", "task").in("context_id", taskIds),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const extraOf = new Map(((taskExtra ?? []) as { id: string; outcome_by: string | null; outcome_at: string | null; outcome_note: string | null }[]).map((x) => [x.id, x]));
  const commentsOf = new Map<string, { author_id: string; body: string; created_at: string }[]>();
  for (const c of (taskComments ?? []) as { task_id: string; author_id: string; body: string; created_at: string }[]) commentsOf.set(c.task_id, [...(commentsOf.get(c.task_id) ?? []), c]);
  const photosOf = new Map<string, number>();
  for (const f of (taskPhotos ?? []) as { context_id: string }[]) photosOf.set(f.context_id, (photosOf.get(f.context_id) ?? 0) + 1);
  const overview: OverviewTask[] = tasks.map((t) => {
    const x = extraOf.get(t.id);
    const cs = commentsOf.get(t.id) ?? [];
    return {
      id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignees: t.assignees, outcome: t.outcome ?? null,
      outcome_by: x?.outcome_by ?? null, outcome_at: x?.outcome_at ?? null, outcome_note: x?.outcome_note ?? null,
      notes: cs.length, photos: photosOf.get(t.id) ?? 0,
      lastNote: cs[0] ? { author: byUser.get(cs[0].author_id)?.name ?? "Someone", body: cs[0].body, at: cs[0].created_at } : null,
    };
  });
  const log = (logRows ?? []) as { id: string; kind: string; title: string; body: string | null; supplier: string | null; reference: string | null; amount: number | null; currency: string | null; occurred_at: string; created_by: string; project_note_files: { id: string; file_name: string; mime_type: string }[] }[];
  // Reports: super admins and project managers (anyone who can edit this project) only.
  const canReport = Boolean(canEdit);
  // Hours, budget and spend are for management; the team sees tasks and the project log.
  const canSeeMoney = Boolean(canEdit) || ctx.perms.has("reports.view") || ctx.perms.has("projects.view");
  const spend = (spendRows ?? []) as { currency: string; total: number; reporting_currency: string | null; reporting_total: number | null; unconverted: number }[];
  const byMembership = new Map(people.map((p) => [p.membershipId, p]));
  const memberIds = new Set((members ?? []).map((m) => m.membership_id));
  // Hub users staff projects from the whole group; people from other companies join this one.
  const onTeam = new Set([...(members ?? []).map((m) => byMembership.get(m.membership_id)?.userId), project.manager_membership_id ? byMembership.get(project.manager_membership_id)?.userId : undefined].filter(Boolean));
  const groupCandidates = canEdit && hub ? (await groupPeople(hub.companies)).filter((p) => !onTeam.has(p.userId)) : [];
  // Project team first, then everyone else in the company.
  const assignable = people.filter((p) => p.status === "active")
    .sort((a, b) => Number(onTeam.has(b.userId)) - Number(onTeam.has(a.userId)) || a.name.localeCompare(b.name));
  const team = [...(project.manager_membership_id ? [{ membership_id: project.manager_membership_id, role: "manager" }] : []), ...(members ?? []).filter((m) => m.membership_id !== project.manager_membership_id)];
  const hours = ((hoursRows ?? []) as { approved: number; submitted: number }[])[0];
  const approvedHours = Number(hours?.approved ?? 0);
  const pendingHours = Number(hours?.submitted ?? 0);
  const today = todayIn(ctx.profile.timezone);
  const base = `/o/${ctx.org.slug}`;
  const columns = ["todo", "in_progress", "review", "done"] as const;

  return (
    <div className="space-y-6">
      <Link href={`${base}/projects`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Projects</Link>
      <PageHeader
        title={project.name}
        description={[ctx.org.name, project.code, project.site_label, project.country ? countryName(project.country) : null, project.cost_center ? `Cost centre ${project.cost_center}` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PROJECT_TONE[project.status as keyof typeof PROJECT_TONE]}>{PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]}</Badge>
            {canReport ? <a href={`${base}/projects/${id}/report`} className={buttonClass("secondary", "sm")}>Report (Excel)</a> : null}
            {canReport ? <a href={`${base}/projects/${id}/report?format=pdf`} className={buttonClass("secondary", "sm")}>Report (PDF)</a> : null}
            {canEdit ? <Link href="?edit=1#edit" className={buttonClass("secondary", "sm")}>Edit project</Link> : null}
          </div>
        }
      />
      {sp.moved === "moved" ? <Notice tone="ok" title={`Moved to ${ctx.org.name}`}>The project, its tasks and the team members who also work here came with it.</Notice> : null}
      {sp.moved === "copied" ? (
        <Notice tone="ok" title={`Now running under ${ctx.org.name}`}>
          Time and expenses were already booked on this project in its old company, so those stay there on the original, now marked completed. Book new work here.
        </Notice>
      ) : null}

      <TaskOverview tasks={overview} nameOf={(u) => byUser.get(u)?.name ?? "Former colleague"} href={(tid) => `${base}/tasks/${tid}`} today={today} tz={ctx.profile.timezone} />
      <p className="-mt-3 text-sm"><a href="#log" className="underline">Project log ({log.length})</a> · <a href="#board-h" className="underline">Task board</a></p>

      <div className="grid gap-4 sm:grid-cols-3">
        {canSeeMoney ? <>
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Approved hours</p><p className="display tabular mt-1 text-2xl font-semibold">{approvedHours.toFixed(1)}{project.budget_hours ? <span className="text-base font-normal text-ink-muted"> / {Number(project.budget_hours)} budget</span> : null}</p>{pendingHours ? <p className="text-xs text-ink-muted">{pendingHours.toFixed(1)} h awaiting approval</p> : null}</div></Panel>
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Budget</p><p className="display tabular mt-1 text-2xl font-semibold">{project.budget_amount !== null ? formatMoney(project.budget_amount, project.budget_currency) : "—"}</p>{spend.length ? (
          <p className="text-xs text-ink-muted">Approved expenses: {spend.map((x) => formatMoney(x.total, x.currency)).join(" + ")}{spend.some((x) => x.currency !== project.budget_currency) && spend.every((x) => !x.unconverted) && spend[0]?.reporting_currency ? ` (≈ ${formatMoney(spend.reduce((n, x) => n + Number(x.reporting_total ?? 0), 0), spend[0].reporting_currency)} converted)` : ""}</p>
        ) : <p className="text-xs text-ink-muted">No approved expenses yet.</p>}</div></Panel>
        </> : null}
        <Panel><div className="p-4"><p className="text-sm text-ink-muted">Tasks</p><p className="display tabular mt-1 text-2xl font-semibold">{tasks.filter((t) => t.status === "done").length} / {tasks.length} done</p></div></Panel>
      </div>

      {project.description ? <Panel><p className="max-w-prose whitespace-pre-wrap p-4 text-[0.9375rem] sm:p-5">{project.description}</p></Panel> : null}

      <section aria-labelledby="board-h">
        <h2 id="board-h" className="mb-3 text-lg font-semibold">Tasks</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((c) => {
            const list = tasks.filter((t) => t.status === c);
            if (c === "done") list.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
            return (
              <div key={c} className="rounded-lg bg-panel-sunk p-3">
                <p className="mb-2 flex justify-between text-sm font-medium">{STATUS_LABEL[c]}<span className="text-ink-muted tabular">{list.length}</span></p>
                <div className="space-y-2">
                  {(c === "done" ? list.slice(0, 8) : list).map((t) => <TaskCard key={t.id} task={t} people={byUser} href={`${base}/tasks/${t.id}`} today={today} />)}
                  {c === "done" && list.length > 8 ? (
                    <details>
                      <summary className="cursor-pointer py-1 text-xs text-ink-muted underline">Show {list.length - 8} older completed</summary>
                      <div className="mt-2 space-y-2">{list.slice(8).map((t) => <TaskCard key={t.id} task={t} people={byUser} href={`${base}/tasks/${t.id}`} today={today} />)}</div>
                    </details>
                  ) : null}
                  {!list.length ? <p className="py-3 text-center text-xs text-ink-muted">Empty</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="log-h" id="log" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="log-h" className="text-lg font-semibold">Project log ({log.length})</h2>
          <p className="text-sm text-ink-muted">Deliveries, orders, issues, meetings and notes, with date and time.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          {canLog ? (
            <Panel className="h-fit">
              <PanelHeader title="Add to the log" />
              <ActionForm action={addProjectNote} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="tz" value={ctx.profile.timezone} />
                <SelectField label="Type" name="kind" defaultValue="delivery">
                  {Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Date" name="date" type="date" required defaultValue={today} />
                  <TextField label="Time" name="time" type="time" required defaultValue={timeOf(new Date().toISOString(), ctx.profile.timezone)} />
                </div>
                <div className="sm:col-span-2"><TextField label="Title" name="title" required maxLength={200} placeholder="e.g. 40 × Wi-Fi access points delivered" /></div>
                <TextField label="Supplier / purchased from" name="supplier" optional maxLength={200} placeholder="e.g. CEF, Amazon, RS Components" />
                <TextField label="Reference" name="reference" optional maxLength={120} hint="Order, PO, invoice or tracking number" />
                <TextField label="Amount" name="amount" type="number" min={0} step="0.01" optional />
                <TextField label="Currency" name="currency" optional maxLength={3} defaultValue={project.budget_currency ?? ""} placeholder="GBP" />
                <div className="sm:col-span-2"><TextAreaField label="Details" name="body" optional rows={3} maxLength={8000} placeholder="What arrived or was ordered, condition, who received it, where it's stored" /></div>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium">Photos or PDFs</span> <span className="text-ink-muted">(optional, e.g. delivery note, order confirmation; up to 10)</span>
                  <input type="file" name="files" accept="image/*,application/pdf" multiple className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
                </label>
                <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Add to log</SubmitButton></div>
              </ActionForm>
            </Panel>
          ) : null}
          <Panel className={canLog ? "" : "lg:col-span-2"}>
            {log.length ? (
              <ol className="divide-y divide-line">
                {log.map((n) => (
                  <li key={n.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-ink-muted">
                          <Badge tone={n.kind === "delivery" ? "ok" : n.kind === "order" ? "warn" : n.kind === "issue" ? "danger" : "neutral"}>{NOTE_KIND[n.kind] ?? n.kind}</Badge>
                          <span className="ml-2">{formatDateTime(n.occurred_at, ctx.profile.timezone)} · {byUser.get(n.created_by)?.name ?? "Former colleague"}</span>
                        </p>
                        <p className="mt-1 font-medium">{n.title}</p>
                        {n.supplier || n.reference || n.amount !== null ? (
                          <p className="text-sm text-ink-muted">
                            {[n.supplier ? `From ${n.supplier}` : null, n.reference ? `Ref ${n.reference}` : null, n.amount !== null ? formatMoney(Number(n.amount), n.currency ?? project.budget_currency ?? "GBP") : null].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {n.body ? <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p> : null}
                        {n.project_note_files.length ? (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {n.project_note_files.map((f) => (
                              <li key={f.id}>
                                <a href={`${base}/projects/${id}/log/${f.id}`} target="_blank" rel="noreferrer" title={f.file_name}>
                                  {f.mime_type.startsWith("image/") && f.mime_type !== "image/heic" ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={`${base}/projects/${id}/log/${f.id}`} alt={f.file_name} loading="lazy" className="size-20 rounded-md border border-line object-cover" />
                                  ) : (
                                    <span className="flex size-20 items-center justify-center rounded-md border border-line bg-panel-sunk p-1 text-center text-[0.7rem]">{f.file_name}</span>
                                  )}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      {n.created_by === ctx.userId || canEdit ? (
                        <InlineActionForm action={removeProjectNote}>
                          <input type="hidden" name="id" value={n.id} />
                          <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                        </InlineActionForm>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="p-6 text-center text-sm text-ink-muted">Nothing logged yet. Add deliveries, orders and notes here so the whole team can see them.</p>}
          </Panel>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {canAssign || ctx.perms.has("work.self_manage") ? (
        <Panel>
          <PanelHeader title="Add a task" />
          <ActionForm action={createTask} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <input type="hidden" name="project_id" value={id} />
            <div className="sm:col-span-2"><TextField label="Title" name="title" required maxLength={200} /></div>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">Assign to <span className="font-normal text-ink-muted">(tick everyone who works on it)</span></legend>
              <div className="mt-1.5 max-h-60 space-y-1.5 overflow-y-auto rounded-md border border-line p-2">
                {(canAssign ? assignable : people.filter((p) => p.userId === ctx.userId)).map((p) => (
                  <label key={p.userId} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" name="assignees" value={p.userId} className="size-5" />
                    <span>{p.userId === ctx.userId ? "Me" : p.name}</span>
                    {onTeam.has(p.userId) ? <span className="text-xs text-ink-muted">project team</span> : p.jobTitle ? <span className="text-xs text-ink-muted">{p.jobTitle}</span> : null}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-muted">Leave all unticked to add it unassigned. Everyone ticked is notified.</p>
            </fieldset>
            <SelectField label="Priority" name="priority" defaultValue="normal">
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </SelectField>
            <TextField label="Due" name="due_date" type="date" optional />
            <TextField label="Estimate (hours)" name="estimate_hours" type="number" min={0} step="0.5" optional />
            <div className="sm:col-span-2"><TextAreaField label="Details" name="description" optional rows={2} maxLength={8000} /></div>
            <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Adding…">Add task</SubmitButton></div>
          </ActionForm>
        </Panel>
        ) : null}

        <Panel>
          <PanelHeader title="Project team" />
          <ul className="divide-y divide-line">
            {team.map((m) => {
              const p = byMembership.get(m.membership_id);
              return (
                <li key={m.membership_id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <PersonLabel id={p?.userId ?? m.membership_id} name={p?.name ?? "Former colleague"} src={p?.avatarUrl} sub={m.role === "manager" ? "Project manager" : m.role === "lead" ? "Lead" : p?.jobTitle} inactive={p?.status !== "active"} />
                  {canEdit && m.role !== "manager" ? (
                    <InlineActionForm action={removeProjectMember}>
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                    </InlineActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canEdit && hub ? (
            <ActionForm action={addPeopleToProject} className="space-y-2 border-t border-line p-4" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="project_id" value={id} />
              <p className="text-sm font-medium">Add people</p>
              <p className="text-xs text-ink-muted">From any company in the group. Anyone not in {ctx.org.name} yet is added to it as Employee.</p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-line p-2">
                {groupCandidates.map((p) => (
                  <label key={p.userId} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="members" value={p.userId} className="mt-0.5 size-4" />
                    <span>{p.name}<span className="block text-xs text-ink-muted">{[p.jobTitle, p.companies.map((c) => c.name).join(", ")].filter(Boolean).join(" · ")}</span></span>
                  </label>
                ))}
                {!groupCandidates.length ? <p className="text-sm text-ink-muted">Everyone is already on this project.</p> : null}
              </div>
              <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">Add to team</SubmitButton>
            </ActionForm>
          ) : canEdit ? (
            <ActionForm action={addProjectMember} className="flex flex-wrap items-end gap-3 border-t border-line p-4" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="project_id" value={id} />
              <div className="min-w-44 flex-1">
                <SelectField label="Add person" name="membership_id" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {people.filter((p) => p.status === "active" && !memberIds.has(p.membershipId) && p.membershipId !== project.manager_membership_id).map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
                </SelectField>
              </div>
              <SelectField label="Role" name="role" defaultValue="member"><option value="member">Member</option><option value="lead">Lead</option></SelectField>
              <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
            </ActionForm>
          ) : null}
        </Panel>
      </div>

      {canEdit ? (
        <Panel id="edit">
          <details open={sp.edit === "1"}>
            <summary className="cursor-pointer px-4 py-3 font-semibold sm:px-5">Edit project details</summary>
            <ActionForm action={saveProject} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 sm:p-5">
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="org_slug" value={ctx.org.slug} />
              <input type="hidden" name="id" value={id} />
              <TextField label="Name" name="name" required defaultValue={project.name} maxLength={120} />
              <TextField label="Code" name="code" optional defaultValue={project.code ?? ""} maxLength={32} />
              <SelectField label="Status" name="status" defaultValue={project.status}>
                {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectField>
              <TextField label="Site / location" name="site_label" optional defaultValue={project.site_label ?? ""} maxLength={160} />
              <CountrySelect label="Country" name="country" optional defaultValue={project.country ?? ""} />
              <ZoneSelect defaultValue={project.timezone ?? ctx.org.timezone} hint="Clock-ins on this project show in this time zone." />
              <SelectField label="Project manager" name="manager_membership_id" optional defaultValue={project.manager_membership_id ?? ""}>
                <option value="">—</option>
                {people.filter((p) => p.status === "active").map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
              </SelectField>
              <SelectField label="Team" name="team_id" optional defaultValue={project.team_id ?? ""}>
                <option value="">—</option>
                {structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
              <TextField label="Start" name="start_date" type="date" optional defaultValue={project.start_date ?? ""} />
              <TextField label="End" name="end_date" type="date" optional defaultValue={project.end_date ?? ""} />
              <TextField label="Budget hours" name="budget_hours" type="number" min={0} step="0.5" optional defaultValue={project.budget_hours ?? ""} />
              <TextField label="Cost centre" name="cost_center" optional defaultValue={project.cost_center ?? ""} maxLength={64} />
              <TextField label="Budget amount" name="budget_amount" type="number" min={0} step="0.01" optional defaultValue={project.budget_amount ?? ""} />
              <CurrencySelect label="Budget currency" name="budget_currency" optional defaultValue={project.budget_currency ?? ctx.org.base_currency} />
              <div className="sm:col-span-2"><TextAreaField label="Description" name="description" optional rows={3} defaultValue={project.description ?? ""} maxLength={4000} /></div>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save project</SubmitButton></div>
            </ActionForm>
            {movable.length ? (
              <ActionForm action={moveProject} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_auto] sm:items-end sm:p-5">
                <input type="hidden" name="project_id" value={id} />
                <SelectField label="Company" name="target_org" defaultValue="" required hint={`Now under ${ctx.org.name}. Moving takes its tasks along; past time and expenses stay booked where they were.`}>
                  <option value="" disabled>Move to…</option>
                  {movable.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.location})</option>)}
                </SelectField>
                <SubmitButton variant="secondary" pendingLabel="Moving…">Move project</SubmitButton>
              </ActionForm>
            ) : null}
          </details>
        </Panel>
      ) : null}
    </div>
  );
}
