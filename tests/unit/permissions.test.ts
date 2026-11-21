import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, PermissionSet } from "@/lib/permissions/catalog";
import { assignmentSchema, inviteSchema, overrideSchema, roleSchema } from "@/lib/validation/schemas";

const migration = ["20261020000200_permissions.sql", "20261027000100_assigned_work.sql", "20261029000700_outlook.sql", "20261029001200_own_tasks.sql", "20261108000700_credentials.sql", "20261111000100_staffing_travel.sql"]
  .map((f) => readFileSync(path.resolve(__dirname, "../../supabase/migrations", f), "utf8"))
  .join("\n");

describe("permission catalog", () => {
  it("matches the database seed exactly", () => {
    const seeded = [...migration.matchAll(/^\s*\('([a-z._]+)',\s+'[a-z]+',/gm)].map((m) => m[1]);
    expect(new Set(seeded)).toEqual(new Set(PERMISSIONS));
    expect(seeded.length).toBe(PERMISSIONS.length);
  });
});

describe("PermissionSet", () => {
  const set = new PermissionSet([
    { permission_key: "users.view", scope_type: "organization", scope_id: null },
    { permission_key: "leave.approve", scope_type: "team", scope_id: "t1" },
  ]);
  it("treats organization grants as covering every scope", () => {
    expect(set.has("users.view")).toBe(true);
    expect(set.has("users.view", { type: "team", id: "t9" })).toBe(true);
  });
  it("does not widen scoped grants", () => {
    expect(set.has("leave.approve")).toBe(false);
    expect(set.has("leave.approve", { type: "team", id: "t1" })).toBe(true);
    expect(set.has("leave.approve", { type: "team", id: "t2" })).toBe(false);
    expect(set.hasAnyScope("leave.approve")).toBe(true);
  });
});

describe("validation", () => {
  const org = "7a1d8f9e-1c2b-4d3e-8f4a-5b6c7d8e9f01";
  it("normalizes invitation input", () => {
    const parsed = inviteSchema.parse({ organization_id: org, email: "  Bob@Example.TEST ", role_id: org, team_id: "" });
    expect(parsed.email).toBe("bob@example.test");
    expect(parsed.team_id).toBeNull();
  });
  it("rejects unknown permission keys in role definitions", () => {
    expect(roleSchema.safeParse({ organization_id: org, name: "X role", permissions: ["users.view", "god.mode"] }).success).toBe(false);
  });
  it("requires a team for team-scoped assignments", () => {
    expect(assignmentSchema.safeParse({ organization_id: org, membership_id: org, role_id: org, scope_type: "team", scope_id: "" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ organization_id: org, membership_id: org, role_id: org, scope_type: "organization", scope_id: "" }).success).toBe(true);
  });
  it("requires a reason for overrides", () => {
    expect(overrideSchema.safeParse({ organization_id: org, membership_id: org, permission_key: "users.view", effect: "deny", scope_type: "organization", reason: "" }).success).toBe(false);
  });
});
