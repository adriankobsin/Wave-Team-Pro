import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", hr: "hr_manager", boss: "director", bob: "employee", cara: "employee" });
});
afterAll(async () => db?.end());

const q = async (who: string, sql: string, params: unknown[] = []) => (await as(db, f.claims(who), (c) => c(sql, params))).rows;
const inbox = async (who: string, like: string) =>
  (await db.query("select title from public.notifications where user_id = $1 and kind = 'management' and title like $2", [f.u[who], like])).rows;

describe("management notifications", () => {
  it("every company has a Director role", async () => {
    expect((await db.query("select count(*)::int n from public.roles where organization_id = $1 and key = 'director'", [f.orgA])).rows[0].n).toBe(1);
  });

  it("new joiners are announced to admin, HR and directors (not employees)", async () => {
    // fixture joins happened through accept_invitation, so the notifications already exist
    expect((await inbox("hr", "Cara has joined")).length).toBe(1);
    expect((await inbox("boss", "Cara has joined")).length).toBe(1);
    expect((await inbox("admin", "Cara has joined")).length).toBe(1);
    expect((await inbox("bob", "Cara has joined")).length).toBe(0);
  });

  it("clock in/out is reported with the time", async () => {
    await q("bob", "select public.clock($1, 'clock_in')", [f.orgA]);
    const rows = await inbox("hr", "Bob clocked in at %");
    expect(rows.length).toBe(1);
    expect((await inbox("bob", "Bob clocked in%")).length).toBe(0);
  });

  it("uploads are reported, chat attachments are not", async () => {
    for (const [ctx, name] of [["document", "policy.pdf"], ["message", "private.jpg"]]) {
      await db.query(`insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
        values ($1::uuid, $1::text || '/x/' || gen_random_uuid() || '.pdf', $2, 'application/pdf', 10, $3, $4, gen_random_uuid(), $5)`, [f.orgA, name, "c".repeat(64), ctx, f.u.cara]);
    }
    expect((await inbox("boss", "Cara uploaded policy.pdf")).length).toBe(1);
    expect((await inbox("boss", "%private.jpg%")).length).toBe(0);
  });

  it("recipients and events are configurable; disabling stops them", async () => {
    await q("admin", "insert into public.management_alert_events (organization_id, event, custom_recipients) values ($1, 'clock', true)", [f.orgA]);
    await q("admin", "insert into public.management_alert_recipients (organization_id, event, membership_id) values ($1, 'clock', $2)", [f.orgA, f.m.boss]);
    await expect(q("bob", "insert into public.management_alert_events (organization_id, event) values ($1, 'upload')", [f.orgA])).rejects.toThrow(/row-level security/);
    await q("cara", "select public.clock($1, 'clock_in')", [f.orgA]);
    expect((await inbox("boss", "Cara clocked in%")).length).toBe(1);
    expect((await inbox("hr", "Cara clocked in%")).length).toBe(0);
    await q("admin", "update public.management_alert_events set enabled = false where organization_id = $1 and event = 'clock'", [f.orgA]);
    await q("cara", "select public.clock($1, 'clock_out')", [f.orgA]);
    expect((await inbox("boss", "Cara clocked out%")).length).toBe(0);
  });

  it("timesheet submissions are reported", async () => {
    const [{ id }] = await q("bob", "select public.ensure_timesheet($1, '2026-10-12') id", [f.orgA]);
    await db.query("insert into public.timesheet_entries (organization_id, timesheet_id, work_date, hours) values ($1, $2, '2026-10-12', 7.5)", [f.orgA, id]);
    await q("bob", "select public.submit_timesheet($1)", [id]);
    expect((await inbox("hr", "Bob submitted a timesheet")).length).toBe(1);
  });

  it("invitation links are server-only", async () => {
    await expect(q("admin", "select * from public.invitation_links")).rejects.toThrow(/permission denied/);
  });
});
