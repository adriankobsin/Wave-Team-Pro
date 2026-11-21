import { describe, expect, it } from "vitest";
import {
  contentHash, diffMembers, diffTasks, excludedReason, groupName, groupNickname, percentToStatus,
  reconcileStatus, renderUpdates, selectProjectMembers, statusToPercent, taskContent,
  type HubTaskView, type MemberCandidate, type PlannerTaskView, type TaskLink,
} from "@/lib/m365/sync-logic";

const cand = (p: Partial<MemberCandidate> & { userId: string }): MemberCandidate => ({ displayName: p.userId, email: `${p.userId}@acme.example`, jobTitle: null, roles: [], ...p });

describe("excludedReason", () => {
  it("matches PA and HR by job title, case-insensitively", () => {
    expect(excludedReason("PA")).toBe("pa");
    expect(excludedReason("personal assistant")).toBe("pa");
    expect(excludedReason("Executive PA to the Director")).toBe("pa");
    expect(excludedReason("HR")).toBe("hr");
    expect(excludedReason("Human Resources Officer")).toBe("hr");
  });
  it("matches role names and keys", () => {
    expect(excludedReason(null, ["hr_manager"])).toBe("hr");
    expect(excludedReason("Engineer", ["Personal Assistant"])).toBe("pa");
  });
  it("does not match look-alikes", () => {
    for (const t of ["Project Manager", "Engineer", "IT", "DIRECTOR", "Parent liaison", "Chris", "Shrimp buyer", "Paint technician"]) expect(excludedReason(t)).toBeNull();
    expect(excludedReason(null, ["project_manager", "super_admin"])).toBeNull();
  });
});

describe("selectProjectMembers", () => {
  const tenant = new Map([["eng@acme.example", { id: "aad-eng" }], ["pm@acme.example", { id: "aad-pm" }], ["pa@acme.example", { id: "aad-pa" }], ["off@acme.example", { id: "aad-off", accountEnabled: false }]]);
  it("keeps tenant users, drops PA/HR, lists the rest in the report", () => {
    const r = selectProjectMembers([
      cand({ userId: "eng", jobTitle: "Engineer" }),
      cand({ userId: "pm", jobTitle: "Project Manager" }),
      cand({ userId: "pa", jobTitle: "PA" }),
      cand({ userId: "hrx", jobTitle: "Engineer", roles: ["HR"] }),
      cand({ userId: "gmail", email: "Someone@Gmail.com" }),
      cand({ userId: "none", email: null }),
      cand({ userId: "off" }),
      cand({ userId: "eng" }),
    ], tenant);
    expect(r.include.map((m) => m.aadId)).toEqual(["aad-eng", "aad-pm"]);
    expect(r.excluded).toEqual([{ userId: "pa", displayName: "pa", reason: "pa" }, { userId: "hrx", displayName: "hrx", reason: "hr" }]);
    expect(r.skipped.map((s) => [s.userId, s.reason, s.email])).toEqual([["gmail", "not_in_tenant", "someone@gmail.com"], ["none", "no_email", null], ["off", "disabled_account", "off@acme.example"]]);
  });
  it("never includes a PA even if they exist in the tenant", () => {
    expect(selectProjectMembers([cand({ userId: "pa", jobTitle: "Personal Assistant" })], tenant).include).toEqual([]);
  });
});

describe("diffMembers", () => {
  it("adds missing people and removes only ones the sync added", () => {
    const r = diffMembers(["a", "b", "owner"], ["a", "c"], ["a", "b"]);
    expect(r.add).toEqual(["c"]);
    expect(r.remove).toEqual(["b"]);
    expect(r.managedAfter.sort()).toEqual(["a", "c"]);
  });
  it("leaves hand-added members and is a no-op when in sync", () => {
    expect(diffMembers(["a", "manual"], ["a"], ["a"])).toEqual({ add: [], remove: [], managedAfter: ["a"] });
  });
  it("doesn't try to remove someone already gone", () => {
    expect(diffMembers(["a"], ["a"], ["a", "gone"]).remove).toEqual([]);
  });
});

const task = (p: Partial<HubTaskView> & { id: string }): HubTaskView => ({ title: "T", description: null, status: "todo", priority: "normal", dueDate: null, updatedAt: "2026-11-01T10:00:00Z", archived: false, assigneeAadIds: [], ...p });

describe("diffTasks", () => {
  const planner = (...ids: string[]) => new Map<string, PlannerTaskView>(ids.map((id) => [id, { id, percentComplete: 0, completedAt: null, assignmentIds: [] }]));
  const link = (t: HubTaskView, over: Partial<TaskLink> = {}): TaskLink => ({ taskId: t.id, plannerTaskId: `p-${t.id}`, contentHash: contentHash(taskContent(t)), lastPercent: 0, ...over });

  it("creates tasks that have no link", () => {
    const r = diffTasks([task({ id: "1" })], [], planner());
    expect(r.create.map((t) => t.id)).toEqual(["1"]);
  });
  it("leaves unchanged tasks alone and updates edited ones", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    const r = diffTasks([a, task({ id: "b", title: "Renamed" })], [link(a), link(b)], planner("p-a", "p-b"));
    expect(r.unchanged).toBe(1);
    expect(r.update.map((u) => u.task.id)).toEqual(["b"]);
  });
  it("detects changed due date, assignees and description", () => {
    const a = task({ id: "a" });
    const p = planner("p-a");
    for (const change of [{ dueDate: "2026-12-01" }, { assigneeAadIds: ["x"] }, { description: "more" }, { priority: "urgent" as const }]) {
      expect(diffTasks([{ ...a, ...change }], [link(a)], p).update).toHaveLength(1);
    }
  });
  it("assignee order doesn't matter", () => {
    const a = task({ id: "a", assigneeAadIds: ["x", "y"] });
    expect(diffTasks([{ ...a, assigneeAadIds: ["y", "x"] }], [link(a)], planner("p-a")).unchanged).toBe(1);
  });
  it("removes the Planner copy of archived or deleted tasks", () => {
    const a = task({ id: "a", archived: true });
    const gone = task({ id: "gone" });
    const r = diffTasks([a], [link(a), link(gone)], planner("p-a", "p-gone"));
    expect(r.remove.map((l) => l.taskId).sort()).toEqual(["a", "gone"]);
    expect(r.create).toEqual([]);
  });
  it("recreates a task someone deleted in Planner", () => {
    const a = task({ id: "a" });
    expect(diffTasks([a], [link(a)], planner()).recreate.map((r) => r.task.id)).toEqual(["a"]);
  });
});

describe("status mapping", () => {
  it("maps Hub statuses to Planner percentages and back", () => {
    expect(["todo", "in_progress", "review", "done"].map(statusToPercent)).toEqual([0, 50, 50, 100]);
    expect([0, 50, 100].map(percentToStatus)).toEqual(["todo", "in_progress", "done"]);
  });
});

describe("reconcileStatus", () => {
  const base = { hubStatus: "todo" as const, hubUpdatedAt: "2026-11-01T10:00:00Z", plannerPercent: 0, plannerCompletedAt: null, lastPercent: 0 as number | null, now: new Date("2026-11-02T00:00:00Z") };
  it("does nothing when both agree", () => {
    expect(reconcileStatus(base).direction).toBe("none");
    expect(reconcileStatus({ ...base, hubStatus: "review", plannerPercent: 50, lastPercent: 50 }).direction).toBe("none");
  });
  it("ticking done in Planner marks the Hub task done", () => {
    expect(reconcileStatus({ ...base, plannerPercent: 100, plannerCompletedAt: "2026-11-01T12:00:00Z" })).toEqual({ direction: "toHub", percent: 100, status: "done" });
  });
  it("finishing in the Hub completes the Planner task", () => {
    expect(reconcileStatus({ ...base, hubStatus: "done" })).toEqual({ direction: "toPlanner", percent: 100 });
  });
  it("reopening in Planner reopens the Hub task", () => {
    expect(reconcileStatus({ ...base, hubStatus: "done", plannerPercent: 0, lastPercent: 100 })).toEqual({ direction: "toHub", percent: 0, status: "todo" });
  });
  it("both changed: the later change wins", () => {
    const both = { ...base, hubStatus: "in_progress" as const, plannerPercent: 100 };
    expect(reconcileStatus({ ...both, hubUpdatedAt: "2026-11-01T15:00:00Z", plannerCompletedAt: "2026-11-01T12:00:00Z" }).direction).toBe("toPlanner");
    expect(reconcileStatus({ ...both, hubUpdatedAt: "2026-11-01T09:00:00Z", plannerCompletedAt: "2026-11-01T12:00:00Z" }).direction).toBe("toHub");
  });
  it("never-synced tasks: later change wins too", () => {
    expect(reconcileStatus({ ...base, lastPercent: null, hubStatus: "done", plannerPercent: 0 }).direction).toBe("toHub");
  });
});

describe("text helpers", () => {
  it("names the group and builds a safe alias", () => {
    expect(groupName("  Villa Azul ")).toBe("Project – Villa Azul");
    expect(groupNickname("Yacht Ă-Șțefan / Refit #2", "1234abcd-0000")).toBe("proj-yacht-a-stefan-refit-2-1234ab");
  });
  it("renders updates newest first and caps the size", () => {
    const e = (d: string, title: string) => ({ kind: "delivery", title, body: "x".repeat(900), supplier: "Farnell", reference: null, amount: 12.5, currency: "GBP", occurredAt: `${d}T09:00:00Z`, author: "Ana" });
    const small = renderUpdates("Villa", [e("2026-11-01", "Old"), e("2026-11-03", "New")]);
    expect(small.indexOf("New")).toBeLessThan(small.indexOf("Old"));
    expect(small).toContain("Farnell · 12.50 GBP");
    const many = renderUpdates("Villa", Array.from({ length: 80 }, (_, i) => e(`2026-10-${String((i % 28) + 1).padStart(2, "0")}`, `E${i}`)));
    expect(many.length).toBeLessThanOrEqual(32_000);
    expect(many).toMatch(/older entries not shown/);
  });
});
