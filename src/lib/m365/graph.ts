import "server-only";
import { graph, GraphError } from "@/lib/sharepoint/graph";

// Microsoft Graph calls for the project sync: users, Microsoft 365 groups and Planner (app-only).
// Group calendar events and group conversations are NOT available with application permissions,
// so project updates and dates are carried by Planner tasks instead (see docs/deploy/microsoft-365.md).

const V1 = "https://graph.microsoft.com/v1.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

/** One Graph call with a few polite retries on throttling / transient errors. Returns null for tolerated statuses. */
async function call<T = Json>(path: string, init: RequestInit, what: string, tolerate: number[] = []): Promise<T | null> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await graph(path, init);
    last = res;
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2 ** attempt * 2, 15);
      await res.text().catch(() => "");
      await sleep(wait * 1000);
      continue;
    }
    break;
  }
  const res = last!;
  if (res.ok) {
    if (res.status === 204) return null;
    return (await res.json().catch(() => null)) as T | null;
  }
  if (tolerate.includes(res.status)) { await res.text().catch(() => ""); return null; }
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = body.error?.code ?? null;
  throw new GraphError(`${what} failed (${res.status}${code ? ` ${code}` : ""}): ${(body.error?.message ?? "").slice(0, 200)}`.trim(), res.status, code, res.status === 429 || res.status >= 500);
}

const json = (body: unknown): RequestInit => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const withMatch = (etag: string, extra: Record<string, string> = {}) => ({ "if-match": etag, ...extra });
const odataString = (s: string) => s.replace(/'/g, "''");

async function pages<T>(first: string, what: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  for (let i = 0; next && i < 50; i++) {
    const page: { value?: T[]; "@odata.nextLink"?: string } | null = await call(next, {}, what);
    out.push(...(page?.value ?? []));
    next = page?.["@odata.nextLink"] ?? null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type DirectoryUser = { id: string; accountEnabled?: boolean };

/** Finds tenant users by email (mail or sign-in name), 20 per $batch call. Throws if any lookup could not be completed. */
export async function findUsersByEmail(emails: string[]): Promise<Map<string, DirectoryUser>> {
  const found = new Map<string, DirectoryUser>();
  for (let i = 0; i < emails.length; i += 20) {
    const chunk = emails.slice(i, i + 20);
    const requests = chunk.map((e, n) => ({
      id: String(n),
      method: "GET",
      url: `/users?$filter=${encodeURIComponent(`mail eq '${odataString(e)}' or userPrincipalName eq '${odataString(e)}'`)}&$select=id,mail,userPrincipalName,accountEnabled`,
    }));
    const res = await call<{ responses: { id: string; status: number; body: { value?: { id: string; mail?: string | null; userPrincipalName?: string; accountEnabled?: boolean }[] } }[] }>("/$batch", { method: "POST", ...json({ requests }) }, "Looking up Microsoft 365 users");
    for (const r of res?.responses ?? []) {
      const email = chunk[Number(r.id)];
      if (r.status !== 200) throw new GraphError(`Looking up ${email} failed (${r.status}).`, r.status, null, true);
      const u = r.body.value?.[0];
      if (u) found.set(email, { id: u.id, accountEnabled: u.accountEnabled });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function findGroupByNickname(nickname: string): Promise<string | null> {
  const r = await call<{ value: { id: string }[] }>(`/groups?$filter=${encodeURIComponent(`mailNickname eq '${odataString(nickname)}'`)}&$select=id`, {}, "Finding the Microsoft 365 group");
  return r?.value?.[0]?.id ?? null;
}

export async function createGroup(displayName: string, nickname: string, description: string): Promise<string> {
  const r = await call<{ id: string }>("/groups", {
    method: "POST",
    ...json({ displayName, description: description.slice(0, 1000), mailNickname: nickname, mailEnabled: true, securityEnabled: false, groupTypes: ["Unified"], visibility: "Private" }),
  }, "Creating the Microsoft 365 group");
  return r!.id;
}

export async function renameGroup(groupId: string, displayName: string) {
  await call(`/groups/${groupId}`, { method: "PATCH", ...json({ displayName }) }, "Renaming the group", [404]);
}

export async function listMemberIds(groupId: string): Promise<string[]> {
  const m = await pages<{ id: string }>(`/groups/${groupId}/members?$select=id&$top=999`, "Listing group members");
  return m.map((x) => x.id);
}

export async function addMember(groupId: string, userId: string) {
  // 400 = already a member (race with a manual add): fine.
  await call(`/groups/${groupId}/members/$ref`, { method: "POST", ...json({ "@odata.id": `${V1}/directoryObjects/${userId}` }) }, "Adding a group member", [400]);
}

export async function removeMember(groupId: string, userId: string) {
  await call(`/groups/${groupId}/members/${userId}/$ref`, { method: "DELETE" }, "Removing a group member", [404]);
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export type PlannerTask = {
  id: string;
  "@odata.etag": string;
  title: string;
  bucketId: string;
  percentComplete: number;
  completedDateTime: string | null;
  assignments: Record<string, unknown>;
};

export const assignmentIds = (t: Pick<PlannerTask, "assignments">) => Object.entries(t.assignments ?? {}).filter(([, v]) => v !== null).map(([k]) => k);

export async function findPlanForGroup(groupId: string): Promise<string | null> {
  try {
    const r = await call<{ value: { id: string }[] }>(`/groups/${groupId}/planner/plans?$select=id`, {}, "Finding the plan");
    return r?.value?.[0]?.id ?? null;
  } catch { return null; }
}

export async function createPlan(groupId: string, title: string): Promise<string> {
  const r = await call<{ id: string }>("/planner/plans", { method: "POST", ...json({ container: { url: `${V1}/groups/${groupId}` }, title }) }, "Creating the Planner plan");
  return r!.id;
}

export async function ensureBuckets(planId: string, names: string[]): Promise<Record<string, string>> {
  const existing = await pages<{ id: string; name: string }>(`/planner/plans/${planId}/buckets`, "Listing buckets");
  const out: Record<string, string> = {};
  for (const name of names) {
    const hit = existing.find((b) => b.name === name);
    if (hit) { out[name] = hit.id; continue; }
    const b = await call<{ id: string }>("/planner/buckets", { method: "POST", ...json({ name, planId, orderHint: " !" }) }, `Creating bucket ${name}`);
    out[name] = b!.id;
  }
  return out;
}

export const listPlanTasks = (planId: string) => pages<PlannerTask>(`/planner/plans/${planId}/tasks`, "Listing Planner tasks");

export async function getTask(id: string): Promise<PlannerTask | null> {
  return call<PlannerTask>(`/planner/tasks/${id}`, {}, "Reading a Planner task", [404]);
}

const assignment = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
/** Assignment changes: add new ids, null out removed ones. */
export function assignmentPatch(current: string[], desired: string[]): Record<string, unknown> | null {
  const cur = new Set(current);
  const want = new Set(desired);
  const patch: Record<string, unknown> = {};
  for (const id of want) if (!cur.has(id)) patch[id] = assignment;
  for (const id of cur) if (!want.has(id)) patch[id] = null;
  return Object.keys(patch).length ? patch : null;
}

export type TaskFields = { title?: string; priority?: number; dueDateTime?: string | null; startDateTime?: string | null; percentComplete?: number };

export async function createTask(planId: string, bucketId: string, f: TaskFields & { title: string }, assignees: string[]): Promise<PlannerTask> {
  const assignments = Object.fromEntries(assignees.map((id) => [id, assignment]));
  const body: Json = { planId, bucketId, ...f, ...(assignees.length ? { assignments } : {}) };
  if (body.dueDateTime === null) delete body.dueDateTime;
  if (body.startDateTime === null) delete body.startDateTime;
  return (await call<PlannerTask>("/planner/tasks", { method: "POST", ...json(body) }, "Creating a Planner task"))!;
}

/** PATCH with the current etag; one retry with a fresh etag if someone edited it meanwhile. Returns the new etag. */
export async function updateTask(task: { id: string; etag: string }, patch: Json): Promise<string> {
  let etag = task.etag;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await call<PlannerTask>(`/planner/tasks/${task.id}`, { method: "PATCH", ...json(patch), headers: { "content-type": "application/json", ...withMatch(etag, { prefer: "return=representation" }) } }, "Updating a Planner task");
      return r?.["@odata.etag"] ?? etag;
    } catch (e) {
      if (!(e instanceof GraphError) || e.status !== 412 || attempt === 1) throw e;
      const fresh = await getTask(task.id);
      if (!fresh) throw e;
      etag = fresh["@odata.etag"];
    }
  }
  return etag;
}

export async function deleteTask(id: string, etag: string | null) {
  let tag = etag;
  if (!tag) { const t = await getTask(id); if (!t) return; tag = t["@odata.etag"]; }
  try {
    await call(`/planner/tasks/${id}`, { method: "DELETE", headers: withMatch(tag) }, "Deleting a Planner task", [404]);
  } catch (e) {
    if (!(e instanceof GraphError) || e.status !== 412) throw e;
    const fresh = await getTask(id);
    if (fresh) await call(`/planner/tasks/${id}`, { method: "DELETE", headers: withMatch(fresh["@odata.etag"]) }, "Deleting a Planner task", [404]);
  }
}

/** The notes / description box of a task (separate resource with its own etag). */
export async function setDescription(taskId: string, description: string) {
  const d = await call<{ description?: string; "@odata.etag": string }>(`/planner/tasks/${taskId}/details`, {}, "Reading task details");
  if (!d) return;
  if ((d.description ?? "") === description) return;
  await call(`/planner/tasks/${taskId}/details`, { method: "PATCH", headers: { "content-type": "application/json", ...withMatch(d["@odata.etag"]) }, body: JSON.stringify({ description, previewType: "description" }) }, "Writing task notes");
}

export { sleep };
