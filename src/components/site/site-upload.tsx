"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { addDrawing, runSiteImport, startSiteUpload, type ImportKind } from "@/server/actions/site-import";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { DISCIPLINES } from "@/lib/site-constants";
import { imageToPdf, isImage } from "@/lib/drawings/image-to-pdf";

async function upload(projectId: string, kind: ImportKind, file: File) {
  const start = await startSiteUpload({ projectId, kind, fileName: file.name, size: file.size });
  if (!start.ok) throw new Error(start.error);
  const { error } = await getBrowserClient().storage.from("files").uploadToSignedUrl(start.path, start.token, file, {
    contentType: file.type || (kind === "network" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf"),
  });
  if (error) throw new Error("The upload failed. Check your connection and try again.");
  return start.path;
}

/** Upload + import of a schedule file (network spreadsheet, Lutron integration report, Lutron load schedule). */
export function SiteImport({ projectId, kind, label, accept, hint }: { projectId: string; kind: Exclude<ImportKind, "drawing">; label: string; accept: string; hint: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: string | null; ok?: string; error?: string }>({ busy: null });
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
        if (!file) return setState({ busy: null, error: "Choose a file." });
        try {
          setState({ busy: "Uploading…" });
          const path = await upload(projectId, kind, file);
          setState({ busy: "Reading the file and importing… (a large PDF can take a minute)" });
          const r = await runSiteImport({ projectId, kind, path, fileName: file.name });
          if (r.ok) { setState({ busy: null, ok: r.message ?? "Imported." }); router.refresh(); }
          else setState({ busy: null, error: r.error });
        } catch (err) {
          setState({ busy: null, error: err instanceof Error ? err.message : "Something went wrong." });
        }
      }}
    >
      <label className="block text-sm font-medium">{label}</label>
      <p className="text-xs text-ink-muted">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept={accept} required className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" disabled={Boolean(state.busy)} />
        <button type="submit" className={buttonClass("primary", "sm")} disabled={Boolean(state.busy)}>{state.busy ? "Working…" : "Import"}</button>
      </div>
      {state.busy ? <p className="text-sm text-ink-muted" role="status">{state.busy}</p> : null}
      {state.ok ? <p className="text-sm text-ok" role="status">{state.ok}</p> : null}
      {state.error ? <p className="text-sm text-danger" role="alert">{state.error}</p> : null}
    </form>
  );
}


/** Upload a GA / drawing PDF with its title, discipline, number and revision. */
export function DrawingUpload({ projectId, current }: { projectId: string; current: { id: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: string | null; ok?: string; error?: string }>({ busy: null });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        let file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
        if (!file) return setState({ busy: null, error: "Choose a PDF or an image." });
        try {
          if (isImage(file)) {
            setState({ busy: "Turning the image into a PDF…" });
            file = await imageToPdf(file);
          }
          setState({ busy: "Uploading the drawing…" });
          const path = await upload(projectId, "drawing", file);
          const r = await addDrawing({
            projectId, path, fileName: file.name, title: String(f.get("title") ?? ""), discipline: String(f.get("discipline") ?? "general") as never,
            number: String(f.get("number") ?? ""), revision: String(f.get("revision") ?? ""), deck: String(f.get("deck") ?? ""), supersedes: String(f.get("supersedes") ?? ""),
          });
          if (r.ok) { setState({ busy: null, ok: r.message }); form.reset(); router.refresh(); }
          else setState({ busy: null, error: r.error });
        } catch (err) {
          setState({ busy: null, error: err instanceof Error ? err.message : "Something went wrong." });
        }
      }}
    >
      <label className="block text-sm sm:col-span-2"><span className="font-medium">Drawing (PDF, PNG or JPEG)</span>
        <input type="file" name="file" accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp" required className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
      </label>
      <label className="block text-sm sm:col-span-2"><span className="font-medium">Title</span>
        <input name="title" required maxLength={200} placeholder="General arrangement" className={cn(controlClass, "mt-1")} />
      </label>
      <label className="block text-sm"><span className="font-medium">Discipline</span>
        <select name="discipline" defaultValue="general" className={cn(controlClass, "mt-1")}>{DISCIPLINES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label className="block text-sm"><span className="font-medium">Deck / floor</span> <span className="text-ink-muted">(optional)</span>
        <input name="deck" maxLength={60} placeholder="All decks" className={cn(controlClass, "mt-1")} />
      </label>
      <label className="block text-sm"><span className="font-medium">Drawing number</span> <span className="text-ink-muted">(optional)</span>
        <input name="number" maxLength={80} className={cn(controlClass, "mt-1")} />
      </label>
      <label className="block text-sm"><span className="font-medium">Revision</span> <span className="text-ink-muted">(optional)</span>
        <input name="revision" maxLength={20} placeholder="A" className={cn(controlClass, "mt-1")} />
      </label>
      {current.length ? (
        <label className="block text-sm sm:col-span-2"><span className="font-medium">Replaces</span> <span className="text-ink-muted">(optional: makes this the new revision)</span>
          <select name="supersedes" defaultValue="" className={cn(controlClass, "mt-1")}><option value="">Nothing — a new drawing</option>{current.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
        </label>
      ) : null}
      <div className="sm:col-span-2">
        <button type="submit" className={buttonClass("primary")} disabled={Boolean(state.busy)}>{state.busy ?? "Upload drawing"}</button>
        {state.ok ? <p className="mt-2 text-sm text-ok" role="status">{state.ok}</p> : null}
        {state.error ? <p className="mt-2 text-sm text-danger" role="alert">{state.error}</p> : null}
      </div>
    </form>
  );
}
