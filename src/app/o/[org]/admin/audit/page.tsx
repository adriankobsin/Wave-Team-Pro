import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { listAudit } from "@/server/services/admin";
import { listPeople } from "@/server/services/people";
import { PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { controlClass } from "@/components/ui/control-class";
import { buttonClass } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

const TABLES: Record<string, string> = {
  organization_memberships: "Membership",
  membership_role_assignments: "Role assignment",
  role_permissions: "Role permission",
  roles: "Role",
  scoped_permission_overrides: "Permission exception",
  invitations: "Invitation",
  departments: "Department",
  teams: "Team",
  team_memberships: "Team membership",
  organizations: "Organization",
  organization_settings: "Settings",
};
const ACTION: Record<string, string> = { insert: "Created", update: "Changed", delete: "Removed" };
const HIDDEN = new Set(["id", "organization_id", "created_at"]);

function summarize(values: Record<string, unknown> | null, fields: string[] | null) {
  if (!values) return "";
  const keys = (fields ?? Object.keys(values)).filter((k) => !HIDDEN.has(k)).slice(0, 4);
  return keys.map((k) => `${k.replaceAll("_", " ")}: ${values[k] === null ? "empty" : String(values[k]).slice(0, 40)}`).join("; ");
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ before?: string; table?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("audit.view")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const table = sp.table && TABLES[sp.table] ? sp.table : undefined;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : undefined;
  const [rows, people] = await Promise.all([listAudit(ctx.org.id, { before, table, limit: 50 }), listPeople(ctx.org.id, { includeInactive: true })]);
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const base = `/o/${ctx.org.slug}/admin/audit`;

  return (
    <div>
      <PageHeader title="Audit log" description="Every change to access, structure and settings. Entries can't be edited or deleted." />
      <form className="mb-4 flex flex-wrap gap-2" action={base}>
        <label htmlFor="table" className="sr-only">Type</label>
        <select id="table" name="table" defaultValue={table ?? ""} className={`${controlClass} h-10 w-auto py-0`}>
          <option value="">All changes</option>
          {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={buttonClass("secondary")} type="submit">Filter</button>
      </form>
      <Panel>
        {rows.length ? (
          <ol className="divide-y divide-line">
            {rows.map((r) => {
              const actor = r.actor_user_id ? byUser.get(r.actor_user_id) : undefined;
              return (
                <li key={r.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:px-5">
                  <div>
                    {actor ? (
                      <PersonLabel id={actor.userId} name={actor.name} src={actor.avatarUrl} sub={formatDateTime(r.created_at, ctx.profile.timezone)} inactive={actor.status !== "active"} />
                    ) : (
                      <span className="text-sm">
                        <span className="block font-medium">{r.actor_role === "service_role" || !r.actor_user_id ? "System" : "Platform"}</span>
                        <span className="block text-xs text-ink-muted">{formatDateTime(r.created_at, ctx.profile.timezone)}</span>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.action === "delete" ? "danger" : r.action === "insert" ? "ok" : "neutral"}>{ACTION[r.action]}</Badge>
                      <span className="font-medium">{TABLES[r.target_table] ?? r.target_table}</span>
                    </p>
                    <p className="mt-1 break-words text-ink-muted">
                      {r.action === "update" ? summarize(r.new_values, r.changed_fields) : summarize(r.new_values ?? r.old_values, null)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title="Nothing recorded yet" />
        )}
      </Panel>
      {rows.length === 50 ? (
        <div className="mt-4">
          <Link className={buttonClass("secondary")} href={`${base}?${new URLSearchParams({ ...(table ? { table } : {}), before: rows[rows.length - 1].created_at })}`}>
            Older entries
          </Link>
        </div>
      ) : null}
    </div>
  );
}
