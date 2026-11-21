import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { getHub } from "@/server/services/hub";
import { getTranslator } from "@/lib/i18n";
import { listGroupStaff, type StaffCompany } from "@/server/services/group-staff";
import { PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "All staff" };

const STATUS: Record<StaffCompany["status"], { label: string; tone: "ok" | "danger" | "warn" | "neutral" }> = {
  active: { label: "Active", tone: "ok" },
  suspended: { label: "Suspended", tone: "warn" },
  deactivated: { label: "Inactive", tone: "danger" },
  invited: { label: "Invited", tone: "neutral" },
};

export default async function AllStaffPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string; company?: string; status?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (await getHub()) redirect(`/hub/staff?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), company: sp.company ?? "" })}`);
  if (!(ctx.perms.has("users.edit") || ctx.perms.has("roles.manage"))) {
    return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  }
  const { people, companies } = await listGroupStaff();
  const status = ["active", "inactive", "invited", "all"].includes(sp.status ?? "") ? sp.status! : "all";
  const text = (sp.q ?? "").trim().toLowerCase();
  const company = companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const match = (c: StaffCompany) =>
    (!company || c.orgId === company) &&
    (status === "all" || (status === "active" && c.status === "active") || (status === "inactive" && (c.status === "deactivated" || c.status === "suspended")) || (status === "invited" && c.status === "invited"));
  const shown = people
    .filter((p) => !text || `${p.name} ${p.email ?? ""} ${p.companies.map((c) => `${c.jobTitle ?? ""} ${c.department ?? ""} ${c.teams.join(" ")} ${c.location}`).join(" ")}`.toLowerCase().includes(text))
    .filter((p) => p.companies.some(match));
  const count = (s: StaffCompany["status"][]) => people.filter((p) => p.companies.some((c) => s.includes(c.status))).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="All staff"
        description={`Everyone in ${companies.length} ${companies.length === 1 ? "company" : "companies"}: where they work, their role in each company, and whether they're active.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className={buttonClass("secondary")} href={`/o/${ctx.org.slug}/admin/members?scope=company`}>{ctx.org.name} only</Link>
            {ctx.perms.has("users.invite") ? <Link className={buttonClass()} href={`/o/${ctx.org.slug}/admin/invitations`}>Invite someone</Link> : null}
          </div>
        }
      />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, email, job, team, city" className="mt-1 block h-9 w-64 max-w-full rounded-md border border-line bg-panel px-2" />
        </label>
        <label className="text-sm">Company
          <select name="company" defaultValue={company} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Status
          <select name="status" defaultValue={status} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="all">All ({people.length})</option>
            <option value="active">Active ({count(["active"])})</option>
            <option value="inactive">Inactive ({count(["deactivated", "suspended"])})</option>
            <option value="invited">Invited, not joined yet ({count(["invited"])})</option>
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary")}>Show</button>
      </form>

      <Panel className="overflow-x-auto">
        {shown.length ? (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Location</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Job / department / team</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const rows = p.companies.filter(match);
                return rows.map((c, i) => (
                  <tr key={`${p.key}-${c.orgId}`} className={i === rows.length - 1 ? "border-b border-line" : ""}>
                    <td className="px-4 py-2 align-top">
                      {i === 0 ? (
                        <div className="space-y-1">
                          <PersonLabel id={p.userId ?? p.key} name={p.name} src={p.avatarUrl} sub={p.email ?? undefined} inactive={!p.companies.some((x) => x.status === "active")} size="sm" />
                          {(ctx.perms.has("users.edit") || ctx.perms.has("roles.manage")) && p.userId && p.companies.some((x) => x.membershipId) ? (
                            <Link className={buttonClass("secondary", "sm")} href={`/o/${ctx.org.slug}/admin/staff/${p.userId}`}>Manage companies, departments & teams</Link>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {c.membershipId ? <Link className="underline-offset-4 hover:underline" href={`/o/${c.slug}/admin/members/${c.membershipId}`}>{c.orgName}</Link> : <Link className="underline-offset-4 hover:underline" href={`/o/${c.slug}/admin/invitations`}>{c.orgName}</Link>}
                    </td>
                    <td className="px-2 py-2 align-top text-ink-muted">{c.location}</td>
                    <td className="px-2 py-2 align-top">{c.roles.length ? c.roles.join(", ") : <span className="text-ink-muted">No role</span>}</td>
                    <td className="px-2 py-2 align-top text-ink-muted">{[c.jobTitle, c.department, c.teams.join(", ")].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-2 align-top"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge></td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        ) : <EmptyState title="Nobody matches these filters" />}
      </Panel>
      <p className="text-xs text-ink-muted">You see the companies where you can view staff. Click a company name to change that person’s role, team or access there.</p>
    </div>
  );
}
