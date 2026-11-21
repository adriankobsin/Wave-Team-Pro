import "server-only";
import { BRAND } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphConfigured, GraphError } from "@/lib/sharepoint/graph";
import * as g from "@/lib/m365/graph";
import {
  contentHash, dateToPlanner, diffMembers, diffTasks, groupName, groupNickname, priorityToPlanner, reconcileStatus, renderUpdates,
  selectProjectMembers, sha, statusToPercent, taskContent,
  type HubPriority, type HubStatus, type HubTaskView, type LogEntry, type MemberCandidate, type MemberSelection, type PlannerTaskView, type TaskLink, type TenantUser,
} from "@/lib/m365/sync-logic";
import { serverEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";

// Microsoft 365 project sync (see docs/deploy/microsoft-365.md): per project a private group + Planner plan;
// Hub tasks, the project log and the project dates are mirrored into it; completion is two-way.

type Admin = ReturnType<typeof createAdminClient>;

const BUCKETS = { tasks: "Tasks", updates: "Updates", dates: "Dates" } as const;
const SYNC_STATUSES = ["planning", "active"];

type Pinned = Record<string, { id: string; hash: string }>;
type LinkRow = {
  project_id: string; group_id: string | null; plan_id: string | null; bucket_ids: Record<string, string>; pinned: Pinned;
  managed_member_ids: string[]; last_synced_at: string | null;
};

export type ProjectReport = {
  project: string;
  members: { added: number; removed: number; total: number };
  excluded: { name: string; reason: string }[];
  skipped: { name: string; email: string | null; reason: string }[];
  tasks: { created: number; updated: number; removed: number; completedInHub: number; completedInPlanner: number; unchanged: number };
  warnings: string[];
  partial?: boolean;
};

export type SyncSummary = { ok: boolean; skipped?: string; orgs: number; projects: number; failed: number; remaining: number; errors: { project: string; error: string }[] };

type RunCtx = { admin: Admin; deadline: number; tenant: Map<string, TenantUser | null>; baseUrl: string };

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const plannerDate = dateToPlanner;

/** Cron + "Sync now": syncs every company with the setting on (or just `orgId`). Never throws. */
export async function runM365Sync(opts: { budgetMs?: number; orgId?: string } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { ok: true, orgs: 0, projects: 0, failed: 0, remaining: 0, errors: [] };
  if (!graphConfigured()) return { ...summary, ok: false, skipped: "not_configured" };
  const admin = createAdminClient();
  const ctx: RunCtx = { admin, deadline: Date.now() + (opts.budgetMs ?? 240_000), tenant: new Map(), baseUrl: serverEnv().APP_BASE_URL.replace(/\/$/, "") };
  let q = admin.from("m365_sync_settings").select("organization_id").eq("enabled", true);
  if (opts.orgId) q = q.eq("organization_id", opts.orgId);
  const { data: orgs, error } = await q;
  if (error) { logServerError("m365-sync settings", error); return { ...summary, ok: false, skipped: "settings_unreadable" }; }
  for (const o of orgs ?? []) {
    summary.orgs++;
    try { await syncOrg(ctx, o.organization_id as string, summary); }
    catch (e) { logServerError(`m365-sync org ${o.organization_id}`, e); summary.failed++; summary.errors.push({ project: `org ${o.organization_id}`, error: errText(e) }); }
  }
  summary.ok = summary.failed === 0;
  return summary;
}

async function syncOrg(ctx: RunCtx, orgId: string, summary: SyncSummary) {
  const { admin } = ctx;
  const { data: org } = await admin.from("organizations").select("slug").eq("id", orgId).single();
  const slug = org?.slug as string;
  const { data: st } = await admin.from("m365_sync_settings").select("project_ids").eq("organization_id", orgId).maybeSingle();
  const only = ((st as { project_ids?: string[] | null } | null)?.project_ids ?? null);
  let pq = admin.from("projects")
    .select("id, name, description, status, start_date, end_date, manager_membership_id")
    .eq("organization_id", orgId).is("archived_at", null).in("status", SYNC_STATUSES);
  if (only && only.length) pq = pq.in("id", only);
  const { data: projects } = await pq;
  const { data: linkRows } = await admin.from("project_m365_links").select("*").eq("organization_id", orgId);
  const links = new Map((linkRows ?? []).map((l) => [l.project_id as string, l as unknown as LinkRow]));
  // Least recently synced first, so a run that runs out of time resumes where it stopped.
  const list = [...(projects ?? [])].sort((a, b) => (links.get(a.id)?.last_synced_at ?? "").localeCompare(links.get(b.id)?.last_synced_at ?? ""));
  const reports: Record<string, ProjectReport> = {};
  const errors: { project: string; error: string }[] = [];
  let done = 0;
  for (const p of list) {
    if (Date.now() > ctx.deadline) { summary.remaining += list.length - done; break; }
    done++;
    summary.projects++;
    const link: LinkRow = links.get(p.id) ?? { project_id: p.id, group_id: null, plan_id: null, bucket_ids: {}, pinned: {}, managed_member_ids: [], last_synced_at: null };
    try {
      const report = await syncProject(ctx, orgId, slug, p as ProjectRow, link);
      reports[p.id] = report;
      await saveLink(admin, orgId, link, { report, last_error: null, last_synced_at: new Date().toISOString() });
    } catch (e) {
      logServerError(`m365-sync project ${p.id}`, e);
      summary.failed++;
      errors.push({ project: p.name as string, error: errText(e) });
      summary.errors.push({ project: p.name as string, error: errText(e) });
      await saveLink(admin, orgId, link, { last_error: errText(e) }).catch(() => undefined);
    }
  }
  await admin.from("m365_sync_settings").update({ last_run_at: new Date().toISOString(), last_report: { at: new Date().toISOString(), projects: done, failed: errors.length, remaining: list.length - done, errors } }).eq("organization_id", orgId);
}

type ProjectRow = { id: string; name: string; description: string | null; status: string; start_date: string | null; end_date: string | null; manager_membership_id: string | null };

async function saveLink(admin: Admin, orgId: string, link: LinkRow, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from("project_m365_links").upsert({
    project_id: link.project_id, organization_id: orgId, group_id: link.group_id, plan_id: link.plan_id, bucket_ids: link.bucket_ids, pinned: link.pinned,
    managed_member_ids: link.managed_member_ids, updated_at: new Date().toISOString(), ...extra,
  }, { onConflict: "project_id" });
  if (error) throw new Error(`Saving the Microsoft 365 link failed: ${error.message}`);
}

// ---------------------------------------------------------------------------

async function loadCandidates(admin: Admin, orgId: string, project: ProjectRow): Promise<MemberCandidate[]> {
  const ids = new Set<string>();
  const [{ data: pm }, { data: assigned }] = await Promise.all([
    admin.from("project_members").select("membership_id").eq("project_id", project.id),
    admin.from("organization_memberships").select("id").eq("organization_id", orgId).eq("assigned_project_id", project.id),
  ]);
  for (const r of pm ?? []) ids.add(r.membership_id as string);
  for (const r of assigned ?? []) ids.add(r.id as string);
  if (project.manager_membership_id) ids.add(project.manager_membership_id);
  if (!ids.size) return [];
  const { data: ms } = await admin.from("organization_memberships").select("id, user_id, job_title").in("id", [...ids]).eq("status", "active");
  const members = ms ?? [];
  if (!members.length) return [];
  const [{ data: profiles }, { data: assignments }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id, display_name, email_display, status").in("id", members.map((m) => m.user_id as string)),
    admin.from("membership_role_assignments").select("membership_id, role_id").in("membership_id", members.map((m) => m.id as string)),
    admin.from("roles").select("id, key, name").eq("organization_id", orgId),
  ]);
  const profileOf = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const roleOf = new Map((roles ?? []).map((r) => [r.id as string, [r.key as string, r.name as string]]));
  const out: MemberCandidate[] = [];
  for (const m of members) {
    const p = profileOf.get(m.user_id as string);
    if (!p || p.status !== "active") continue;
    let email = p.email_display ? String(p.email_display) : null;
    if (!email) {
      const { data } = await admin.auth.admin.getUserById(m.user_id as string);
      email = data.user?.email ?? null;
    }
    const names = (assignments ?? []).filter((a) => a.membership_id === m.id).flatMap((a) => roleOf.get(a.role_id as string) ?? []);
    out.push({ userId: m.user_id as string, displayName: p.display_name as string, email, jobTitle: (m.job_title as string) ?? null, roles: names });
  }
  return out;
}

async function lookupTenant(ctx: RunCtx, emails: string[]): Promise<Map<string, TenantUser>> {
  const todo = [...new Set(emails)].filter((e) => !ctx.tenant.has(e));
  if (todo.length) {
    const found = await g.findUsersByEmail(todo); // throws if incomplete: never guess "not in tenant"
    for (const e of todo) ctx.tenant.set(e, found.get(e) ?? null);
  }
  const out = new Map<string, TenantUser>();
  for (const e of emails) { const u = ctx.tenant.get(e); if (u) out.set(e, u); }
  return out;
}

async function syncProject(ctx: RunCtx, orgId: string, slug: string, project: ProjectRow, link: LinkRow): Promise<ProjectReport> {
  const { admin } = ctx;
  const report: ProjectReport = {
    project: project.name, members: { added: 0, removed: 0, total: 0 }, excluded: [], skipped: [],
    tasks: { created: 0, updated: 0, removed: 0, completedInHub: 0, completedInPlanner: 0, unchanged: 0 }, warnings: [],
  };

  // 1. Who should be in the group
  const candidates = await loadCandidates(admin, orgId, project);
  const tenant = await lookupTenant(ctx, candidates.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)));
  const sel = selectProjectMembers(candidates, tenant);
  report.excluded = sel.excluded.map((x) => ({ name: x.displayName, reason: x.reason.toUpperCase() }));
  report.skipped = sel.skipped.map((x) => ({ name: x.displayName, email: x.email, reason: x.reason }));

  // 2. Group (find by alias first, so a lost link never creates a duplicate)
  const nickname = groupNickname(project.name, project.id);
  if (!link.group_id) {
    link.group_id = (await g.findGroupByNickname(nickname)) ?? (await g.createGroup(groupName(project.name), nickname, project.description ?? `${BRAND.product} project ${project.name}`));
    await saveLink(admin, orgId, link);
  }
  const groupId = link.group_id;

  // 3. Members
  const current = await g.listMemberIds(groupId);
  const diff = diffMembers(current, sel.include.map((m) => m.aadId), link.managed_member_ids);
  const managed = new Set(link.managed_member_ids);
  for (const id of diff.add) {
    try { await g.addMember(groupId, id); report.members.added++; managed.add(id); }
    catch (e) { report.warnings.push(`Couldn't add a member: ${errText(e)}`); }
  }
  for (const id of diff.remove) {
    try { await g.removeMember(groupId, id); report.members.removed++; managed.delete(id); }
    catch (e) { report.warnings.push(`Couldn't remove a member: ${errText(e)}`); }
  }
  link.managed_member_ids = [...managed];
  report.members.total = sel.include.length;
  await saveLink(admin, orgId, link);

  // 4. Plan and buckets (a brand-new group can take a moment before Planner accepts it)
  if (!link.plan_id) {
    link.plan_id = await g.findPlanForGroup(groupId);
    for (let attempt = 0; !link.plan_id; attempt++) {
      try { link.plan_id = await g.createPlan(groupId, groupName(project.name)); }
      catch (e) {
        const notReady = e instanceof GraphError && (e.status === 403 || e.status === 404);
        if (!notReady || attempt >= 2) throw new Error(notReady ? "The new group isn't ready for Planner yet; trying again on the next run." : errText(e));
        await g.sleep(6000);
      }
    }
    await saveLink(admin, orgId, link);
  }
  const planId = link.plan_id;
  if (!link.bucket_ids.Tasks || !link.bucket_ids.Updates || !link.bucket_ids.Dates) {
    link.bucket_ids = await g.ensureBuckets(planId, Object.values(BUCKETS));
    await saveLink(admin, orgId, link);
  }

  // 5. Tasks, then the project log and dates
  await syncTasks(ctx, orgId, slug, project, link, sel, report);
  if (Date.now() > ctx.deadline) { report.partial = true; return report; }
  await syncPinned(ctx, orgId, slug, project, link, sel, report);
  return report;
}

// ---------------------------------------------------------------------------

async function syncTasks(ctx: RunCtx, orgId: string, slug: string, project: ProjectRow, link: LinkRow, sel: MemberSelection, report: ProjectReport) {
  const { admin } = ctx;
  const planId = link.plan_id!;
  const bucket = link.bucket_ids.Tasks;
  const taskUrl = (id: string) => `${ctx.baseUrl}/o/${slug}/tasks/${id}`;
  const aadOf = new Map(sel.include.map((m) => [m.userId, m.aadId]));

  const { data: rows } = await admin.from("tasks").select("id, title, description, status, priority, due_date, updated_at, archived_at").eq("project_id", project.id);
  const taskRows = rows ?? [];
  const assignees = new Map<string, string[]>();
  for (const ids of chunk(taskRows.map((t) => t.id as string), 150)) {
    const { data } = await admin.from("task_assignees").select("task_id, user_id").in("task_id", ids);
    for (const a of data ?? []) {
      const aad = aadOf.get(a.user_id as string);
      if (aad) assignees.set(a.task_id as string, [...(assignees.get(a.task_id as string) ?? []), aad]);
    }
  }
  const hub: HubTaskView[] = taskRows.map((t) => ({
    id: t.id as string, title: t.title as string, description: (t.description as string) ?? null, status: t.status as HubStatus, priority: t.priority as HubPriority,
    dueDate: (t.due_date as string) ?? null, updatedAt: t.updated_at as string, archived: Boolean(t.archived_at), assigneeAadIds: assignees.get(t.id as string) ?? [],
  }));
  const hubById = new Map(hub.map((t) => [t.id, t]));

  const { data: linkRows } = await admin.from("task_m365_links").select("task_id, planner_task_id, content_hash, last_percent, etag").eq("project_id", project.id);
  const etagOf = new Map<string, string | null>();
  const links: TaskLink[] = (linkRows ?? []).map((l) => {
    etagOf.set(l.task_id as string, (l.etag as string) ?? null);
    return { taskId: l.task_id as string, plannerTaskId: l.planner_task_id as string, contentHash: (l.content_hash as string) ?? null, lastPercent: (l.last_percent as number) ?? null };
  });

  const plannerList = await g.listPlanTasks(planId);
  const plannerRaw = new Map(plannerList.map((t) => [t.id, t]));
  const planner = new Map<string, PlannerTaskView>(plannerList.map((t) => [t.id, { id: t.id, percentComplete: t.percentComplete, completedAt: t.completedDateTime, assignmentIds: g.assignmentIds(t) }]));

  const plan = diffTasks(hub, links, planner, taskUrl);
  const saveTaskLink = (taskId: string, plannerTaskId: string, etag: string | null, hash: string, percent: number) =>
    admin.from("task_m365_links").upsert({ task_id: taskId, organization_id: orgId, project_id: project.id, planner_task_id: plannerTaskId, etag, content_hash: hash, last_percent: percent, synced_at: new Date().toISOString() }, { onConflict: "task_id" });
  const guard = async (what: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { report.warnings.push(`${what}: ${errText(e)}`); }
  };
  const timeUp = () => Date.now() > ctx.deadline;

  // Removed / archived in the Hub
  for (const l of plan.remove) {
    if (timeUp()) break;
    await guard("Removing a task", async () => {
      await g.deleteTask(l.plannerTaskId, plannerRaw.get(l.plannerTaskId)?.["@odata.etag"] ?? null);
      await admin.from("task_m365_links").delete().eq("task_id", l.taskId);
      report.tasks.removed++;
    });
  }

  // New (and ones deleted in Planner)
  const createOne = async (t: HubTaskView) => {
    const c = taskContent(t, taskUrl(t.id));
    const pct = statusToPercent(t.status);
    const created = await g.createTask(planId, bucket, { title: c.title, priority: c.priority, dueDateTime: c.dueDateTime, percentComplete: pct }, c.assigneeAadIds);
    if (c.description) await g.setDescription(created.id, c.description);
    await saveTaskLink(t.id, created.id, created["@odata.etag"], contentHash(c), pct);
    report.tasks.created++;
  };
  for (const t of [...plan.create, ...plan.recreate.map((r) => r.task)]) {
    if (timeUp()) break;
    await guard(`Creating “${t.title.slice(0, 40)}”`, () => createOne(t));
  }

  // Existing: content changes and two-way completion
  const needsContent = new Set(plan.update.map((u) => u.task.id));
  const paired = links.filter((l) => hubById.get(l.taskId) && !hubById.get(l.taskId)!.archived && plannerRaw.has(l.plannerTaskId));
  for (const l of paired) {
    if (timeUp()) break;
    const t = hubById.get(l.taskId)!;
    const raw = plannerRaw.get(l.plannerTaskId)!;
    const dec = reconcileStatus({ hubStatus: t.status, hubUpdatedAt: t.updatedAt, plannerPercent: raw.percentComplete, plannerCompletedAt: raw.completedDateTime, lastPercent: l.lastPercent });
    const contentChanged = needsContent.has(t.id);
    if (!contentChanged && dec.direction === "none" && dec.percent === l.lastPercent) { report.tasks.unchanged++; continue; }
    await guard(`Updating “${t.title.slice(0, 40)}”`, async () => {
      const c = taskContent(t, taskUrl(t.id));
      let etag = raw["@odata.etag"];
      const patch: Record<string, unknown> = {};
      if (contentChanged) {
        Object.assign(patch, { title: c.title, priority: c.priority, dueDateTime: c.dueDateTime });
        const a = g.assignmentPatch(g.assignmentIds(raw), c.assigneeAadIds);
        if (a) patch.assignments = a;
      }
      if (dec.direction === "toPlanner") patch.percentComplete = dec.percent;
      if (Object.keys(patch).length) etag = await g.updateTask({ id: raw.id, etag }, patch);
      if (contentChanged) await g.setDescription(raw.id, c.description);
      if (dec.direction === "toHub") {
        // completed_at is maintained by the tasks trigger.
        const { error } = await admin.from("tasks").update({ status: dec.status }).eq("id", t.id);
        if (error) throw new Error(`Couldn't update the Hub task: ${error.message}`);
        report.tasks.completedInHub += dec.percent === 100 ? 1 : 0;
      }
      if (dec.direction === "toPlanner" && dec.percent === 100) report.tasks.completedInPlanner++;
      await saveTaskLink(t.id, raw.id, etag, contentHash(c), dec.percent);
      if (contentChanged) report.tasks.updated++;
    });
  }
}

// ---------------------------------------------------------------------------

type PinnedSpec = { title: string; description: string; start?: string | null; due?: string | null; assignees: string[] } | null;

async function ensurePinned(ctx: RunCtx, link: LinkRow, key: string, bucket: string, spec: PinnedSpec, warn: (s: string) => void) {
  const planId = link.plan_id!;
  const pinned = link.pinned[key];
  try {
    if (!spec) {
      if (pinned) { await g.deleteTask(pinned.id, null); delete link.pinned[key]; }
      return;
    }
    const hash = sha(JSON.stringify(spec));
    if (pinned?.hash === hash) return;
    const existing = pinned ? await g.getTask(pinned.id) : null;
    const start = plannerDate(spec.start);
    const due = plannerDate(spec.due);
    if (existing) {
      const patch: Record<string, unknown> = { title: spec.title, dueDateTime: due, startDateTime: start };
      const a = g.assignmentPatch(g.assignmentIds(existing), spec.assignees);
      if (a) patch.assignments = a;
      await g.updateTask({ id: existing.id, etag: existing["@odata.etag"] }, patch);
      await g.setDescription(existing.id, spec.description);
      link.pinned[key] = { id: existing.id, hash };
    } else {
      const t = await g.createTask(planId, bucket, { title: spec.title, dueDateTime: due, startDateTime: start, priority: priorityToPlanner("normal") }, spec.assignees);
      await g.setDescription(t.id, spec.description);
      link.pinned[key] = { id: t.id, hash };
    }
  } catch (e) {
    warn(`${key}: ${errText(e)}`);
  }
}

async function syncPinned(ctx: RunCtx, orgId: string, slug: string, project: ProjectRow, link: LinkRow, sel: MemberSelection, report: ProjectReport) {
  const { admin } = ctx;
  const everyone = sel.include.map((m) => m.aadId);
  const hubUrl = `${ctx.baseUrl}/o/${slug}/projects/${project.id}`;
  const warn = (s: string) => report.warnings.push(s);

  // Project log -> one pinned task whose notes hold the newest entries.
  const { data: notes } = await admin.from("project_notes").select("kind, title, body, supplier, reference, amount, currency, occurred_at, created_by")
    .eq("project_id", project.id).is("archived_at", null).order("occurred_at", { ascending: false }).limit(300);
  const authorIds = [...new Set((notes ?? []).map((n) => n.created_by as string))];
  const { data: authors } = authorIds.length ? await admin.from("profiles").select("id, display_name").in("id", authorIds) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((authors ?? []).map((a) => [a.id as string, a.display_name as string]));
  const entries: LogEntry[] = (notes ?? []).map((n) => ({
    kind: n.kind as string, title: n.title as string, body: (n.body as string) ?? null, supplier: (n.supplier as string) ?? null, reference: (n.reference as string) ?? null,
    amount: n.amount === null || n.amount === undefined ? null : Number(n.amount), currency: (n.currency as string) ?? null, occurredAt: n.occurred_at as string, author: nameOf.get(n.created_by as string) ?? null,
  }));
  await ensurePinned(ctx, link, "updates", link.bucket_ids.Updates, {
    title: "\u{1F4CC} Project updates", description: renderUpdates(project.name, entries, `${hubUrl}/log`), assignees: [],
  }, warn);

  // Project dates -> tasks with start/due dates (they show in Planner, To Do and Outlook's task list).
  const about = [project.name, project.description?.trim(), `Status: ${project.status}`, `Open in ${BRAND.product}: ${hubUrl}`].filter(Boolean).join("\n\n");
  await ensurePinned(ctx, link, "start", link.bucket_ids.Dates, project.start_date
    ? { title: `\u25B6 Project starts \u2013 ${project.name}`.slice(0, 255), description: about, start: project.start_date, due: project.start_date, assignees: everyone } : null, warn);
  await ensurePinned(ctx, link, "end", link.bucket_ids.Dates, project.end_date
    ? { title: `\u{1F3C1} Project deadline \u2013 ${project.name}`.slice(0, 255), description: about, due: project.end_date, assignees: everyone } : null, warn);
  await saveLink(admin, orgId, link);
}
