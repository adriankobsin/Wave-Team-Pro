import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { listPeople } from "@/server/services/people";
import { Avatar, PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, Badge, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ org: string; membershipId: string }> }) {
  const { org: slug, membershipId } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.hasAnyScope("users.view")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;

  const people = await listPeople(ctx.org.id, { includeInactive: true, withFullAvatars: true, showEmail: ctx.settings.directory_show_email });
  const person = people.find((p) => p.membershipId === membershipId);
  if (!person) notFound();
  const manager = person.managerMembershipId ? people.find((p) => p.membershipId === person.managerMembershipId) : undefined;
  const reports = people.filter((p) => p.managerMembershipId === person.membershipId && p.status === "active");
  const base = `/o/${ctx.org.slug}`;
  const inactive = person.status !== "active";
  const localTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: person.timezone }).format(new Date());

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`${base}/people`} className="text-sm text-ink-muted underline-offset-4 hover:underline">
        People
      </Link>
      <Panel className="mt-3 overflow-hidden">
        <div className="flex flex-col items-start gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <Avatar id={person.userId} name={person.name} src={person.avatarFullUrl ?? person.avatarUrl} size="xl" inactive={inactive} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold sm:text-3xl">{person.name}</h1>
            <p className="mt-1 text-ink-muted">{[person.jobTitle, person.departmentName].filter(Boolean).join(", ") || "No job title yet"}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {inactive ? <Badge tone="danger">No longer active</Badge> : null}
              {person.roles.map((r) => (
                <Badge key={`${r.id}-${r.scopeId}`}>{r.name}{r.scopeType !== "organization" ? " (team)" : ""}</Badge>
              ))}
            </div>
          </div>
        </div>
        <dl className="grid border-t border-line sm:grid-cols-2">
          {person.email ? (
            <div className="border-b border-line px-5 py-3 sm:border-r">
              <dt className="text-xs text-ink-muted">Email</dt>
              <dd className="mt-0.5 truncate"><a className="underline-offset-4 hover:underline" href={`mailto:${person.email}`}>{person.email}</a></dd>
            </div>
          ) : null}
          <div className="border-b border-line px-5 py-3">
            <dt className="text-xs text-ink-muted">Local time</dt>
            <dd className="tabular mt-0.5">{localTime} <span className="text-sm text-ink-muted">({person.timezone})</span></dd>
          </div>
          <div className="border-b border-line px-5 py-3 sm:border-r">
            <dt className="text-xs text-ink-muted">Teams</dt>
            <dd className="mt-0.5">{person.teams.length ? person.teams.map((t) => `${t.name}${t.isLead ? " (lead)" : ""}`).join(", ") : "None"}</dd>
          </div>
          <div className="border-b border-line px-5 py-3">
            <dt className="text-xs text-ink-muted">Started</dt>
            <dd className="mt-0.5">{person.startDate ? formatDate(person.startDate, ctx.org.timezone) : "Not recorded"}</dd>
          </div>
        </dl>
        {manager || reports.length ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {manager ? (
              <div>
                <p className="mb-2 text-xs text-ink-muted">Reports to</p>
                <Link href={`${base}/people/${manager.membershipId}`}>
                  <PersonLabel id={manager.userId} name={manager.name} src={manager.avatarUrl} sub={manager.jobTitle} inactive={manager.status !== "active"} />
                </Link>
              </div>
            ) : null}
            {reports.length ? (
              <div>
                <p className="mb-2 text-xs text-ink-muted">Direct reports</p>
                <ul className="space-y-2">
                  {reports.map((r) => (
                    <li key={r.membershipId}>
                      <Link href={`${base}/people/${r.membershipId}`}>
                        <PersonLabel id={r.userId} name={r.name} src={r.avatarUrl} sub={r.jobTitle} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>
      {ctx.perms.has("users.edit") || ctx.perms.has("roles.manage") || ctx.perms.has("users.deactivate") ? (
        <div className="mt-4">
          <Link href={`${base}/admin/members/${person.membershipId}`} className={buttonClass("secondary")}>
            Manage employment and access
          </Link>
        </div>
      ) : null}
    </div>
  );
}
