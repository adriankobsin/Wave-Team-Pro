import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { getStructure, listPeople } from "@/server/services/people";
import { listInvitations, listRoles } from "@/server/services/admin";
import { copyInvitationLink, inviteMember, resendInvitation, revokeInvitation } from "@/server/actions/members";
import { InviteLinkButton } from "@/components/admin/invite-link-button";
import { emailConfigured } from "@/lib/email";
import { Notice } from "@/components/ui/misc";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import { invitableCompanies } from "@/server/services/multi-company";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("users.invite")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;

  const [roles, structure, people, invitations, companies] = await Promise.all([
    listRoles(ctx.org.id),
    getStructure(ctx.org.id),
    listPeople(ctx.org.id),
    listInvitations(ctx.org.id),
    invitableCompanies(),
  ]);
  const otherCompanies = companies.filter((c) => c.id !== ctx.org.id);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const now = new Date();
  const pending = invitations.filter((i) => i.status === "pending");
  const history = invitations.filter((i) => i.status !== "pending").slice(0, 30);
  const defaultRole = roles.find((r) => r.key === "employee")?.id ?? "";

  return (
    <div className="space-y-6">
      <PageHeader title="Invitations" description={`Invitations are valid for ${ctx.settings.invitation_expiry_days} days. The person opens their personal link, chooses a password and is signed in.`} />
      {!emailConfigured() ? (
        <Notice tone="warn" title="Invitation emails are limited">
          The built-in email service only sends a few emails an hour. Until an email provider is connected, use “Copy link” and send each person their link by email, WhatsApp or Teams. The link works for the whole invitation period.
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader title="Invite someone" />
        <ActionForm action={inviteMember} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5" resetOnSuccess>
          <input type="hidden" name="organization_id" value={ctx.org.id} />
          <TextField label="Work email" name="email" type="email" required autoComplete="off" inputMode="email" />
          <TextField label="Name" name="display_name" optional hint="Shown until they set their own." />
          <SelectField label="Role" name="role_id" required defaultValue={defaultRole} hint="You can only invite with roles whose permissions you hold.">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </SelectField>
          <TextField label="Job title" name="job_title" optional />
          <SelectField label="Department" name="department_id" optional defaultValue="">
            <option value="">None</option>
            {structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          <SelectField label="Team" name="team_id" optional defaultValue="">
            <option value="">None</option>
            {structure.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </SelectField>
          <SelectField label="Manager" name="manager_membership_id" optional defaultValue="">
            <option value="">None</option>
            {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
          </SelectField>
          <TextField label="Start date" name="start_date" type="date" optional />
          <TextField label="Employee number" name="employee_number" optional />
          {otherCompanies.length ? (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Companies</legend>
              <p className="text-xs text-ink-muted">Tick every company this person works for. They get the same role in each (Employee where that role doesn’t exist) and one link joins them all.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled className="size-4" /> {ctx.org.name}</label>
                {otherCompanies.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="also_org" value={c.id} className="size-4" /> {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="flex items-end sm:col-span-2">
            <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel>
        <PanelHeader title={`Pending (${pending.length})`} />
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((i) => {
              const expired = new Date(i.expires_at) <= now;
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.display_name ? `${i.display_name}, ` : ""}{i.email}</span>
                    <span className="block text-xs text-ink-muted">
                      {roleName.get(i.role_id)}
                      {i.job_title ? `, ${i.job_title}` : ""}. Sent {formatDate(i.created_at, ctx.org.timezone)}.
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {expired ? <Badge tone="danger">Expired</Badge> : <Badge>Until {formatDate(i.expires_at, ctx.org.timezone)}</Badge>}
                    {!expired ? <InviteLinkButton action={copyInvitationLink} organizationId={ctx.org.id} invitationId={i.id} email={i.email} /> : null}
                    <InlineActionForm action={resendInvitation}>
                      <input type="hidden" name="organization_id" value={ctx.org.id} />
                      <input type="hidden" name="invitation_id" value={i.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">Resend</SubmitButton>
                    </InlineActionForm>
                    <InlineActionForm action={revokeInvitation} confirm={`Revoke the invitation for ${i.email}?`}>
                      <input type="hidden" name="organization_id" value={ctx.org.id} />
                      <input type="hidden" name="invitation_id" value={i.id} />
                      <SubmitButton variant="ghost" size="sm" pendingLabel="Revoking…">Revoke</SubmitButton>
                    </InlineActionForm>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No pending invitations" />
        )}
      </Panel>

      {history.length ? (
        <Panel>
          <PanelHeader title="Recent" />
          <ul className="divide-y divide-line text-sm">
            {history.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-4 py-2.5 sm:px-5">
                <span className="truncate">{i.email}</span>
                <Badge tone={i.status === "accepted" ? "ok" : "neutral"}>{i.status === "accepted" ? "Joined" : "Revoked"}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
