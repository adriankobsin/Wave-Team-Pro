import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Folder as FolderIcon } from "lucide-react";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { SCOPE_LABEL, listDocuments, listFolders } from "@/server/services/documents";
import { listPeople } from "@/server/services/people";
import { archiveDocument, createFolder, uploadDocument } from "@/server/actions/documents";
import { DocumentRow } from "@/components/documents/document-row";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Folder" };

export default async function FolderPage({ params }: { params: Promise<{ org: string; folderId: string }> }) {
  const { org: slug, folderId } = await params;
  if (!z.uuid().safeParse(folderId).success) notFound();
  const ctx = await getOrgContext(slug);
  const folders = await listFolders(ctx.org.id);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) notFound();
  const supabase = await createClient();
  const [docs, people, { data: canWrite }] = await Promise.all([
    listDocuments(ctx.org.id, { folderId }),
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.rpc("can_write_folder", { p_folder: folderId }),
  ]);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const children = folders.filter((f) => f.parent_id === folderId);
  const trail: typeof folders = [];
  let cur: (typeof folders)[number] | undefined = folder;
  while (cur) {
    trail.unshift(cur);
    cur = cur.parent_id ? folders.find((f) => f.id === cur!.parent_id) : undefined;
  }
  const base = `/o/${ctx.org.slug}/documents`;
  const canManage = ctx.perms.has("documents.manage");

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href={base} className="hover:underline">Documents</Link>
        {trail.map((f) => (
          <span key={f.id}> / {f.id === folderId ? <span className="text-ink">{f.name}</span> : <Link href={`${base}/${f.id}`} className="hover:underline">{f.name}</Link>}</span>
        ))}
      </nav>
      <PageHeader title={folder.name} description={`${SCOPE_LABEL[folder.scope]} folder${canWrite ? "" : " (read only)"}`} />

      <div className={canWrite ? "grid gap-6 lg:grid-cols-[1.5fr_1fr]" : ""}>
        <div className="space-y-6">
          {children.length ? (
            <Panel>
              <PanelHeader title="Subfolders" />
              <ul className="divide-y divide-line">
                {children.map((f) => (
                  <li key={f.id}>
                    <Link href={`${base}/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-sunk sm:px-5">
                      <FolderIcon className="size-5 text-ink-muted" aria-hidden /> {f.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel>
            <PanelHeader title="Files" />
            {docs.length ? (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <DocumentRow key={d.id} doc={d} people={byId} timeZone={ctx.profile.timezone}>
                    {canWrite ? (
                      <details className="w-full sm:w-auto">
                        <summary className="cursor-pointer text-sm text-ink-muted">More</summary>
                        <div className="mt-2 space-y-2 rounded-md border border-line p-3">
                          <ActionForm action={uploadDocument} className="space-y-2" resetOnSuccess>
                            <input type="hidden" name="organization_id" value={ctx.org.id} />
                            <input type="hidden" name="folder_id" value={folderId} />
                            <input type="hidden" name="document_id" value={d.id} />
                            <label className="block text-sm font-medium" htmlFor={`v-${d.id}`}>Upload new version</label>
                            <input id={`v-${d.id}`} type="file" name="file" required className="block w-full text-sm" />
                            <TextField label="What changed" name="note" optional maxLength={300} />
                            <SubmitButton size="sm" variant="secondary" pendingLabel="Uploading…">Upload version</SubmitButton>
                          </ActionForm>
                          {d.uploaded_by === ctx.userId || canManage ? (
                            <InlineActionForm action={archiveDocument} confirm={`Remove “${d.title}”?`}>
                              <input type="hidden" name="document_id" value={d.id} />
                              <SubmitButton size="sm" variant="ghost">Remove document</SubmitButton>
                            </InlineActionForm>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </DocumentRow>
                ))}
              </ul>
            ) : (
              <EmptyState title="This folder is empty">{canWrite ? "Upload the first file." : null}</EmptyState>
            )}
          </Panel>
        </div>
        {canWrite ? (
          <div className="space-y-6">
            <Panel className="h-fit">
              <PanelHeader title="Upload a file" description="PDF, Word, Excel, PowerPoint, images, TXT or CSV up to 25 MB." />
              <ActionForm action={uploadDocument} className="space-y-3 p-4" resetOnSuccess>
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="folder_id" value={folderId} />
                <div>
                  <label htmlFor="doc-file" className="mb-1.5 block text-sm font-medium">File</label>
                  <input id="doc-file" type="file" name="file" required className="block w-full text-sm" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.pptx,.txt,.csv" />
                </div>
                <TextField label="Title" name="title" optional maxLength={200} hint="Defaults to the file name" />
                <TextField label="Description" name="description" optional maxLength={1000} />
                <TextField label="Tags" name="tags" optional hint="Comma separated, e.g. safety, manuals" />
                <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
              </ActionForm>
            </Panel>
            <Panel className="h-fit">
              <PanelHeader title="New subfolder" />
              <ActionForm action={createFolder} className="space-y-3 p-4" resetOnSuccess>
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="parent_id" value={folderId} />
                <input type="hidden" name="scope" value={folder.scope} />
                <input type="hidden" name="scope_id" value={folder.scope_id ?? ""} />
                <TextField label="Name" name="name" required maxLength={100} />
                <SubmitButton size="sm" variant="secondary" pendingLabel="Creating…">Create subfolder</SubmitButton>
              </ActionForm>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
