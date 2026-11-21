import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { listPeople } from "@/server/services/people";
import { staffCompanies } from "@/server/services/group-staff";
import { redirect } from "next/navigation";
import { PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ show?: string; scope?: string }> }) {
  const { org: slug } = await params;
  const { show, scope } = await searchParams;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!(ctx.perms.has("users.edit") || ctx.perms.has("users.deactivate") || ctx.perms.has("roles.manage"))) {
    return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  }
  // People who manage staff in several companies see everyone, across companies, by default.
  if (scope !== "company") {
    const { checks } = await staffCompanies();
    if (checks.filter((c) => c.manage).length > 1) redirect(`/o/${ctx.org.slug}/admin/staff`);
  }
  const all = await listPeople(ctx.org.id, { includeInactive: true });
  const showInactive = show === "all";
  const people = showInactive ? all : all.filter((p) => p.status === "active");
  const inactiveCount = all.length - all.filter((p) => p.status === "active").length;
  const base = `/o/${ctx.org.slug}`;

  return (
    <div>
      <PageHeader
        title="Members"
        description="Open a person to change their role, team, manager or access."
        actions={ctx.perms.has("users.invite") ? <Link className={buttonClass()} href={`${base}/admin/invitations`}>Invite someone</Link> : null}
      />
      <p className="mb-3 text-sm text-ink-muted">Members of {ctx.org.name}. <Link className="underline underline-offset-4" href={`${base}/admin/staff`}>See staff in all companies</Link></p>
      {inactiveCount ? (
        <p className="mb-3 text-sm">
          <Link className="underline underline-offset-4" href={showInactive ? `${base}/admin/members?scope=company` : `${base}/admin/members?scope=company&show=all`}>
            {showInactive ? "Hide former members" : `Show ${inactiveCount} former ${inactiveCount === 1 ? "member" : "members"}`}
          </Link>
        </p>
      ) : null}
      <Panel>
        {people.length ? (
          <ul className="divide-y divide-line">
            {people.map((p) => (
              <li key={p.membershipId}>
                <Link href={`${base}/admin/members/${p.membershipId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-panel-sunk sm:px-5">
                  <PersonLabel id={p.userId} name={p.name} src={p.avatarUrl} sub={[p.jobTitle, p.email].filter(Boolean).join(", ")} inactive={p.status !== "active"} size="md" />
                  <span className="flex flex-wrap gap-1.5 pl-[3.25rem] sm:pl-0">
                    {p.status !== "active" ? <Badge tone="danger">{p.status === "deactivated" ? "Deactivated" : "Suspended"}</Badge> : null}
                    {p.roles.length ? p.roles.map((r) => <Badge key={`${r.id}-${r.scopeId}`}>{r.name}{r.scopeType === "team" ? " (team)" : ""}</Badge>) : <Badge tone="warn">No role</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No members yet" />
        )}
      </Panel>
    </div>
  );
}
