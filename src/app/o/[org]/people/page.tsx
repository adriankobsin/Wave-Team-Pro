import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { filterPeople, getStructure, listPeople } from "@/server/services/people";
import { staffCompanies } from "@/server/services/group-staff";
import { Notice } from "@/components/ui/misc";
import { PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { controlClass } from "@/components/ui/control-class";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string; department?: string; team?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.hasAnyScope("users.view")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;

  const [people, structure, staff] = await Promise.all([
    listPeople(ctx.org.id, { showEmail: ctx.settings.directory_show_email }),
    getStructure(ctx.org.id),
    staffCompanies(),
  ]);
  const managedCompanies = staff.checks.filter((c) => c.manage).length;
  const shown = filterPeople(people, { text: sp.q, department: sp.department, team: sp.team });
  const base = `/o/${ctx.org.slug}`;
  const filtered = Boolean(sp.q || sp.department || sp.team);

  return (
    <div>
      <PageHeader
        title="People"
        description={`${people.length} ${people.length === 1 ? "person" : "people"} at ${ctx.org.name}`}
        actions={
          ctx.perms.has("users.invite") ? (
            <Link href={`${base}/admin/invitations`} className={buttonClass("primary", "md")}>
              Invite someone
            </Link>
          ) : null
        }
      />
      {managedCompanies > 1 ? (
        <div className="mb-4">
          <Notice title={`This list shows ${ctx.org.name} only`}>
            You manage staff in {managedCompanies} companies. <Link className="font-medium underline" href={`${base}/admin/staff`}>See everyone in all companies</Link>, with their company, location, role and status.
          </Notice>
        </div>
      ) : null}

      <form role="search" className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_12rem_auto]" action={`${base}/people`}>
        <label className="sr-only" htmlFor="q">Search people</label>
        <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Name, role, team or email" className={controlClass} />
        <label className="sr-only" htmlFor="department">Department</label>
        <select id="department" name="department" defaultValue={sp.department ?? ""} className={`${controlClass} h-10 py-0`}>
          <option value="">All departments</option>
          {structure.departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="team">Team</label>
        <select id="team" name="team" defaultValue={sp.team ?? ""} className={`${controlClass} h-10 py-0`}>
          <option value="">All teams</option>
          {structure.teams.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button type="submit" className={buttonClass("secondary")}>Search</button>
      </form>

      <Panel>
        {shown.length ? (
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <li key={p.membershipId}>
                <Link
                  href={`${base}/people/${p.membershipId}`}
                  className="grid gap-x-6 gap-y-1 px-4 py-3 hover:bg-panel-sunk sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:px-5"
                >
                  <PersonLabel id={p.userId} name={p.name} src={p.avatarUrl} sub={p.jobTitle} size="md" />
                  <span className="truncate pl-[3.25rem] text-sm text-ink-muted sm:pl-0">{p.departmentName ?? ""}</span>
                  <span className="hidden truncate text-sm text-ink-muted sm:block">{p.teams.map((t) => t.name).join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={filtered ? "No one matches" : "No one here yet"}>
            {filtered ? "Try a shorter search or clear the filters." : "Invite your colleagues to get started."}
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
