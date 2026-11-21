import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getInbox } from "@/server/services/chat";
import { getStructure, listPeople } from "@/server/services/people";
import { createConversation, startDirect } from "@/server/actions/chat";
import { Inbox } from "@/components/chat/inbox";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { LiveRefresh } from "@/components/layout/live-refresh";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const [items, people, structure] = await Promise.all([getInbox(ctx.org.id), listPeople(ctx.org.id, { includeInactive: true }), getStructure(ctx.org.id)]);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const others = people.filter((p) => p.status === "active" && p.userId !== ctx.userId);
  const base = `/o/${ctx.org.slug}`;
  const canChannel = ctx.perms.hasAnyScope("chat.channel.create");

  return (
    <div className="space-y-6">
      <LiveRefresh table="messages" channel={`inbox-${ctx.org.id}`} filter={`organization_id=eq.${ctx.org.id}`} />
      <PageHeader title="Chat" description="Direct messages are private to the people in them. Administrators can't read them." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Conversations" />
          <Inbox items={items} people={byId} base={base} timeZone={ctx.profile.timezone} />
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="New message" />
            <ActionForm action={startDirect} className="flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="org_slug" value={ctx.org.slug} />
              <div className="min-w-48 flex-1">
                <SelectField label="To" name="user_id" required defaultValue="">
                  <option value="" disabled>Choose a colleague</option>
                  {others.map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ""}</option>)}
                </SelectField>
              </div>
              <SubmitButton pendingLabel="Opening…">Open chat</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel>
            <PanelHeader title="New group" description="A private conversation with several people." />
            <ActionForm action={createConversation} className="space-y-3 p-4">
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="org_slug" value={ctx.org.slug} />
              <input type="hidden" name="type" value="group" />
              <TextField label="Group name" name="name" required maxLength={80} placeholder="Refit planning" />
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">People</legend>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {others.map((p) => (
                    <label key={p.userId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="members" value={p.userId} className="size-4 accent-[var(--hull)]" />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <SubmitButton variant="secondary" pendingLabel="Creating…">Create group</SubmitButton>
            </ActionForm>
          </Panel>
          {canChannel ? (
            <Panel>
              <PanelHeader title="New channel" description="Open to the whole company or one team." />
              <ActionForm action={createConversation} className="space-y-3 p-4">
                <input type="hidden" name="organization_id" value={ctx.org.id} />
                <input type="hidden" name="org_slug" value={ctx.org.slug} />
                <input type="hidden" name="type" value="channel" />
                <TextField label="Channel name" name="name" required maxLength={80} placeholder="engineering" />
                <TextField label="Topic" name="topic" optional maxLength={300} />
                <SelectField label="Who can see it" name="audience" defaultValue="organization">
                  <option value="organization">Everyone in {ctx.org.name}</option>
                  <option value="team">One team</option>
                  <option value="members">Only people I add</option>
                </SelectField>
                <SelectField label="Team" name="team_id" optional defaultValue="" hint="Only for team channels">
                  <option value="">—</option>
                  {structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SelectField>
                <SubmitButton variant="secondary" pendingLabel="Creating…">Create channel</SubmitButton>
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
