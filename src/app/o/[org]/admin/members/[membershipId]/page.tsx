import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { getStructure, listPeople } from "@/server/services/people";
import { getMemberAccess, getPermissionCatalog, listRoles } from "@/server/services/admin";
import { addToCompanies, setAssignedProject, setMembershipStatus, updateMembership } from "@/server/actions/members";
import { invitableCompanies } from "@/server/services/multi-company";
import { createClient } from "@/lib/supabase/server";
import { addOverride, addRoleAssignment, removeOverride, removeRoleAssignment } from "@/server/actions/roles";
import { addTeamMember, removeTeamMember } from "@/server/actions/structure";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { AccessDenied, Badge, Notice, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Manage member" };

export default async function MemberAdminPage({ params }: { params: Promise<{ org: string; membershipId: string }> }) {
  const { org: slug, membershipId } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  const canEdit = ctx.perms.has("users.edit");
  const canRoles = ctx.perms.has("roles.manage");
  const canStatus = ctx.perms.has("users.deactivate");
  const canTeams = ctx.perms.has("org.structure.manage");
  if (!canEdit && !canRoles && !canStatus) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;

  const [people, structure, roles, access, catalog] = await Promise.all([
    listPeople(ctx.org.id, { includeInactive: true, withFullAvatars: true }),
    getStructure(ctx.org.id),
    listRoles(ctx.org.id),
    getMemberAccess(ctx.org.id, membershipId),
    getPermissionCatalog(),
  ]);
  const person = people.find((p) => p.membershipId === membershipId);
  if (!person) notFound();
  const isSelf = person.userId === ctx.userId;
  const active = person.status === "active";
  const orgId = ctx.org.id;
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const teamName = new Map(structure.teams.map((tm) => [tm.id, tm.name]));
  const scopeLabel = (type: string, id: string | null) => (type === "team" ? `Team: ${teamName.get(id ?? "") ?? "unknown"}` : "Whole organization");
  const canInvite = ctx.perms.has("users.invite");
  const canAssignWork = canEdit || ctx.perms.hasAnyScope("tasks.assign");
  const supabase = await createClient();
  const [{ data: orgProjects }, { data: assignedRow }] = await Promise.all([
    canAssignWork ? supabase.from("projects").select("id, name, code").eq("organization_id", orgId).in("status", ["planning", "active", "on_hold"]).order("name") : Promise.resolve({ data: [] }),
    supabase.from("organization_memberships").select("assigned_project_id").eq("id", membershipId).maybeSingle(),
  ]);
  const [companies, { data: theirMemberships }] = await Promise.all([
    canInvite ? invitableCompanies() : Promise.resolve([]),
    supabase.from("organization_memberships").select("organization_id, status, organizations(name)").eq("user_id", person.userId),
  ]);
  const memberOf = (theirMemberships ?? []) as unknown as { organization_id: string; status: string; organizations: { name: string } | null }[];
  const activeIn = new Set(memberOf.filter((m) => m.status === "active").map((m) => m.organization_id));
  const addable = companies.filter((c) => !activeIn.has(c.id));
  const currentRoleKeys = new Set(access.assignments.map((a) => roles.find((r) => r.id === a.role_id)?.key).filter(Boolean) as string[]);
  const defaultKey = ["super_admin", "director", "hr_manager", "va_admin", "bookkeeper", "manager", "team_lead", "employee"].find((k) => currentRoleKeys.has(k)) ?? "employee";
  const managerOptions = people.filter((p) => p.status === "active" && p.membershipId !== person.membershipId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/o/${ctx.org.slug}/admin/staff`} className="text-sm text-ink-muted underline-offset-4 hover:underline">All staff</Link>
      <div className="flex items-center gap-4">
        <Avatar id={person.userId} name={person.name} src={person.avatarFullUrl ?? person.avatarUrl} size="lg" inactive={!active} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{person.name}</h1>
          <p className="text-ink-muted">{person.email}</p>
          {!active ? <div className="mt-1"><Badge tone="danger">Deactivated</Badge></div> : null}
        </div>
      </div>
      {isSelf ? <Notice>This is you. You can’t change your own roles, overrides or employment status; ask another administrator.</Notice> : null}

      {canEdit ? (
        <Panel>
          <PanelHeader title="Employment" />
          <ActionForm action={updateMembership} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <input type="hidden" name="organization_id" value={orgId} />
            <input type="hidden" name="membership_id" value={person.membershipId} />
            <TextField label="Job title" name="job_title" defaultValue={person.jobTitle ?? ""} optional />
            <TextField label="Employee number" name="employee_number" defaultValue={person.employeeNumber ?? ""} optional />
            <SelectField label="Department" name="department_id" defaultValue={person.departmentId ?? ""} optional>
              <option value="">None</option>
              {structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <SelectField label="Manager" name="manager_membership_id" defaultValue={person.managerMembershipId ?? ""} optional>
              <option value="">None</option>
              {managerOptions.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
            </SelectField>
            <TextField label="Start date" name="start_date" type="date" defaultValue={person.startDate ?? ""} optional />
            <div className="flex items-end sm:col-span-2">
              <SubmitButton>Save employment details</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}

      {canAssignWork && active ? (
        <Panel>
          <PanelHeader title="Assigned project" description="What their clock-ins count against. A shift with a project in Schedule takes priority for that day." />
          <ActionForm action={setAssignedProject} className="flex flex-wrap items-end gap-3 p-4 sm:px-5">
            <input type="hidden" name="organization_id" value={orgId} />
            <input type="hidden" name="membership_id" value={person.membershipId} />
            <div className="min-w-64 flex-1">
              <SelectField label="Project" name="project_id" defaultValue={assignedRow?.assigned_project_id ?? ""}>
                <option value="">None</option>
                {((orgProjects ?? []) as { id: string; name: string; code: string | null }[]).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>)}
              </SelectField>
            </div>
            <SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Companies" description="Companies this person works for. Each company keeps its own roles, timesheets, leave and expenses." />
        <ul className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
          {memberOf.map((m) => (
            <li key={m.organization_id}><Badge tone={m.status === "active" ? "ok" : "neutral"}>{m.organizations?.name ?? "Company"}{m.status === "active" ? "" : " (deactivated)"}</Badge></li>
          ))}
        </ul>
        {canInvite && active && addable.length ? (
          <ActionForm action={addToCompanies} className="space-y-3 border-t border-line p-4 sm:px-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={orgId} />
            <input type="hidden" name="membership_id" value={person.membershipId} />
            <fieldset>
              <legend className="text-sm font-medium">Add to more companies</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {addable.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="org" value={c.id} className="size-4" /> {c.name}</label>
                ))}
              </div>
            </fieldset>
            <div className="max-w-xs">
              <SelectField label="Role there" name="role_key" defaultValue={defaultKey} hint="Matched by role in each company.">
                {roles.filter((r) => r.key).map((r) => <option key={r.id} value={r.key!}>{r.name}</option>)}
              </SelectField>
            </div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add to companies</SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="Teams" description={canTeams ? undefined : "Ask someone who manages departments and teams to change this."} />
        <ul className="divide-y divide-line">
          {person.teams.map((tm) => (
            <li key={tm.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <span>{tm.name}{tm.isLead ? <span className="ml-2"><Badge tone="warn">Lead</Badge></span> : null}</span>
              {canTeams ? (
                <InlineActionForm action={removeTeamMember}>
                  <input type="hidden" name="organization_id" value={orgId} />
                  <input type="hidden" name="team_id" value={tm.id} />
                  <input type="hidden" name="membership_id" value={person.membershipId} />
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">Remove</SubmitButton>
                </InlineActionForm>
              ) : null}
            </li>
          ))}
          {!person.teams.length ? <li className="px-5 py-4 text-sm text-ink-muted">Not on any team.</li> : null}
        </ul>
        {canTeams && structure.teams.length ? (
          <ActionForm action={addTeamMember} className="flex flex-wrap items-end gap-3 border-t border-line p-4 sm:px-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={orgId} />
            <input type="hidden" name="membership_id" value={person.membershipId} />
            <div className="min-w-48 flex-1">
              <SelectField label="Add to team" name="team_id" required defaultValue="">
                <option value="" disabled>Choose a team</option>
                {structure.teams.filter((tm) => !person.teams.some((x) => x.id === tm.id)).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </SelectField>
            </div>
            <CheckboxField label="Team lead" name="is_lead" />
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>

      {canRoles ? (
        <Panel>
          <PanelHeader title="Roles" description="You can only grant roles whose permissions you hold yourself." />
          <ul className="divide-y divide-line">
            {access.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <span>
                  <span className="font-medium">{roleName.get(a.role_id) ?? "Role"}</span>
                  <span className="block text-xs text-ink-muted">{scopeLabel(a.scope_type, a.scope_id)}, since {formatDate(a.created_at, ctx.org.timezone)}</span>
                </span>
                {!isSelf ? (
                  <InlineActionForm action={removeRoleAssignment} confirm={`Remove ${roleName.get(a.role_id)} from ${person.name}?`}>
                    <input type="hidden" name="organization_id" value={orgId} />
                    <input type="hidden" name="assignment_id" value={a.id} />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">Remove</SubmitButton>
                  </InlineActionForm>
                ) : null}
              </li>
            ))}
            {!access.assignments.length ? <li className="px-5 py-4 text-sm text-ink-muted">No roles: this person can sign in but can’t do anything yet.</li> : null}
          </ul>
          {!isSelf && active ? (
            <ActionForm action={addRoleAssignment} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:px-5" resetOnSuccess>
              <input type="hidden" name="organization_id" value={orgId} />
              <input type="hidden" name="membership_id" value={person.membershipId} />
              <SelectField label="Role" name="role_id" required defaultValue="">
                <option value="" disabled>Choose a role</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectField>
              <ScopeSelect teams={structure.teams} />
              <SubmitButton variant="secondary" pendingLabel="Assigning…">Assign</SubmitButton>
            </ActionForm>
          ) : null}
        </Panel>
      ) : null}

      {canRoles ? (
        <Panel>
          <PanelHeader title="Individual exceptions" description="Grant or block one permission for this person. Blocks always win over roles." />
          <ul className="divide-y divide-line">
            {access.overrides.map((o) => {
              const expired = o.expires_at ? new Date(o.expires_at) < new Date() : false;
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={o.effect === "deny" ? "danger" : "ok"}>{o.effect === "deny" ? "Blocked" : "Granted"}</Badge>
                      <span className="font-medium">{catalog.find((c) => c.key === o.permission_key)?.description ?? o.permission_key}</span>
                      {expired ? <Badge>Expired</Badge> : null}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {scopeLabel(o.scope_type, o.scope_id)}. {o.reason}
                      {o.expires_at ? `. Until ${formatDateTime(o.expires_at, ctx.org.timezone)}` : ""}
                    </span>
                  </span>
                  {!isSelf ? (
                    <InlineActionForm action={removeOverride}>
                      <input type="hidden" name="organization_id" value={orgId} />
                      <input type="hidden" name="override_id" value={o.id} />
                      <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">Remove</SubmitButton>
                    </InlineActionForm>
                  ) : null}
                </li>
              );
            })}
            {!access.overrides.length ? <li className="px-5 py-4 text-sm text-ink-muted">None.</li> : null}
          </ul>
          {!isSelf && active ? (
            <ActionForm action={addOverride} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 sm:px-5" resetOnSuccess>
              <input type="hidden" name="organization_id" value={orgId} />
              <input type="hidden" name="membership_id" value={person.membershipId} />
              <SelectField label="Permission" name="permission_key" required defaultValue="">
                <option value="" disabled>Choose a permission</option>
                {catalog.map((c) => <option key={c.key} value={c.key}>{c.description}</option>)}
              </SelectField>
              <SelectField label="Effect" name="effect" defaultValue="grant">
                <option value="grant">Grant</option>
                <option value="deny">Block</option>
              </SelectField>
              <ScopeSelect teams={structure.teams} />
              <TextField label="Ends on" name="expires_at" type="date" optional />
              <div className="sm:col-span-2">
                <TextField label="Reason" name="reason" required placeholder="e.g. Covering approvals while Maria is on leave" maxLength={300} />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton variant="secondary" pendingLabel="Saving…">Add exception</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Panel>
      ) : null}

      {canStatus && !isSelf ? (
        <Panel className={active ? "border-danger/40" : undefined}>
          <PanelHeader
            title={active ? "Remove access" : "Restore access"}
            description={
              active
                ? "Access to this organization stops immediately. Their messages, approvals and history stay attributed to them."
                : "They'll regain the roles they had. Their account is unlocked if it was locked."
            }
          />
          <ActionForm
            action={setMembershipStatus}
            className="p-4 sm:p-5"
            confirm={active ? `Remove ${person.name}'s access to ${ctx.org.name}? This takes effect immediately.` : undefined}
          >
            <input type="hidden" name="organization_id" value={orgId} />
            <input type="hidden" name="membership_id" value={person.membershipId} />
            <input type="hidden" name="status" value={active ? "deactivated" : "active"} />
            <SubmitButton variant={active ? "danger" : "primary"} pendingLabel={active ? "Removing…" : "Restoring…"}>
              {active ? `Remove ${person.name.split(" ")[0]}'s access` : "Restore access"}
            </SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}

function ScopeSelect({ teams }: { teams: { id: string; name: string }[] }) {
  return (
    <SelectField label="Applies to" name="scope_combo" defaultValue="organization" hint={teams.length ? undefined : "Create teams to scope access to one team."}>
      <option value="organization">Whole organization</option>
      {teams.map((tm) => <option key={tm.id} value={`team:${tm.id}`}>Team: {tm.name}</option>)}
    </SelectField>
  );
}
