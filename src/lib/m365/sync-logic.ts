import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";

// Pure rules for the Microsoft 365 project sync. No I/O here, so everything is unit-tested.

// ---------------------------------------------------------------------------
// Who is in the project's Microsoft 365 group
// ---------------------------------------------------------------------------

export type MemberCandidate = {
  userId: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  /** Names and keys of every role the person holds (any scope). */
  roles: string[];
};

export type ExcludedReason = "pa" | "hr";
export type SkippedReason = "no_email" | "not_in_tenant" | "disabled_account";

const words = (s: string) => s.toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();
const PA_RE = /(^|\s)(pa|personal assistant)(\s|$)/;
const HR_RE = /(^|\s)(hr|human resources)(\s|$)/;

/** PA or HR by job title or by any role name/key, case-insensitive ("PA", "Personal Assistant", "hr_manager"…). */
export function excludedReason(jobTitle: string | null | undefined, roles: readonly string[] = []): ExcludedReason | null {
  const labels = [jobTitle ?? "", ...roles].map(words).filter(Boolean);
  if (labels.some((l) => PA_RE.test(l))) return "pa";
  if (labels.some((l) => HR_RE.test(l))) return "hr";
  return null;
}

export type TenantUser = { id: string; accountEnabled?: boolean };

export type MemberSelection = {
  include: { userId: string; displayName: string; email: string; aadId: string }[];
  excluded: { userId: string; displayName: string; reason: ExcludedReason }[];
  skipped: { userId: string; displayName: string; email: string | null; reason: SkippedReason }[];
};

/** `tenant` maps lower-cased email -> Microsoft user (only people found in the tenant). */
export function selectProjectMembers(candidates: readonly MemberCandidate[], tenant: ReadonlyMap<string, TenantUser>): MemberSelection {
  const out: MemberSelection = { include: [], excluded: [], skipped: [] };
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    const reason = excludedReason(c.jobTitle, c.roles);
    if (reason) { out.excluded.push({ userId: c.userId, displayName: c.displayName, reason }); continue; }
    const email = c.email?.trim().toLowerCase() || null;
    if (!email) { out.skipped.push({ userId: c.userId, displayName: c.displayName, email: null, reason: "no_email" }); continue; }
    const u = tenant.get(email);
    if (!u) { out.skipped.push({ userId: c.userId, displayName: c.displayName, email, reason: "not_in_tenant" }); continue; }
    if (u.accountEnabled === false) { out.skipped.push({ userId: c.userId, displayName: c.displayName, email, reason: "disabled_account" }); continue; }
    out.include.push({ userId: c.userId, displayName: c.displayName, email, aadId: u.id });
  }
  return out;
}

/**
 * Group membership changes. Only people the sync itself added earlier (`managed`) are ever removed,
 * so owners and members an admin added by hand are left alone.
 */
export function diffMembers(current: Iterable<string>, desired: Iterable<string>, managed: Iterable<string>) {
  const cur = new Set(current);
  const want = new Set(desired);
  const mine = new Set(managed);
  const add = [...want].filter((id) => !cur.has(id));
  const remove = [...mine].filter((id) => !want.has(id) && cur.has(id));
  // What we manage afterwards: still-wanted people we added before, plus the ones we add now.
  const managedAfter = [...new Set([...[...mine].filter((id) => want.has(id)), ...add])];
  return { add, remove, managedAfter };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type HubStatus = "todo" | "in_progress" | "review" | "done";
export type HubPriority = "low" | "normal" | "high" | "urgent";

export type HubTaskView = {
  id: string;
  title: string;
  description: string | null;
  status: HubStatus;
  priority: HubPriority;
  dueDate: string | null; // YYYY-MM-DD
  updatedAt: string;
  archived: boolean;
  assigneeAadIds: string[];
};

export type TaskLink = { taskId: string; plannerTaskId: string; contentHash: string | null; lastPercent: number | null };
export type PlannerTaskView = { id: string; percentComplete: number; completedAt: string | null; assignmentIds: string[] };

export const statusToPercent = (s: HubStatus | string | null | undefined): 0 | 50 | 100 => (s === "done" ? 100 : s === "in_progress" || s === "review" ? 50 : 0);
export const percentToStatus = (p: number): HubStatus => (p >= 100 ? "done" : p > 0 ? "in_progress" : "todo");
/** Planner: 1 urgent, 3 important, 5 medium, 9 low. */
export const priorityToPlanner = (p: HubPriority | string): number => (p === "urgent" ? 1 : p === "high" ? 3 : p === "low" ? 9 : 5);
/** Noon UTC keeps the calendar day the same in every time zone. */
export const dateToPlanner = (d: string | null | undefined) => (d ? `${d}T12:00:00Z` : null);

/** What gets written to the Planner task body. Status is handled separately (two-way). */
export function taskContent(t: Pick<HubTaskView, "title" | "description" | "priority" | "dueDate" | "assigneeAadIds">, hubUrl?: string) {
  const notes = [t.description?.trim(), hubUrl ? `Open in ${BRAND.product}: ${hubUrl}` : null].filter(Boolean).join("\n\n");
  return {
    title: t.title.trim().slice(0, 255),
    description: notes,
    priority: priorityToPlanner(t.priority),
    dueDateTime: dateToPlanner(t.dueDate),
    assigneeAadIds: [...new Set(t.assigneeAadIds)].sort(),
  };
}

export const contentHash = (c: ReturnType<typeof taskContent>) => createHash("sha1").update(JSON.stringify(c)).digest("hex");

export type TaskPlan = {
  create: HubTaskView[];
  update: { task: HubTaskView; link: TaskLink; planner: PlannerTaskView }[];
  /** Linked task whose Planner copy was deleted there: make it again. */
  recreate: { task: HubTaskView; link: TaskLink }[];
  /** Archived / removed in the Hub: delete the Planner copy. */
  remove: TaskLink[];
  unchanged: number;
};

/** Which Planner changes are needed for the Hub tasks, given the links and what Planner holds now. */
export function diffTasks(hub: readonly HubTaskView[], links: readonly TaskLink[], planner: ReadonlyMap<string, PlannerTaskView>, hubUrl: (id: string) => string = () => ""): TaskPlan {
  const plan: TaskPlan = { create: [], update: [], recreate: [], remove: [], unchanged: 0 };
  const byTask = new Map(links.map((l) => [l.taskId, l]));
  const live = new Map(hub.filter((t) => !t.archived).map((t) => [t.id, t]));
  for (const l of links) if (!live.has(l.taskId)) plan.remove.push(l);
  for (const t of live.values()) {
    const link = byTask.get(t.id);
    if (!link) { plan.create.push(t); continue; }
    const p = planner.get(link.plannerTaskId);
    if (!p) { plan.recreate.push({ task: t, link }); continue; }
    const hash = contentHash(taskContent(t, hubUrl(t.id)));
    if (hash !== link.contentHash) plan.update.push({ task: t, link, planner: p });
    else plan.unchanged++;
  }
  return plan;
}

export type StatusDecision =
  | { direction: "none"; percent: number }
  | { direction: "toPlanner"; percent: number }
  | { direction: "toHub"; percent: number; status: HubStatus };

/**
 * Completion is two-way. `lastPercent` is what both sides agreed on last time, so whoever moved away
 * from it is the one that changed. If both changed, the later change wins: Hub = `updated_at`,
 * Planner = its completion time (ticked done) or, for other moves, when we noticed (`now`).
 */
export function reconcileStatus(input: {
  hubStatus: HubStatus;
  hubUpdatedAt: string;
  plannerPercent: number;
  plannerCompletedAt: string | null;
  lastPercent: number | null;
  now?: Date;
}): StatusDecision {
  const hubPct = statusToPercent(input.hubStatus);
  const pl = input.plannerPercent >= 100 ? 100 : input.plannerPercent > 0 ? 50 : 0;
  if (hubPct === pl) return { direction: "none", percent: hubPct };
  const last = input.lastPercent;
  const hubChanged = last === null || hubPct !== last;
  const plannerChanged = last === null || pl !== last;
  const toHub = (): StatusDecision => ({ direction: "toHub", percent: pl, status: percentToStatus(pl) });
  const toPlanner = (): StatusDecision => ({ direction: "toPlanner", percent: hubPct });
  if (hubChanged && !plannerChanged) return toPlanner();
  if (plannerChanged && !hubChanged) return toHub();
  const hubAt = Date.parse(input.hubUpdatedAt);
  const plAt = input.plannerCompletedAt ? Date.parse(input.plannerCompletedAt) : (input.now ?? new Date()).getTime();
  return plAt > hubAt ? toHub() : toPlanner();
}

// ---------------------------------------------------------------------------
// Group / project text
// ---------------------------------------------------------------------------

export const groupName = (projectName: string) => `Project – ${projectName.trim()}`.slice(0, 120);

/** Unique, mail-safe alias: letters, digits and dashes only. */
export function groupNickname(projectName: string, projectId: string) {
  const base = projectName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return `proj-${base}-${projectId.replace(/-/g, "").slice(0, 6)}`;
}

export type LogEntry = { kind: string; title: string; body: string | null; supplier: string | null; reference: string | null; amount: number | null; currency: string | null; occurredAt: string; author: string | null };
export const MAX_DETAILS = 30_000; // Planner allows 32 768 characters

/** The text of the pinned “Project updates” task: newest log entries first. */
export function renderUpdates(projectName: string, entries: readonly LogEntry[], hubUrl?: string): string {
  const head = [`${projectName} – project updates`, `Copied from ${BRAND.product}, newest first. Add updates there; edits made here are overwritten.`, hubUrl ? `Project log: ${hubUrl}` : null].filter(Boolean).join("\n");
  const blocks: string[] = [];
  let size = head.length;
  let shown = 0;
  for (const e of [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    const meta = [e.supplier, e.reference ? `ref ${e.reference}` : null, e.amount != null ? `${e.amount.toFixed(2)}${e.currency ? ` ${e.currency}` : ""}` : null].filter(Boolean).join(" · ");
    const block = [`${e.occurredAt.slice(0, 10)} · ${e.kind.toUpperCase()} · ${e.title}${e.author ? ` (${e.author})` : ""}`, meta || null, e.body?.trim() || null].filter(Boolean).join("\n");
    if (size + block.length + 6 > MAX_DETAILS) break;
    blocks.push(block);
    size += block.length + 6;
    shown++;
  }
  const more = entries.length - shown;
  return [head, ...blocks, more > 0 ? `… ${more} older ${more === 1 ? "entry" : "entries"} not shown. See the full log in the Hub.` : null].filter(Boolean).join("\n\n— — —\n\n");
}

export const sha = (s: string) => createHash("sha1").update(s).digest("hex");
