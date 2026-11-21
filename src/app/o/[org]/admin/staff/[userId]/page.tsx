import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { staffCompanies } from "@/server/services/group-staff";
import { getStructure } from "@/server/services/people";
import { listRoles } from "@/server/services/admin";
import { addInvitedNow, addToCompanies, revokeInvitation, setMembershipStatus, updateMembership } from "@/server/actions/members";
import { addRoleAssignment, removeRoleAssignment } from "@/server/actions/roles";
import { addTeamMember, removeTeamMember } from "@/server/actions/structure";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { AccessDenied, Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { countryName } from "@/lib/regions";

export const metadata: Metadata = { title: "Manage person" };

type Membership = {
  id: string;
  organization_id: string;
  status: "active" | "suspended" | "deactivated";
  job_title: string | null;
  employee_number: string | null;
  department_id: string | null;
  manager_membership_id: string | null;
  start_date: string | null;
};

/** One person across every company the viewer manages: companies, roles, departments, teams, access. */
export default async function ManagePersonPage({ params }: { params: Promise<{ org: string; userId: string }> }) {
  const { org: slug, userId } = await params;
  const ctx = await getOrgContext(slug);
  if (!/^[0-9a-f-]{36}$/.test(userId)) notFound();
  const supabase = await createClient();
  const { mine, checks } = await staffCompanies();
  const managed = mine.filter((_, i) => checks[i].manage);
  if (!managed.length) return <AccessDenied message="Only management can manage people." hint="Ask an administrator." />;

  const [{ data: profile }, { data: memberships }, { data: orgInfo }] = await Promise.all([
    supabase.from("profiles").select("display_name, email_display, avatar_thumb_path").eq("id", userId).maybeSingle(),
    supabase.from("organization_memberships").select("id, organization_id, status, job_title, employee_number, department_id, manager_membership_id, start_date")
      .eq("user_id", userId).in("organization_id", managed.map((o) => o.organization_id)),
    supabase.from("organizations").select("id, country, timezone").in("id", managed.map((o) => o.organization_id)),
  ]);
  const list = (memberships ?? []) as Membership[];
  if (!profile || !list.length) notFound();
  const where = new Map((orgInfo ?? []).map((o) => [o.id, `${(o.timezone as string).split("/").pop()!.replace(/_/g, " ")}, ${countryName(o.country as string)}`]));
  const isSelf = userId === ctx.userId;

  const companies = await Promise.all(list.map(async (m) => {
    const org = managed.find((o) => o.organization_id === m.organization_id)!;
    const [structure, roles, { data: assignments }, { data: teams }] = await Promise.all([
      getStructure(m.organization_id),
      listRoles(m.organization_id),
      supabase.from("membership_role_assignments").select("id, role_id, scope_type, scope_id").eq("membership_id", m.id),
      supabase.from("team_memberships").select("team_id, is_lead").eq("membership_id", m.id),
    ]);
    return { m, org, structure, roles, assignments: assignments ?? [], teams: teams ?? [] };
  }));
  companies.sort((a, b) => a.org.name.localeCompare(b.org.name));
  const memberOf = new Set(list.filter((m) => m.status === "active").map((m) => m.organization_id));
  // Invitations still waiting for this person (from before companies could be added directly).
  const { data: waiting } = profile.email_display
    ? await supabase.from("invitations").select("id, organization_id").eq("status", "pending").ilike("email", profile.email_display as string)
      .in("organization_id", managed.map((o) => o.organization_id))
    : { data: [] as { id: string; organization_id: string }[] };
  const addable = managed.filter((o) => !memberOf.has(o.organization_id));
  const anchor = list.find((m) => m.status === "active") ?? list[0];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/o/${ctx.org.slug}/admin/staff`} className="text-sm text-ink-muted underline-offset-4 hover:underline">All staff</Link>
      <div className="flex items-center gap-4">
        <Avatar id={userId} name={profile.display_name as string} src={null} size="lg" />
        <div className="min-w-0">
          <PageHeader title={profile.display_name as string} description={`${profile.email_display ?? ""}${profile.email_display ? " · " : ""}${memberOf.size} ${memberOf.size === 1 ? "company" : "companies"}`} />
        </div>
      </div>
      {isSelf ? <Notice>This is you. You can’t change your own roles or access; ask another administrator.</Notice> : null}

      {companies.map(({ m, org, structure, roles, assignments, teams }) => {
        const active = m.status === "active";
        const roleName = new Map(roles.map((r) => [r.id, r.name]));
        const teamName = new Map(structure.teams.map((t) => [t.id, t.name]));
        const base = `/o/${org.slug}`;
        return (
          <Panel key={m.id}>
            <PanelHeader
              title={org.name}
              description={where.get(org.organization_id)}
              action={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={active ? "ok" : "danger"}>{active ? "Active" : "Inactive"}</Badge>
                  <Link className="text-sm underline" href={`${base}/admin/members/${m.id}`}>More</Link>
                </span>
              }
            />
            <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-2">
              {/* Department and job */}
              <ActionForm action={updateMembership} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="organization_id" value={org.organization_id} />
                <input type="hidden" name="membership_id" value={m.id} />
                <input type="hidden" name="manager_membership_id" value={m.manager_membership_id ?? ""} />
                <SelectField label="Department" name="department_id" defaultValue={m.department_id ?? ""} hint={structure.departments.length ? undefined : "No departments yet"}>
                  <option value="">None</option>
                  {structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </SelectField>
                <TextField label="Job title" name="job_title" defaultValue={m.job_title ?? ""} optional />
                <TextField label="Employee number" name="employee_number" defaultValue={m.employee_number ?? ""} optional />
                <TextField label="Start date" name="start_date" type="date" defaultValue={m.start_date ?? ""} optional />
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
                  <Link className="text-xs underline" href={`${base}/admin/structure`}>Departments & teams in {org.name}</Link>
                </div>
              </ActionForm>

              <div className="space-y-5">
                {/* Roles */}
                <div>
                  <p className="text-sm font-medium">Roles</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {assignments.map((a) => (
                      <li key={a.id} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm">
                        {roleName.get(a.role_id) ?? "Role"}{a.scope_type === "team" ? ` (${teamName.get(a.scope_id ?? "") ?? "team"})` : ""}
                        {!isSelf ? (
                          <InlineActionForm action={removeRoleAssignment} confirm={`Remove ${roleName.get(a.role_id)} in ${org.name}?`}>
                            <input type="hidden" name="organization_id" value={org.organization_id} />
                            <input type="hidden" name="assignment_id" value={a.id} />
                            <button type="submit" className="text-xs text-ink-muted underline" aria-label={`Remove ${roleName.get(a.role_id)}`}>×</button>
                          </InlineActionForm>
                        ) : null}
                      </li>
                    ))}
                    {!assignments.length ? <li className="text-sm text-ink-muted">No role yet</li> : null}
                  </ul>
                  {!isSelf ? (
                    <ActionForm action={addRoleAssignment} className="mt-2 flex flex-wrap items-end gap-2" resetOnSuccess>
                      <input type="hidden" name="organization_id" value={org.organization_id} />
                      <input type="hidden" name="membership_id" value={m.id} />
                      <input type="hidden" name="scope_combo" value="organization" />
                      <div className="min-w-48 flex-1">
                        <SelectField label="Add role" name="role_id" required defaultValue="">
                          <option value="" disabled>Choose</option>
                          {roles.filter((r) => !assignments.some((a) => a.role_id === r.id && a.scope_type === "organization")).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </SelectField>
                      </div>
                      <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>

                {/* Teams */}
                <div>
                  <p className="text-sm font-medium">Teams</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {teams.map((t) => (
                      <li key={t.team_id} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm">
                        {teamName.get(t.team_id) ?? "Team"}{t.is_lead ? " · lead" : ""}
                        <InlineActionForm action={removeTeamMember}>
                          <input type="hidden" name="organization_id" value={org.organization_id} />
                          <input type="hidden" name="team_id" value={t.team_id} />
                          <input type="hidden" name="membership_id" value={m.id} />
                          <button type="submit" className="text-xs text-ink-muted underline" aria-label={`Remove from ${teamName.get(t.team_id)}`}>×</button>
                        </InlineActionForm>
                      </li>
                    ))}
                    {!teams.length ? <li className="text-sm text-ink-muted">Not on a team</li> : null}
                  </ul>
                  {structure.teams.some((t) => !teams.some((x) => x.team_id === t.id)) ? (
                    <ActionForm action={addTeamMember} className="mt-2 flex flex-wrap items-end gap-2" resetOnSuccess>
                      <input type="hidden" name="organization_id" value={org.organization_id} />
                      <input type="hidden" name="membership_id" value={m.id} />
                      <div className="min-w-48 flex-1">
                        <SelectField label="Add to team" name="team_id" required defaultValue="">
                          <option value="" disabled>Choose</option>
                          {structure.teams.filter((t) => !teams.some((x) => x.team_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </SelectField>
                      </div>
                      <CheckboxField label="Lead" name="is_lead" />
                      <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
                    </ActionForm>
                  ) : !structure.teams.length ? <p className="mt-1 text-xs text-ink-muted">No teams in {org.name} yet.</p> : null}
                </div>

                {!isSelf ? (
                  <ActionForm action={setMembershipStatus} confirm={active ? `Remove ${profile.display_name}'s access to ${org.name}?` : undefined}>
                    <input type="hidden" name="organization_id" value={org.organization_id} />
                    <input type="hidden" name="membership_id" value={m.id} />
                    <input type="hidden" name="status" value={active ? "deactivated" : "active"} />
                    <SubmitButton size="sm" variant={active ? "ghost" : "secondary"} pendingLabel="Saving…">{active ? `Remove from ${org.name}` : `Restore access to ${org.name}`}</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </div>
          </Panel>
        );
      })}

      {(waiting ?? []).length ? (
        <Panel>
          <PanelHeader title="Invited, not added yet" description="They already have an account, so you can add them now instead of waiting for them to accept." />
          <ul className="divide-y divide-line">
            {(waiting ?? []).map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <span>{managed.find((o) => o.organization_id === w.organization_id)?.name}</span>
                <span className="flex gap-2">
                  <InlineActionForm action={addInvitedNow}>
                    <input type="hidden" name="organization_id" value={w.organization_id} />
                    <input type="hidden" name="invitation_id" value={w.id} />
                    <SubmitButton size="sm" pendingLabel="Adding…">Add now</SubmitButton>
                  </InlineActionForm>
                  <InlineActionForm action={revokeInvitation}>
                    <input type="hidden" name="organization_id" value={w.organization_id} />
                    <input type="hidden" name="invitation_id" value={w.id} />
                    <SubmitButton size="sm" variant="ghost" pendingLabel="…">Cancel invite</SubmitButton>
                  </InlineActionForm>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {addable.length && anchor && anchor.status === "active" ? (
        <Panel>
          <PanelHeader title="Add to more companies" description="Tick the companies they work for. They're added straight away with the role below — no invitation needed." />
          <ActionForm action={addToCompanies} className="space-y-3 p-4 sm:p-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={anchor.organization_id} />
            <input type="hidden" name="membership_id" value={anchor.id} />
            <div className="grid gap-2 sm:grid-cols-2">
              {addable.map((o) => (
                <label key={o.organization_id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="org" value={o.organization_id} className="size-4" /> {o.name}</label>
              ))}
            </div>
            <div className="max-w-xs">
              <SelectField label="Role there" name="role_key" defaultValue="employee">
                <option value="employee">Employee</option>
                <option value="team_leader">Team Leader</option>
                <option value="project_manager">Project Manager</option>
                <option value="bookkeeper">Bookkeeper</option>
                <option value="hr_manager">HR Manager</option>
                <option value="va_admin">Admin / Virtual Assistant</option>
                <option value="director">Director</option>
              </SelectField>
            </div>
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add to companies</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
