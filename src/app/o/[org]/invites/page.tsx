import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { InviteComposer } from "@/components/invites/composer";
import { BroadcastList } from "@/components/invites/broadcast-list";
import { composerData, listBroadcasts, mySignature } from "@/server/services/invites";
import { SignatureForm } from "@/components/invites/signature-form";
import { groupedZones } from "@/lib/timezones";
import { getOutlookSettings, outlookReady } from "@/server/services/outlook";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Company Communications" };

export default async function InvitesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const canSend = ctx.perms.has("invites.send");
  const tz = ctx.profile.timezone;
  const base = `/o/${ctx.org.slug}/invites`;
  const company = { id: ctx.org.id, name: ctx.org.name, timezone: ctx.org.timezone };
  const [mine, sent, data, ready, signature] = await Promise.all([
    listBroadcasts({ toUser: ctx.userId, limit: 30 }),
    canSend ? listBroadcasts({ orgIds: [ctx.org.id], limit: 30 }) : Promise.resolve([]),
    canSend ? composerData([company]) : Promise.resolve(null),
    canSend ? getOutlookSettings().then(outlookReady) : Promise.resolve(true),
    canSend ? mySignature() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Communications"
        description={canSend ? "Send calendar invites (travel, meetings) and updates to staff. They arrive in Outlook and here." : "Travel details, meetings and updates sent to you."}
      />
      {canSend && !ready ? (
        <Notice tone="warn" title="Outlook isn't connected yet">Invites and updates still reach everyone here in the app. They&apos;ll go to Outlook calendars once a super admin connects Microsoft 365.</Notice>
      ) : null}
      {canSend && data ? (
        <Panel>
          <PanelHeader title="Send an invite or update" />
          <InviteComposer companies={[company]} people={data.people} projects={data.projects} defaultCompany={ctx.org.id} defaultTz={ctx.org.timezone} signature={signature} zoneGroups={groupedZones()} />
        </Panel>
      ) : null}
      {canSend ? (
        <Panel>
          <PanelHeader title="Your email signature" />
          <SignatureForm signature={signature} example={`${ctx.profile.display_name}\n${ctx.membership.job_title ?? BRAND.exampleCompany}\n${ctx.org.name}\nwww.${BRAND.exampleDomain}`} />
        </Panel>
      ) : null}
      <Panel>
        <PanelHeader title="For you" />
        <BroadcastList rows={mine} tz={tz} hrefFor={(b) => `${base}/${b.id}`} />
      </Panel>
      {canSend ? (
        <Panel>
          <PanelHeader title={`Sent in ${ctx.org.name}`} />
          <BroadcastList rows={sent} tz={tz} hrefFor={(b) => `${base}/${b.id}`} showOutlook />
        </Panel>
      ) : null}
    </div>
  );
}
