import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { getHub } from "@/server/services/hub";
import { listGroupStaff, type StaffCompany } from "@/server/services/group-staff";
import { PersonLabel } from "@/components/ui/avatar";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { InviteLinkButton } from "@/components/admin/invite-link-button";
import { InlineActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { addInvitedNow, copyInvitationLink, resendInvitation, revokeInvitation } from "@/server/actions/members";

export const metadata: Metadata = { title: "All staff" };

const STATUS: Record<StaffCompany["status"], { label: string; tone: "ok" | "danger" | "warn" | "neutral" }> = {
  active: { label: "Active", tone: "ok" },
  suspended: { label: "Suspended", tone: "warn" },
  deactivated: { label: "Inactive", tone: "danger" },
  invited: { label: "Invited", tone: "neutral" },
};

export default async function HubStaffPage({ searchParams }: { searchParams: Promise<{ q?: string; company?: string; status?: string }> }) {
  const sp = await searchParams;
  const hub = await getHub();
  if (!hub) redirect("/");
  const manageIn = hub.companies.find((c) => c.can.manageStaff) ?? null;
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
          manageIn ? <Link className={buttonClass()} href={`/o/${manageIn.slug}/admin/invitations`}>Invite someone</Link> : null
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
          <table className="w-full min-w-[900px] text-sm">
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
                          {manageIn && p.userId && p.companies.some((x) => x.membershipId) ? (
                            <Link className={buttonClass("secondary", "sm")} href={`/o/${manageIn?.slug}/admin/staff/${p.userId}`}>Manage companies, departments & teams</Link>
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
                    <td className="px-4 py-2 align-top">
                      <Badge tone={c.invitation?.expired && !p.userId ? "danger" : STATUS[c.status].tone}>{c.invitation && p.userId ? "Not added yet" : c.invitation?.expired ? "Invite expired" : STATUS[c.status].label}</Badge>
                      {c.invitation && p.userId ? (
                        <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                          <InlineActionForm action={addInvitedNow}>
                            <input type="hidden" name="organization_id" value={c.orgId} />
                            <input type="hidden" name="invitation_id" value={c.invitation.id} />
                            <SubmitButton size="sm" pendingLabel="Adding…">Add now</SubmitButton>
                          </InlineActionForm>
                          <InlineActionForm action={revokeInvitation}>
                            <input type="hidden" name="organization_id" value={c.orgId} />
                            <input type="hidden" name="invitation_id" value={c.invitation.id} />
                            <SubmitButton size="sm" variant="ghost" pendingLabel="…">Cancel</SubmitButton>
                          </InlineActionForm>
                        </div>
                      ) : c.invitation ? (
                        <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                          <InlineActionForm action={resendInvitation}>
                            <input type="hidden" name="organization_id" value={c.orgId} />
                            <input type="hidden" name="invitation_id" value={c.invitation.id} />
                            <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">{c.invitation.expired ? "Renew & resend" : "Resend"}</SubmitButton>
                          </InlineActionForm>
                          {!c.invitation.expired && p.email ? <InviteLinkButton action={copyInvitationLink} organizationId={c.orgId} invitationId={c.invitation.id} email={p.email} /> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        ) : <EmptyState title="Nobody matches these filters" />}
      </Panel>
      <p className="text-xs text-ink-muted">Click a company name to change that person’s role, team or access in that company, or “Manage” to add them to more companies, departments and teams.</p>
    </div>
  );
}
