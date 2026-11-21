import { Download, FileText, ImageIcon } from "lucide-react";
import type { DirectoryPerson } from "@/server/services/people";
import { Avatar } from "@/components/ui/avatar";
import { formatBytes } from "@/lib/format";
import { formatDate } from "@/lib/utils";

type Doc = {
  id: string; title: string; description: string | null; tags: string[]; current_file_id: string | null; current_version: number;
  uploaded_by: string; updated_by: string | null; updated_at: string; files: { file_name: string; mime_type: string; size_bytes: number } | null;
};

export function DocumentRow({ doc, people, timeZone, folderName, children }: { doc: Doc; people: Map<string, DirectoryPerson>; timeZone: string; folderName?: string; children?: React.ReactNode }) {
  const who = people.get(doc.updated_by ?? doc.uploaded_by);
  const isImage = doc.files?.mime_type.startsWith("image/");
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      {isImage ? <ImageIcon className="size-5 text-ink-muted" aria-hidden /> : <FileText className="size-5 text-ink-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{doc.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          {folderName ? <span>{folderName}</span> : null}
          {doc.files ? <span>{doc.files.file_name}, {formatBytes(doc.files.size_bytes)}</span> : null}
          <span>v{doc.current_version}</span>
          <span className="inline-flex items-center gap-1">
            <Avatar id={doc.updated_by ?? doc.uploaded_by} name={who?.name ?? "?"} src={who?.avatarUrl} size="xs" />
            {who?.name ?? "Former colleague"}, {formatDate(doc.updated_at, timeZone)}
          </span>
          {doc.tags.map((t) => <span key={t} className="rounded bg-panel-sunk px-1">{t}</span>)}
        </p>
        {doc.description ? <p className="mt-0.5 text-sm text-ink-muted">{doc.description}</p> : null}
      </div>
      {doc.current_file_id ? (
        <a href={`/files/${doc.current_file_id}?download=1`} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-panel-sunk">
          <Download className="size-4" aria-hidden /> Download
        </a>
      ) : null}
      {children}
    </li>
  );
}
