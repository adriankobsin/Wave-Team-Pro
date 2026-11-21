/**
 * TypeScript mirror of the `public.permissions` catalog (seeded in
 * supabase/migrations/20261020000200_permissions.sql). The database is authoritative; this
 * list provides types and labels for the UI. A unit test checks the two stay in sync.
 */
export const PERMISSIONS = [
  "users.view",
  "users.invite",
  "users.edit",
  "users.deactivate",
  "users.view.private",
  "roles.manage",
  "org.settings.manage",
  "org.structure.manage",
  "audit.view",
  "announcements.publish",
  "chat.channel.create",
  "chat.channel.moderate",
  "documents.upload",
  "documents.read",
  "documents.manage",
  "hr.documents.manage",
  "projects.view",
  "projects.create",
  "projects.edit",
  "tasks.assign",
  "attendance.view.self",
  "attendance.view.team",
  "attendance.view.all",
  "timesheets.submit",
  "timesheets.approve",
  "leave.request",
  "leave.approve",
  "expenses.create",
  "expenses.view.self",
  "expenses.view.team",
  "expenses.view.all",
  "expenses.approve",
  "expenses.export",
  "reimbursements.manage",
  "reports.view",
  "reports.export",
  "work.self_manage",
  "invites.send",
  "tasks.view.all",
  "credentials.view",
  "credentials.manage",
  "staffing.view",
  "staffing.assign",
  "travel.manage",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];
export type ScopeType = "organization" | "team" | "project";

export type EffectivePermission = { permission_key: string; scope_type: ScopeType; scope_id: string | null };

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Immutable effective-permission set for one membership, used for UI gating only. */
export class PermissionSet {
  private readonly org = new Set<string>();
  private readonly scoped = new Set<string>();
  private readonly any = new Set<string>();

  constructor(rows: EffectivePermission[]) {
    for (const r of rows) {
      this.any.add(r.permission_key);
      if (r.scope_type === "organization") this.org.add(r.permission_key);
      else this.scoped.add(`${r.permission_key}|${r.scope_type}|${r.scope_id}`);
    }
  }

  /** Organization-wide grant (or the exact scope, when given). */
  has(key: PermissionKey, scope?: { type: Exclude<ScopeType, "organization">; id: string }) {
    if (this.org.has(key)) return true;
    return scope ? this.scoped.has(`${key}|${scope.type}|${scope.id}`) : false;
  }

  /** Granted at any scope — for showing navigation entries. */
  hasAnyScope(key: PermissionKey) {
    return this.any.has(key);
  }

  get size() {
    return this.any.size;
  }
}

export const MODULE_LABELS: Record<string, string> = {
  people: "People",
  admin: "Administration",
  communication: "Communication",
  documents: "Documents",
  projects: "Projects & tasks",
  workforce: "Attendance, timesheets & leave",
  finance: "Expenses & reimbursements",
  reports: "Reports",
};
