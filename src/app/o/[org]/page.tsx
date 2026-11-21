import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { Avatar, PersonLabel } from "@/components/ui/avatar";
import { Notice, Panel, PanelHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Today } from "@/components/home/today";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const metadata: Metadata = { title: "Home" };

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { org: slug } = await params;
  const { welcome } = await searchParams;
  const ctx = await getOrgContext(slug);
  const base = `/o/${ctx.org.slug}`;
  const people = ctx.perms.has("users.view") ? await listPeople(ctx.org.id, { showEmail: ctx.settings.directory_show_email }) : [];
  const me = people.find((p) => p.membershipId === ctx.membership.id);
  const manager = me?.managerMembershipId ? people.find((p) => p.membershipId === me.managerMembershipId) : undefined;
  const reports = people.filter((p) => p.managerMembershipId === ctx.membership.id);
  const teammates = me
    ? people.filter((p) => p.membershipId !== me.membershipId && p.teams.some((t) => me.teams.some((mt) => mt.id === t.id)))
    : [];

  let pendingInvites = 0;
  if (ctx.perms.has("users.invite")) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.org.id)
      .eq("status", "pending");
    pendingInvites = count ?? 0;
  }
  const needsPhoto = !ctx.profile.avatar_path;
  const localTime = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: ctx.profile.timezone }).format(new Date());

  return (
    <div className="space-y-6">
      <header className="relative">
        <div className="absolute right-0 top-0">
          <SignOutButton label="Sign out" className="text-xs sm:text-sm" />
        </div>
        <p className="text-sm text-ink-muted">{localTime}</p>
        <h1 className="mt-1 text-[1.75rem] font-semibold sm:text-4xl">
          {greeting(ctx.profile.timezone)}, {ctx.profile.display_name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-ink-muted">
          {[ctx.membership.job_title, me?.departmentName, ctx.org.name].filter(Boolean).join(", ")}
        </p>
      </header>

      {welcome ? (
        <Notice tone="ok" title={`Welcome to ${ctx.org.name}`}>
          You’re in. Add a photo so colleagues recognise you in chats, tasks and approvals.
        </Notice>
      ) : null}

      <Today ctx={ctx} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Your crew" description={manager || teammates.length ? undefined : "Your manager and team will appear here once an admin sets them."} />
          <div className="divide-y divide-line">
            {manager ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <PersonLabel id={manager.userId} name={manager.name} src={manager.avatarUrl} sub={manager.jobTitle} />
                <span className="text-xs text-ink-muted">Manager</span>
              </div>
            ) : null}
            {reports.length ? (
              <div className="px-4 py-3 sm:px-5">
                <p className="mb-2 text-xs text-ink-muted">Reporting to you ({reports.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {reports.slice(0, 18).map((p) => (
                    <Link key={p.membershipId} href={`${base}/people/${p.membershipId}`} title={p.name}>
                      <Avatar id={p.userId} name={p.name} src={p.avatarUrl} size="md" />
                      <span className="sr-only">{p.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {me?.teams.map((team) => {
              const members = teammates.filter((p) => p.teams.some((t) => t.id === team.id));
              return (
                <div key={team.id} className="px-4 py-3 sm:px-5">
                  <p className="mb-2 text-xs text-ink-muted">
                    {team.name}
                    {team.isLead ? ", you lead this team" : ""}
                  </p>
                  {members.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {members.slice(0, 18).map((p) => (
                        <Link key={p.membershipId} href={`${base}/people/${p.membershipId}`} title={p.name}>
                          <Avatar id={p.userId} name={p.name} src={p.avatarUrl} size="md" />
                          <span className="sr-only">{p.name}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-muted">Just you so far.</p>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-6">
          {needsPhoto ? (
            <Panel className="border-brass/50">
              <div className="flex items-center gap-4 p-4 sm:p-5">
                <Avatar id={ctx.userId} name={ctx.profile.display_name} size="lg" />
                <div className="min-w-0">
                  <p className="font-semibold">Add your photo</p>
                  <p className="text-sm text-ink-muted">It appears next to your name across the hub. Location data is removed.</p>
                  <Link href={`${base}/profile#photo`} className={buttonClass("secondary", "sm", "mt-3")}>
                    Add photo
                  </Link>
                </div>
              </div>
            </Panel>
          ) : null}

          {ctx.perms.has("users.invite") ? (
            <Panel>
              <PanelHeader title="People admin" />
              <dl className="grid grid-cols-2 divide-x divide-line">
                <div className="px-4 py-4 sm:px-5">
                  <dt className="text-xs text-ink-muted">Active members</dt>
                  <dd className="display tabular mt-1 text-3xl font-semibold">{people.length}</dd>
                </div>
                <div className="px-4 py-4 sm:px-5">
                  <dt className="text-xs text-ink-muted">Pending invitations</dt>
                  <dd className="display tabular mt-1 text-3xl font-semibold">{pendingInvites}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
                <Link href={`${base}/admin/invitations`} className={buttonClass("primary", "sm")}>
                  Invite someone
                </Link>
                <Link href={`${base}/admin/members`} className={buttonClass("secondary", "sm")}>
                  Manage members
                </Link>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
