import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { Folder as FolderIcon, Lock } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { SCOPE_LABEL, listDocuments, listFolders } from "@/server/services/documents";
import { getStructure, listPeople } from "@/server/services/people";
import { createFolder } from "@/server/actions/documents";
import { DocumentRow } from "@/components/documents/document-row";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { controlClass } from "@/components/ui/control-class";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string }> }) {
  const { org: slug } = await params;
  const { q } = await searchParams;
  const ctx = await getOrgContext(slug);
  const [folders, structure, people, results] = await Promise.all([
    listFolders(ctx.org.id),
    getStructure(ctx.org.id),
    listPeople(ctx.org.id, { includeInactive: true }),
    q ? listDocuments(ctx.org.id, { search: q.slice(0, 80) }) : Promise.resolve(null),
  ]);
  const base = `/o/${ctx.org.slug}`;
  const byId = new Map(people.map((p) => [p.userId, p]));
  const top = folders.filter((f) => !f.parent_id);
  const hasPersonal = top.some((f) => f.scope === "personal" && f.owner_id === ctx.userId);
  const canManage = ctx.perms.has("documents.manage");
  const teamName = new Map(structure.teams.map((t) => [t.id, t.name]));
  const deptName = new Map(structure.departments.map((d) => [d.id, d.name]));
  const folderName = new Map(folders.map((f) => [f.id, f.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Company, team and personal files. You only see folders you have access to." />
      <form role="search" className="flex gap-2" action={`${base}/documents`}>
        <label htmlFor="doc-q" className="sr-only">Search documents</label>
        <input id="doc-q" name="q" defaultValue={q} placeholder="Search by title or description" className={controlClass} />
        <button type="submit" className={buttonClass("secondary")}>Search</button>
      </form>

      {results ? (
        <Panel>
          <PanelHeader title={`Results for “${q}”`} action={<Link href={`${base}/documents`} className="text-sm underline">Clear</Link>} />
          {results.length ? (
            <ul className="divide-y divide-line">
              {results.map((d) => <DocumentRow key={d.id} doc={d} people={byId} timeZone={ctx.profile.timezone} folderName={folderName.get(d.folder_id)} />)}
            </ul>
          ) : (
            <EmptyState title="Nothing found" />
          )}
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader title="Folders" />
          {top.length ? (
            <ul className="divide-y divide-line">
              {top.map((f) => (
                <li key={f.id}>
                  <Link href={`${base}/documents/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-sunk sm:px-5">
                    {f.scope === "personal" || f.scope === "hr" ? <Lock className="size-5 text-brass" aria-hidden /> : <FolderIcon className="size-5 text-ink-muted" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {f.scope === "team" ? `Team: ${teamName.get(f.scope_id ?? "") ?? ""}` : f.scope === "department" ? `Department: ${deptName.get(f.scope_id ?? "") ?? ""}` : SCOPE_LABEL[f.scope]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No folders yet" />
          )}
        </Panel>
        <Panel className="h-fit">
          <PanelHeader title="New folder" />
          <ActionForm action={createFolder} className="space-y-3 p-4" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <TextField label="Name" name="name" required maxLength={100} placeholder={hasPersonal ? "Contracts" : "My files"} />
            <SelectField label="Who can see it" name="scope" defaultValue="personal">
              <option value="personal">Only me (personal)</option>
              {canManage ? <option value="organization">Everyone in the company</option> : null}
              {canManage || ctx.perms.hasAnyScope("documents.manage") ? <option value="team">One team</option> : null}
              {canManage ? <option value="department">One department</option> : null}
            </SelectField>
            {canManage || ctx.perms.hasAnyScope("documents.manage") ? (
              <SelectField label="Team or department" name="scope_id" optional defaultValue="">
                <option value="">—</option>
                <optgroup label="Teams">{structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                <optgroup label="Departments">{structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
              </SelectField>
            ) : null}
            <SubmitButton variant="secondary" pendingLabel="Creating…">Create folder</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
