import type { Metadata } from "next";
import { Megaphone, Pin } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { getStructure, listPeople } from "@/server/services/people";
import { acknowledgeAnnouncement, archiveAnnouncement, publishAnnouncement } from "@/server/actions/announcements";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PersonLabel } from "@/components/ui/avatar";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [{ data: rows }, people, structure, { data: myAcks }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, audience, team_id, requires_ack, pinned, expires_at, published_by, published_at")
      .eq("organization_id", ctx.org.id)
      .is("archived_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(50),
    listPeople(ctx.org.id, { includeInactive: true }),
    getStructure(ctx.org.id),
    supabase.from("announcement_acknowledgements").select("announcement_id").eq("user_id", ctx.userId),
  ]);
  const list = rows ?? [];
  const acked = new Set((myAcks ?? []).map((a) => a.announcement_id));
  const byId = new Map(people.map((p) => [p.userId, p]));
  const teamName = new Map(structure.teams.map((t) => [t.id, t.name]));
  const canPublish = ctx.perms.hasAnyScope("announcements.publish");
  const canManage = ctx.perms.has("announcements.publish");

  const ackIds = list.filter((a) => a.requires_ack && (a.published_by === ctx.userId || canManage)).map((a) => a.id);
  const { data: ackCounts } = ackIds.length
    ? await supabase.from("announcement_acknowledgements").select("announcement_id").in("announcement_id", ackIds)
    : { data: [] as { announcement_id: string }[] };
  const countFor = (id: string) => (ackCounts ?? []).filter((a) => a.announcement_id === id).length;
  const activeCount = people.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Announcements" description="Company and team news. Some announcements ask you to confirm you've read them." />
      <div className={canPublish ? "grid gap-6 lg:grid-cols-[1.5fr_1fr]" : ""}>
        <div className="space-y-4">
          {list.length ? (
            list.map((a) => {
              const author = byId.get(a.published_by);
              const needsAck = a.requires_ack && !acked.has(a.id) && a.published_by !== ctx.userId;
              return (
                <Panel key={a.id} id={`a-${a.id}`} className={needsAck ? "border-brass" : undefined}>
                  <article className="p-4 sm:p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {a.pinned ? <Badge tone="warn"><Pin className="mr-1 size-3" aria-hidden />Pinned</Badge> : null}
                      <Badge>{a.audience === "team" ? `Team: ${teamName.get(a.team_id ?? "") ?? "team"}` : "Everyone"}</Badge>
                      {a.requires_ack ? <Badge tone={acked.has(a.id) ? "ok" : "warn"}>{acked.has(a.id) ? "Acknowledged" : "Please acknowledge"}</Badge> : null}
                    </div>
                    <h2 className="text-xl font-semibold">{a.title}</h2>
                    <div className="mt-2 max-w-prose whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{a.body}</div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <PersonLabel id={a.published_by} name={author?.name ?? "Former colleague"} src={author?.avatarUrl} sub={formatDateTime(a.published_at, ctx.profile.timezone)} />
                      <div className="flex flex-wrap items-center gap-2">
                        {a.requires_ack && (a.published_by === ctx.userId || canManage) ? (
                          <span className="text-sm text-ink-muted tabular">{countFor(a.id)} of {activeCount} acknowledged</span>
                        ) : null}
                        {needsAck ? (
                          <InlineActionForm action={acknowledgeAnnouncement}>
                            <input type="hidden" name="announcement_id" value={a.id} />
                            <SubmitButton size="sm" pendingLabel="Saving…">I&apos;ve read this</SubmitButton>
                          </InlineActionForm>
                        ) : null}
                        {a.published_by === ctx.userId || canManage ? (
                          <InlineActionForm action={archiveAnnouncement} confirm="Archive this announcement?">
                            <input type="hidden" name="announcement_id" value={a.id} />
                            <SubmitButton size="sm" variant="ghost" pendingLabel="Archiving…">Archive</SubmitButton>
                          </InlineActionForm>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </Panel>
              );
            })
          ) : (
            <Panel>
              <EmptyState title="No announcements">
                <Megaphone className="mx-auto mb-2 size-6 text-ink-muted" aria-hidden />
                Company news will appear here.
              </EmptyState>
            </Panel>
          )}
        </div>
        {canPublish ? (
          <Panel className="h-fit">
            <PanelHeader title="Publish an announcement" />
            <ActionForm action={publishAnnouncement} className="space-y-4 p-4 sm:p-5" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <TextField label="Title" name="title" required maxLength={160} />
              <TextAreaField label="Message" name="body" required rows={6} maxLength={10000} />
              <SelectField label="Audience" name="audience" defaultValue="organization">
                {canManage ? <option value="organization">Everyone in {ctx.org.name}</option> : null}
                <option value="team">One team</option>
              </SelectField>
              <SelectField label="Team" name="team_id" optional defaultValue="">
                <option value="">—</option>
                {structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
              <TextField label="Expires on" name="expires_at" type="date" optional />
              <CheckboxField label="Ask people to acknowledge" name="requires_ack" />
              <CheckboxField label="Pin to the top" name="pinned" />
              <SubmitButton pendingLabel="Publishing…">Publish</SubmitButton>
            </ActionForm>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
