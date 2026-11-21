import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee", carol: "employee" });
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const notes = async (who: string) => (await db.query("select title, body from public.notifications where user_id = $1 order by created_at", [f.u[who]])).rows;

async function assigned(title: string) {
  const [t] = await q("admin", "insert into public.tasks (organization_id, title, description) values ($1, $2, 'Fit the lights') returning id", [f.orgA, title]);
  await q("admin", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [t.id, f.orgA, f.u.bob]);
  return t.id as string;
}

describe("tasks assigned by management", () => {
  it("the employee is notified, can add notes and report it completed; the manager hears back", async () => {
    const id = await assigned(`Sauna lights ${f.tag}`);
    expect((await notes("bob")).some((n) => n.title === `New task: Sauna lights ${f.tag}`)).toBe(true);
    await q("bob", "insert into public.task_comments (task_id, organization_id, author_id, body) values ($1, $2, $3, 'Cables pulled')", [id, f.orgA, f.u.bob]);
    await q("bob", "select public.report_task($1, 'completed', 'All six fitted and tested')", [id]);
    const [t] = await q("admin", "select status, outcome, outcome_note, outcome_by, completed_at is not null as done from public.tasks where id = $1", [id]);
    expect(t).toEqual({ status: "done", outcome: "completed", outcome_note: "All six fitted and tested", outcome_by: f.u.bob, done: true });
    const adminNotes = await notes("admin");
    expect(adminNotes.some((n) => n.title.includes("added a note") && n.body === "Cables pulled")).toBe(true);
    expect(adminNotes.some((n) => n.title.includes("completed: Sauna lights") && n.body === "All six fitted and tested")).toBe(true);
  });

  it("not completed needs a reason and sends the task back for review", async () => {
    const id = await assigned(`RJ45 ${f.tag}`);
    await expect(q("bob", "select public.report_task($1, 'not_completed', '  ')", [id])).rejects.toThrow(/why/);
    await q("bob", "select public.report_task($1, 'not_completed', 'Waiting for patch panel delivery')", [id]);
    const [t] = await q("admin", "select status, outcome from public.tasks where id = $1", [id]);
    expect(t).toEqual({ status: "review", outcome: "not_completed" });
  });

  it("people not on the task can't report on it", async () => {
    const id = await assigned(`Rack ${f.tag}`);
    await expect(q("carol", "select public.report_task($1, 'completed', null)", [id])).rejects.toThrow(/can't report/);
  });
});

describe("in progress", () => {
  it("marks the task in progress, with an optional note, and tells the manager", async () => {
    const id = await assigned(`Cabins ${f.tag}`);
    await q("bob", "select public.report_task($1, 'in_progress', 'Half the cabins done')", [id]);
    const [t] = await q("admin", "select status, outcome, outcome_note from public.tasks where id = $1", [id]);
    expect(t).toEqual({ status: "in_progress", outcome: null, outcome_note: "Half the cabins done" });
    expect((await notes("admin")).some((n) => n.title.includes("is working on: Cabins"))).toBe(true);
    await q("bob", "select public.report_task($1, 'in_progress', null)", [id]);
  });
});
