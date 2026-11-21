import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  // pm = project manager, lead = team leader (team-scoped later), bob/cara employees
  f = await buildOrgs(db, { admin: "super_admin", pm: "project_manager", bob: "employee", cara: "employee", lead: "employee" });
  // bob reports to lead; lead gets team_leader role scoped to the Deck team which bob is in.
  await db.query("update public.organization_memberships set manager_membership_id = $1 where id = $2", [f.m.lead, f.m.bob]);
  const team = (await db.query("insert into public.teams (organization_id, name) values ($1, 'Deck') returning id", [f.orgA])).rows[0].id;
  await db.query("insert into public.team_memberships (organization_id, team_id, membership_id) values ($1, $2, $3), ($1, $2, $4)", [f.orgA, team, f.m.bob, f.m.lead]);
  await db.query(
    "insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type, scope_id) values ($1, $2, $3, 'team', $4)",
    [f.orgA, f.m.lead, await f.role(f.orgA, "team_leader"), team],
  );
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;

describe("supervision", () => {
  it("team leaders supervise their team; nobody supervises themselves", async () => {
    expect((await q("lead", "select public.can_supervise($1, 'timesheets.approve', $2) ok", [f.orgA, f.m.bob]))[0].ok).toBe(true);
    expect((await q("lead", "select public.can_supervise($1, 'timesheets.approve', $2) ok", [f.orgA, f.m.cara]))[0].ok).toBe(false);
    expect((await q("lead", "select public.can_supervise($1, 'timesheets.approve', $2) ok", [f.orgA, f.m.lead]))[0].ok).toBe(false);
    expect((await q("admin", "select public.can_supervise($1, 'timesheets.approve', $2) ok", [f.orgA, f.m.admin]))[0].ok).toBe(false);
    expect((await q("outsider", "select public.can_supervise($1, 'timesheets.approve', $2) ok", [f.orgA, f.m.bob]))[0].ok).toBe(false);
  });
});

describe("attendance", () => {
  it("records server-timestamped punches in a valid sequence", async () => {
    await q("bob", "select public.clock($1, 'clock_in')", [f.orgA]);
    await expect(q("bob", "select public.clock($1, 'clock_in')", [f.orgA])).rejects.toThrow(/does not match/);
    await q("bob", "select public.clock($1, 'break_start')", [f.orgA]);
    await q("bob", "select public.clock($1, 'clock_out')", [f.orgA]);
    const kinds = (await q("bob", "select kind from public.attendance_events where membership_id = $1 order by occurred_at, created_at", [f.m.bob])).map((r) => r.kind);
    expect(kinds).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
  });

  it("cannot be inserted or edited directly", async () => {
    await expect(q("bob", "insert into public.attendance_events (organization_id, membership_id, kind) values ($1, $2, 'clock_in')", [f.orgA, f.m.bob])).rejects.toThrow(/permission denied/);
    await expect(q("bob", "update public.attendance_events set occurred_at = now() - interval '5 hours'")).rejects.toThrow(/permission denied/);
  });

  it("is visible to the person and their supervisors only", async () => {
    expect(await q("lead", "select id from public.attendance_events where membership_id = $1", [f.m.bob])).toHaveLength(4);
    expect(await q("cara", "select id from public.attendance_events where membership_id = $1", [f.m.bob])).toHaveLength(0);
    expect(await q("outsider", "select id from public.attendance_events where membership_id = $1", [f.m.bob])).toHaveLength(0);
  });

  it("corrections are approved by a supervisor and create an audited event", async () => {
    const [{ id }] = await q("bob", "insert into public.attendance_corrections (organization_id, membership_id, kind, occurred_at, reason) values ($1, $2, 'clock_in', now() - interval '1 day', 'Forgot to clock in') returning id", [f.orgA, f.m.bob]);
    await expect(q("bob", "select public.review_attendance_correction($1, true)", [id])).rejects.toThrow(/cannot review/);
    await expect(q("cara", "select public.review_attendance_correction($1, true)", [id])).rejects.toThrow(/cannot review/);
    await q("lead", "select public.review_attendance_correction($1, true, 'ok')", [id]);
    const ev = await q("bob", "select source from public.attendance_events where membership_id = $1 and source = 'correction'", [f.m.bob]);
    expect(ev).toHaveLength(1);
    await expect(q("lead", "select public.review_attendance_correction($1, false)", [id])).rejects.toThrow(/no longer pending/);
  });

  it("people cannot file corrections for someone else", async () => {
    await expect(q("cara", "insert into public.attendance_corrections (organization_id, membership_id, kind, occurred_at, reason) values ($1, $2, 'clock_in', now(), 'xxx')", [f.orgA, f.m.bob])).rejects.toThrow(/row-level security/);
  });
});

describe("projects and tasks", () => {
  let project: string;
  let task: string;

  it("project managers create projects; employees cannot", async () => {
    [{ id: project }] = await q("pm", "insert into public.projects (organization_id, name, code, created_by) values ($1, 'Refit MY Aurora', 'P-001', $2) returning id", [f.orgA, f.u.pm]);
    await expect(q("bob", "insert into public.projects (organization_id, name, created_by) values ($1, 'Nope', $2)", [f.orgA, f.u.bob])).rejects.toThrow(/row-level security/);
    // Employees are basic accounts: they only see projects they've been put on.
    expect(await q("bob", "select id from public.projects where id = $1", [project])).toHaveLength(0);
    await q("pm", "insert into public.project_members (project_id, organization_id, membership_id) values ($1, $2, $3)", [project, f.orgA, f.m.bob]);
    expect(await q("bob", "select id from public.projects where id = $1", [project])).toHaveLength(1);
    expect(await q("outsider", "select id from public.projects where id = $1", [project])).toHaveLength(0);
  });

  it("tasks are assigned with tasks.assign and notify the assignee", async () => {
    [{ id: task }] = await q("pm", "insert into public.tasks (organization_id, project_id, title) values ($1, $2, 'Install WAPs') returning id", [f.orgA, project]);
    await q("pm", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [task, f.orgA, f.u.bob]);
    const notes = await q("bob", "select title from public.notifications where kind = 'task'");
    expect(notes[0].title).toContain("Install WAPs");
    await expect(q("cara", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [task, f.orgA, f.u.bob])).rejects.toThrow(/row-level security|tasks.assign|not an active member|assigned by your manager/);
  });

  it("assignees update status; completion time is set by the database", async () => {
    await q("bob", "update public.tasks set status = 'done' where id = $1", [task]);
    const [t] = await q("bob", "select status, completed_at from public.tasks where id = $1", [task]);
    expect(t.status).toBe("done");
    expect(t.completed_at).not.toBeNull();
    const none = await as(db, f.claims("outsider"), (c) => c("update public.tasks set status = 'todo' where id = $1", [task]));
    expect(none.rowCount).toBe(0);
  });

  it("employees add their own tasks, assign only themselves, and can't edit tasks set by management", async () => {
    const [{ id: own }] = await q("cara", "insert into public.tasks (organization_id, title) values ($1, 'Renew passport') returning id", [f.orgA]);
    await q("cara", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [own, f.orgA, f.u.cara]);
    await q("cara", "update public.tasks set title = 'Renew passport (UK)', due_date = '2026-12-01' where id = $1", [own]);
    await expect(q("cara", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [own, f.orgA, f.u.bob])).rejects.toThrow(/assigned by your manager/);
    await expect(q("cara", "insert into public.tasks (organization_id, project_id, title) values ($1, $2, 'Not my project')", [f.orgA, project])).rejects.toThrow(/projects you work on/);
    await expect(q("bob", "insert into public.task_assignees (task_id, organization_id, user_id) values ($1, $2, $3)", [task, f.orgA, f.u.cara])).rejects.toThrow(/assigned by your manager/);
    await expect(q("bob", "update public.tasks set title = 'Mine now' where id = $1", [task])).rejects.toThrow(/other changes are made by your manager/);
    // Bob works on the project, so he may add his own task to it.
    await q("bob", "insert into public.tasks (organization_id, project_id, title) values ($1, $2, 'Label the WAPs')", [f.orgA, project]);
  });

  it("staff's own tasks are private from colleagues but visible to management", async () => {
    const [{ id }] = await q("cara", "insert into public.tasks (organization_id, title) values ($1, 'Book eye test') returning id", [f.orgA]);
    expect(await q("bob", "select id from public.tasks where id = $1", [id])).toHaveLength(0);
    expect(await q("cara", "select id from public.tasks where id = $1", [id])).toHaveLength(1);
    expect(await q("admin", "select id from public.tasks where id = $1", [id])).toHaveLength(1);
    expect(await q("outsider", "select id from public.tasks where id = $1", [id])).toHaveLength(0);
  });

  it("project scope is now valid for role assignments", async () => {
    await q("admin", "insert into public.membership_role_assignments (organization_id, membership_id, role_id, scope_type, scope_id) values ($1, $2, $3, 'project', $4)",
      [f.orgA, f.m.cara, await f.role(f.orgA, "project_manager"), project]);
    expect((await q("cara", "select public.can_edit_project($1) ok", [project]))[0].ok).toBe(true);
    expect((await q("cara", "select public.has_permission($1, 'projects.edit') ok", [f.orgA]))[0].ok).toBe(false);
    expect((await q("cara", "select public.has_permission($1, 'projects.edit', 'project', $2) ok", [f.orgA, project]))[0].ok).toBe(true);
  });
});

describe("timesheets", () => {
  let sheet: string;
  const monday = "2026-10-19";

  it("basic employees can't type lines; nobody can forge clock-in lines", async () => {
    const [{ id }] = await q("cara", "select public.ensure_timesheet($1, '2026-11-02') as id", [f.orgA]);
    await expect(q("cara", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-11-02', 8)", [f.orgA, id])).rejects.toThrow(/filled from your clock-ins/);
    await expect(q("cara", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours, from_clock) values ($1, $2, '2026-11-02', 8, true)", [f.orgA, id])).rejects.toThrow(/comes from your clock-ins/);
  });

  it("are created per ISO week and only the owner adds entries", async () => {
    // Bob is trusted to manage his own time (an individual exception set by management).
    await db.query("insert into public.scoped_permission_overrides (organization_id, membership_id, permission_key, effect, reason) values ($1, $2, 'work.self_manage', 'grant', 'Senior engineer')", [f.orgA, f.m.bob]);
    [{ id: sheet }] = await q("bob", "select public.ensure_timesheet($1, '2026-10-21') as id", [f.orgA]);
    const [row] = await q("bob", "select week_start::text from public.timesheets where id = $1", [sheet]);
    expect(row.week_start).toBe(monday);
    await q("bob", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-20', 7.5)", [f.orgA, sheet]);
    await expect(q("cara", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-20', 1)", [f.orgA, sheet])).rejects.toThrow(/row-level security|can no longer be changed/);
    await expect(q("bob", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-30', 1)", [f.orgA, sheet])).rejects.toThrow(/inside this timesheet week/);
    await expect(q("bob", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-20', 20)", [f.orgA, sheet])).rejects.toThrow(/More than 24 hours/);
  });

  it("lock on submission and need a supervisor to approve", async () => {
    await q("bob", "select public.submit_timesheet($1)", [sheet]);
    await expect(q("bob", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-21', 1)", [f.orgA, sheet])).rejects.toThrow(/can no longer be changed/);
    expect((await q("lead", "select timesheets from public.my_approval_counts($1)", [f.orgA]))[0].timesheets).toBe("1");
    await expect(q("cara", "select public.review_timesheet($1, true)", [sheet])).rejects.toThrow(/cannot approve/);
    await expect(q("lead", "select public.review_timesheet($1, false, '')", [sheet])).rejects.toThrow(/Explain/);
    await q("lead", "select public.review_timesheet($1, true, null)", [sheet]);
    const [t] = await q("bob", "select status, reviewed_by from public.timesheets where id = $1", [sheet]);
    expect(t.status).toBe("approved");
    expect(t.reviewed_by).toBe(f.u.lead);
  });

  it("can't be self-approved by managers, but a Super Admin may approve their own", async () => {
    const [{ id: own }] = await q("lead", "select public.ensure_timesheet($1, '2026-10-21') as id", [f.orgA]);
    await db.query("insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-19', 8)", [f.orgA, own]);
    await q("lead", "select public.submit_timesheet($1)", [own]);
    await expect(q("lead", "select public.review_timesheet($1, true)", [own])).rejects.toThrow(/cannot approve/);

    const [{ id }] = await q("admin", "select public.ensure_timesheet($1, '2026-10-21') as id", [f.orgA]);
    await q("admin", "insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-19', 8)", [f.orgA, id]);
    await q("admin", "select public.submit_timesheet($1)", [id]);
    await q("admin", "select public.review_timesheet($1, true)", [id]);
    expect((await q("admin", "select status from public.timesheets where id = $1", [id]))[0].status).toBe("approved");
  });

  it("cannot be modified directly", async () => {
    await expect(q("bob", "update public.timesheets set status = 'approved' where id = $1", [sheet])).rejects.toThrow(/permission denied/);
  });
});

describe("leave", () => {
  let annual: string;
  beforeAll(async () => {
    annual = (await db.query("select id from public.leave_types where organization_id = $1 and name = 'Annual leave'", [f.orgA])).rows[0].id;
    await db.query("insert into public.public_holidays (organization_id, holiday_date, name) values ($1, '2026-12-25', 'Christmas Day')", [f.orgA]);
  });

  it("counts working days excluding weekends, holidays and halves", async () => {
    const r = await q("bob", "select public.leave_days($1, '2026-12-21', '2026-12-28', false, true) d", [f.orgA]);
    // Mon 21 .. Mon 28: 21,22,23,24,(25 holiday),28 => 5 working days, minus half on 28th = 4.5
    expect(Number(r[0].d)).toBe(4.5);
  });

  it("prevents overlapping requests and keeps the reason private", async () => {
    const [{ id }] = await q("bob", "select public.request_leave($1, $2, '2026-11-02', '2026-11-06', false, false, 'Family wedding') as id", [f.orgA, annual]);
    await expect(q("bob", "select public.request_leave($1, $2, '2026-11-05', '2026-11-09', false, false, null)", [f.orgA, annual])).rejects.toThrow(/already have leave/);
    expect(await q("bob", "select reason from public.leave_request_reasons where request_id = $1", [id])).toHaveLength(1);
    expect(await q("lead", "select reason from public.leave_request_reasons where request_id = $1", [id])).toHaveLength(0);
    expect(await q("lead", "select id from public.leave_requests where id = $1", [id])).toHaveLength(1);
    expect(await q("cara", "select id from public.leave_requests where id = $1", [id])).toHaveLength(0);
    const cal = await q("cara", "select user_id from public.team_absences($1, '2026-11-01', '2026-11-30')", [f.orgA]);
    expect(cal.map((r) => r.user_id)).toContain(f.u.bob);
  });

  it("is approved by a supervisor and reduces the balance", async () => {
    const [{ id }] = await q("bob", "select id from public.leave_requests where membership_id = $1 and status = 'pending'", [f.m.bob]);
    await expect(q("bob", "select public.review_leave($1, true)", [id])).rejects.toThrow(/cannot approve/);
    await q("lead", "select public.review_leave($1, true, 'Enjoy')", [id]);
    const [bal] = await q("bob", "select allowance, taken, remaining from public.leave_balances($1, $2, 2026) where name = 'Annual leave'", [f.orgA, f.m.bob]);
    expect(Number(bal.taken)).toBe(5);
    expect(Number(bal.remaining)).toBe(20);
    expect(await q("cara", "select * from public.leave_balances($1, $2, 2026)", [f.orgA, f.m.bob])).toHaveLength(0);
  });

  it("requests cannot be inserted directly", async () => {
    await expect(q("bob", "insert into public.leave_requests (organization_id, membership_id, leave_type_id, start_date, end_date) values ($1, $2, $3, '2026-12-01', '2026-12-01')", [f.orgA, f.m.bob, annual])).rejects.toThrow(/permission denied/);
  });
});

describe("schedules", () => {
  it("are visible to colleagues but only managed by supervisors", async () => {
    await expect(q("bob", "insert into public.shifts (organization_id, membership_id, starts_at, ends_at, created_by) values ($1, $2, '2026-10-22 08:00Z', '2026-10-22 16:00Z', $3)", [f.orgA, f.m.bob, f.u.bob])).rejects.toThrow(/row-level security/);
    await q("lead", "insert into public.shifts (organization_id, membership_id, starts_at, ends_at, created_by) values ($1, $2, '2026-10-22 08:00Z', '2026-10-22 16:00Z', $3)", [f.orgA, f.m.bob, f.u.lead]);
    expect(await q("cara", "select id from public.shifts where membership_id = $1", [f.m.bob])).toHaveLength(1);
    expect(await q("outsider", "select id from public.shifts where membership_id = $1", [f.m.bob])).toHaveLength(0);
    await expect(q("lead", "insert into public.shifts (organization_id, membership_id, starts_at, ends_at, created_by) values ($1, $2, '2026-10-22 08:00Z', '2026-10-22 16:00Z', $3)", [f.orgA, f.m.cara, f.u.lead])).rejects.toThrow(/row-level security/);
  });
});
