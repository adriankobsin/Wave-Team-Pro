import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect } from "./support/db";
import { buildOrgs } from "./support/fixture";

let db: Client;
let f: Awaited<ReturnType<typeof buildOrgs>>;

beforeAll(async () => {
  db = await connect();
  f = await buildOrgs(db, { admin: "super_admin", bob: "employee", cara: "employee", vic: "va_admin" });
});
afterAll(async () => db?.end());

const q1 = async (who: string, sql: string, params: unknown[] = []) =>
  (await as(db, f.claims(who), (q) => q(sql, params))).rows;

describe("company channel", () => {
  it("is created for every organization and readable by all members only", async () => {
    const mine = await q1("bob", "select id, name from public.my_conversations($1) where type = 'channel'", [f.orgA]);
    expect(mine.map((r) => r.name)).toContain("general");
    const outsider = await q1("outsider", "select id from public.conversations where id = $1", [mine[0].id]);
    expect(outsider).toHaveLength(0);
  });

  it("lets members post and notifies mentioned people", async () => {
    const [{ id }] = await q1("bob", "select id from public.my_conversations($1) where type = 'channel'", [f.orgA]);
    await q1("bob", "insert into public.messages (organization_id, conversation_id, body, mentions) values ($1, $2, 'hi @cara', $3)", [f.orgA, id, [f.u.cara]]);
    const notes = await q1("cara", "select kind from public.notifications where organization_id = $1", [f.orgA]);
    expect(notes.map((n) => n.kind)).toContain("mention");
  });
});

describe("direct messages", () => {
  let dm: string;
  beforeAll(async () => {
    dm = (await q1("bob", "select public.start_direct_conversation($1, $2) as id", [f.orgA, f.u.cara]))[0].id;
    await q1("bob", "insert into public.messages (organization_id, conversation_id, body) values ($1, $2, 'private note')", [f.orgA, dm]);
  });

  it("are reused for the same pair", async () => {
    const again = (await q1("cara", "select public.start_direct_conversation($1, $2) as id", [f.orgA, f.u.bob]))[0].id;
    expect(again).toBe(dm);
  });

  it("are visible to participants and notify the recipient", async () => {
    expect(await q1("cara", "select body from public.messages where conversation_id = $1", [dm])).toHaveLength(1);
    const unread = await q1("cara", "select unread_count from public.my_conversations($1) where id = $2", [f.orgA, dm]);
    expect(Number(unread[0].unread_count)).toBe(1);
    expect((await q1("cara", "select kind from public.notifications where kind = 'message'")).length).toBeGreaterThan(0);
  });

  it("are NOT visible to the Super Admin or the platform owner", async () => {
    expect(await q1("admin", "select id from public.messages where conversation_id = $1", [dm])).toHaveLength(0);
    expect(await q1("admin", "select id from public.conversations where id = $1", [dm])).toHaveLength(0);
    expect(await q1("owner", "select id from public.messages where conversation_id = $1", [dm])).toHaveLength(0);
  });

  it("cannot be posted into by non-participants", async () => {
    await expect(
      q1("vic", "insert into public.messages (organization_id, conversation_id, body) values ($1, $2, 'sneak')", [f.orgA, dm]),
    ).rejects.toThrow(/row-level security/);
  });

  it("only the author can edit, and impersonation is impossible", async () => {
    const [{ id }] = await q1("bob", "select id from public.messages where conversation_id = $1", [dm]);
    await expect(q1("cara", "update public.messages set body = 'edited' where id = $1", [id])).rejects.toThrow(/Only the author/);
    await q1("bob", "update public.messages set body = 'fixed' where id = $1", [id]);
    const [row] = await q1("cara", "select body, edited_at from public.messages where id = $1", [id]);
    expect(row.body).toBe("fixed");
    expect(row.edited_at).not.toBeNull();
    const [forged] = await q1("cara", "insert into public.messages (organization_id, conversation_id, author_id, body) values ($1, $2, $3, 'as bob') returning author_id", [f.orgA, dm, f.u.bob]);
    expect(forged.author_id).toBe(f.u.cara);
  });

  it("cannot be started with people outside the organization", async () => {
    await expect(q1("bob", "select public.start_direct_conversation($1, $2)", [f.orgA, f.u.outsider])).rejects.toThrow(/not available/);
  });
});

describe("channels and groups", () => {
  it("require chat.channel.create for channels but anyone can start a group", async () => {
    await expect(q1("bob", "select public.create_conversation($1, 'channel', 'random', null, 'organization', null, '{}')", [f.orgA])).rejects.toThrow(/chat.channel.create/);
    const [{ id }] = await q1("bob", "select public.create_conversation($1, 'group', 'Lunch', null, null, null, $2) as id", [f.orgA, [f.u.cara, f.u.outsider]]);
    const members = await q1("cara", "select user_id from public.conversation_members where conversation_id = $1", [id]);
    expect(members.map((r) => r.user_id).sort()).toEqual([f.u.bob, f.u.cara].sort());
  });
});

describe("files", () => {
  it("are readable only through the object they belong to", async () => {
    const [{ id: conv }] = await q1("bob", "select public.start_direct_conversation($1, $2) as id", [f.orgA, f.u.cara]);
    const [{ id: msg }] = await q1("bob", "insert into public.messages (organization_id, conversation_id, body) values ($1, $2, 'see pdf') returning id", [f.orgA, conv]);
    const path = `${f.orgA}/chat/${msg}/report.pdf`;
    const [{ id: file }] = (await db.query(
      `insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
       values ($1, $2, 'report.pdf', 'application/pdf', 1000, repeat('a', 64), 'message', $3, $4) returning id`,
      [f.orgA, path, msg, f.u.bob],
    )).rows;
    await db.query("insert into public.message_attachments (message_id, file_id) values ($1, $2)", [msg, file]);
    await db.query("insert into storage.objects (bucket_id, name) values ('files', $1)", [path]);

    expect(await q1("cara", "select id from public.files where id = $1", [file])).toHaveLength(1);
    expect(await q1("cara", "select name from storage.objects where name = $1", [path])).toHaveLength(1);
    expect(await q1("vic", "select id from public.files where id = $1", [file])).toHaveLength(0);
    expect(await q1("vic", "select name from storage.objects where name = $1", [path])).toHaveLength(0);
    expect(await q1("admin", "select name from storage.objects where name = $1", [path])).toHaveLength(0);
    expect(await q1("outsider", "select name from storage.objects where name = $1", [path])).toHaveLength(0);
  });

  it("cannot be inserted directly by users", async () => {
    await expect(
      q1("bob", `insert into public.files (organization_id, storage_path, file_name, mime_type, size_bytes, sha256, context_type, context_id, uploaded_by)
                 values ($1, $3, 'x', 'text/plain', 1, repeat('a', 64), 'message', gen_random_uuid(), $2)`, [f.orgA, f.u.bob, `${f.orgA}/x`]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("announcements", () => {
  it("need announcements.publish and are acknowledged by readers", async () => {
    await expect(q1("bob", "insert into public.announcements (organization_id, title, body) values ($1, 'Hi all', 'x')", [f.orgA])).rejects.toThrow(/announcements.publish/);
    const [{ id }] = await q1("vic", "insert into public.announcements (organization_id, title, body, requires_ack) values ($1, 'Safety briefing', 'Read this', true) returning id", [f.orgA]);
    expect(await q1("bob", "select id from public.announcements where id = $1", [id])).toHaveLength(1);
    expect(await q1("outsider", "select id from public.announcements where id = $1", [id])).toHaveLength(0);
    await q1("bob", "insert into public.announcement_acknowledgements (announcement_id, user_id) values ($1, $2)", [id, f.u.bob]);
    expect(await q1("vic", "select user_id from public.announcement_acknowledgements where announcement_id = $1", [id])).toHaveLength(1);
    expect(await q1("cara", "select user_id from public.announcement_acknowledgements where announcement_id = $1", [id])).toHaveLength(0);
    expect((await q1("cara", "select kind from public.notifications where kind = 'announcement'")).length).toBe(1);
  });
});

describe("documents", () => {
  it("company folder is readable by members; HR folder only by HR", async () => {
    const folders = await q1("bob", "select name, scope from public.folders where organization_id = $1", [f.orgA]);
    expect(folders.map((x) => x.scope)).toEqual(["organization"]);
    const admin = await q1("admin", "select scope from public.folders where organization_id = $1 order by scope", [f.orgA]);
    expect(admin.map((x) => x.scope)).toEqual(["hr", "organization"]);
  });

  it("personal folders are private to their owner", async () => {
    const [{ id }] = await q1("bob", "insert into public.folders (organization_id, name, scope, owner_id, created_by) values ($1, 'Mine', 'personal', $2, $2) returning id", [f.orgA, f.u.bob]);
    expect(await q1("admin", "select id from public.folders where id = $1", [id])).toHaveLength(0);
    expect((await q1("bob", "select public.can_write_folder($1) as ok", [id]))[0].ok).toBe(true);
    expect((await q1("cara", "select public.can_write_folder($1) as ok", [id]))[0].ok).toBe(false);
  });

  it("employees cannot create company-level folders", async () => {
    await expect(q1("bob", "insert into public.folders (organization_id, name, scope, created_by) values ($1, 'Rogue', 'organization', $2)", [f.orgA, f.u.bob])).rejects.toThrow(/row-level security/);
  });
});

describe("notifications", () => {
  it("are private and only the read flag can be changed", async () => {
    const mine = await q1("cara", "select id from public.notifications");
    expect(mine.length).toBeGreaterThan(0);
    expect(await q1("bob", "select id from public.notifications where id = $1", [mine[0].id])).toHaveLength(0);
    await q1("cara", "update public.notifications set read_at = now() where id = $1", [mine[0].id]);
    await expect(q1("cara", "update public.notifications set title = 'x' where id = $1", [mine[0].id])).rejects.toThrow(/permission denied/);
    await expect(q1("cara", "select public.notify($1, $2, 'x', 'x', null, null)", [f.orgA, f.u.bob])).rejects.toThrow(/permission denied/);
  });
});
