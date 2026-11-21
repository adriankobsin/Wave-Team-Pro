import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { getStructure, listPeople } from "@/server/services/people";
import { archiveStructure, createDepartment, createTeam } from "@/server/actions/structure";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { AccessDenied, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Departments & teams" };

export default async function StructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("org.structure.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const [structure, people] = await Promise.all([getStructure(ctx.org.id), listPeople(ctx.org.id)]);
  const orgId = ctx.org.id;

  return (
    <div className="space-y-6">
      <PageHeader title="Departments & teams" description="Add people to teams from their member page. Archiving keeps history intact." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Departments" />
          <ul className="divide-y divide-line">
            {structure.departments.map((d) => {
              const count = people.filter((p) => p.departmentId === d.id).length;
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span>
                    <span className="font-medium">{d.name}</span>
                    <span className="block text-xs text-ink-muted">{d.code ? `${d.code}, ` : ""}{count} {count === 1 ? "person" : "people"}</span>
                  </span>
                  <InlineActionForm action={archiveStructure} confirm={`Archive ${d.name}?`}>
                    <input type="hidden" name="organization_id" value={orgId} />
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="kind" value="department" />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Archiving…">Archive</SubmitButton>
                  </InlineActionForm>
                </li>
              );
            })}
            {!structure.departments.length ? <li><EmptyState title="No departments yet" /></li> : null}
          </ul>
          <ActionForm action={createDepartment} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end sm:px-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={orgId} />
            <TextField label="New department" name="name" required placeholder="Engineering" />
            <TextField label="Code" name="code" optional placeholder="ENG" />
            <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel>
          <PanelHeader title="Teams" />
          <ul className="divide-y divide-line">
            {structure.teams.map((tm) => {
              const members = people.filter((p) => p.teams.some((x) => x.id === tm.id));
              const dept = structure.departments.find((d) => d.id === tm.department_id);
              return (
                <li key={tm.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0">
                    <span className="font-medium">{tm.name}</span>
                    <span className="block text-xs text-ink-muted">{dept ? `${dept.name}, ` : ""}{members.length} {members.length === 1 ? "member" : "members"}</span>
                    {members.length ? (
                      <span className="mt-1.5 flex -space-x-1.5">
                        {members.slice(0, 8).map((m) => <Avatar key={m.membershipId} id={m.userId} name={m.name} src={m.avatarUrl} size="xs" className="ring-2 ring-panel" />)}
                      </span>
                    ) : null}
                  </span>
                  <InlineActionForm action={archiveStructure} confirm={`Archive ${tm.name}?`}>
                    <input type="hidden" name="organization_id" value={orgId} />
                    <input type="hidden" name="id" value={tm.id} />
                    <input type="hidden" name="kind" value="team" />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Archiving…">Archive</SubmitButton>
                  </InlineActionForm>
                </li>
              );
            })}
            {!structure.teams.length ? <li><EmptyState title="No teams yet" /></li> : null}
          </ul>
          <ActionForm action={createTeam} className="grid gap-3 border-t border-line p-4 sm:px-5" resetOnSuccess>
            <input type="hidden" name="organization_id" value={orgId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="New team" name="name" required placeholder="Refit crew" />
              <SelectField label="Department" name="department_id" optional defaultValue="">
                <option value="">None</option>
                {structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectField>
            </div>
            <div><SubmitButton variant="secondary" pendingLabel="Adding…">Add team</SubmitButton></div>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
