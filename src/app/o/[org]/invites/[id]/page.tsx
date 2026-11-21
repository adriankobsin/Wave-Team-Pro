import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABEL, whenLabel, type BroadcastRow } from "@/server/services/invites";
import { Badge, PageHeader, Panel } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Invite" };

export default async function InvitePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data } = await supabase.from("calendar_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  // Staff calendar and travel invites open on their own pages.
  if (data.source && typeof data.link_path === "string" && data.link_path.startsWith("/")) redirect(data.link_path);
  const b = data as BroadcastRow;
  const { data: author } = await supabase.from("profiles").select("display_name").eq("id", b.created_by).maybeSingle();
  const when = whenLabel(b, ctx.profile.timezone);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/o/${ctx.org.slug}/invites`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Company Communications</Link>
      <PageHeader title={b.title} description={`${b.kind === "invite" ? "Invite" : "Update"} from ${author?.display_name ?? "management"}`} actions={<Badge>{CATEGORY_LABEL[b.category] ?? b.category}</Badge>} />
      <Panel className="space-y-3 p-4 text-sm sm:p-5">
        {when ? <p><strong>When:</strong> {when}{b.all_day ? "" : ` (your time, ${ctx.profile.timezone.replace(/_/g, " ")})`}</p> : null}
        {b.location ? <p><strong>Where:</strong> {b.location}</p> : null}
        {b.body ? <p className="whitespace-pre-wrap">{b.body}</p> : null}
        {b.signature ? <p className="whitespace-pre-wrap border-t border-line pt-3 text-ink-muted">{b.signature}</p> : null}
        {b.attachments?.length ? (
          <div className="border-t border-line pt-3">
            <p className="font-medium">Attachments</p>
            <ul className="mt-1 space-y-1">
              {b.attachments.map((a, i) => (
                <li key={a.path}>
                  <a className="underline-offset-4 hover:underline" href={`/o/${ctx.org.slug}/invites/${b.id}/attachments/${i}`}>{a.name}</a>
                  <span className="text-xs text-ink-muted"> · {Math.max(1, Math.round(a.size / 1024))} KB</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {b.kind === "invite" ? <p className="text-xs text-ink-muted">This is also in your Outlook calendar once Outlook is connected — accept it there to keep it.</p> : null}
      </Panel>
    </div>
  );
}
