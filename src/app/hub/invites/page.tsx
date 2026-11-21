import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub } from "@/server/services/hub";
import { composerData, inviteCompanies, listBroadcasts, mySignature } from "@/server/services/invites";
import { SignatureForm } from "@/components/invites/signature-form";
import { groupedZones } from "@/lib/timezones";
import { getOutlookSettings, outlookReady } from "@/server/services/outlook";
import { InviteComposer } from "@/components/invites/composer";
import { BroadcastList } from "@/components/invites/broadcast-list";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import Link from "@/components/ui/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Company Communications" };

export default async function HubInvitesPage() {
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const companies = await inviteCompanies(hub.companies.map((c) => ({ id: c.id, name: c.name, timezone: c.timezone })));
  const [data, sent, settings, signature] = await Promise.all([
    composerData(companies),
    listBroadcasts({ orgIds: companies.map((c) => c.id), limit: 50 }),
    getOutlookSettings(),
    mySignature(),
  ]);
  const ready = outlookReady(settings);
  const slugOf = new Map(hub.companies.map((c) => [c.id, c.slug]));
  const nameOf = new Map(hub.companies.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Company Communications" description="Calendar invites (travel, meetings, project kick-offs) and email updates to anyone in the group. They arrive in Outlook and in the app." />
      {!ready ? (
        <Notice tone="warn" title="Outlook isn't connected yet">
          Everything you send still reaches people here in the app, and is queued for Outlook. {hub.isPlatform || hub.companies.some((c) => c.can.settings) ? <Link className="font-medium underline" href="/hub/outlook">Connect Outlook</Link> : "Ask a super admin to connect Microsoft 365."}
        </Notice>
      ) : null}
      {companies.length ? (
        <Panel>
          <PanelHeader title="Send an invite or update" />
          <InviteComposer companies={companies} people={data.people} projects={data.projects} defaultCompany={hub.home?.id ?? companies[0].id} defaultTz={profile.timezone} signature={signature} zoneGroups={groupedZones()} />
        </Panel>
      ) : <Notice tone="neutral" title="You can't send invites">Ask a super admin for the “Send calendar invites and updates” permission.</Notice>}
      {companies.length ? (
        <Panel>
          <PanelHeader title="Your email signature" />
          <SignatureForm signature={signature} example={`${profile.display_name}\n${BRAND.exampleCompany}\n+44 …\nwww.${BRAND.exampleDomain}`} />
        </Panel>
      ) : null}
      <Panel>
        <PanelHeader title="Sent" />
        <BroadcastList rows={sent} tz={profile.timezone} hrefFor={(b) => `/o/${slugOf.get(b.organization_id)}/invites/${b.id}`} showOutlook companyName={(id) => nameOf.get(id)} />
      </Panel>
    </div>
  );
}
