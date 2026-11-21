import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getHub } from "@/server/services/hub";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphConfigured } from "@/lib/sharepoint/graph";
import { AUTO_KINDS, getOutlookSettings } from "@/server/services/outlook";
import { retryOutlookItem, runOutlookNow, saveOutlookSettings, testOutlook } from "@/server/actions/outlook";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Outlook" };

const KIND_LABEL: Record<string, string> = { task: "Task", shift: "Shift", project: "Project", leave: "Leave", manual: "Invite/update" };

export default async function OutlookPage() {
  const hub = await getHub();
  if (!hub || !(hub.isPlatform || hub.companies.some((c) => c.can.settings))) redirect("/hub");
  const admin = createAdminClient();
  const [settings, { data: counts }, { data: problems }] = await Promise.all([
    getOutlookSettings(admin),
    admin.from("calendar_sync").select("status"),
    admin.from("calendar_sync").select("id, kind, status, attempts, last_error, updated_at").eq("status", "failed").order("updated_at", { ascending: false }).limit(20),
  ]);
  const n = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const connected = graphConfigured();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Outlook" description="Calendar invites and updates go out from one shared mailbox, for every company in the group." />

      <Panel>
        <PanelHeader title="Connection" />
        <div className="space-y-3 p-4 text-sm sm:p-5">
          <p>Microsoft 365 app: {connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="danger">Not connected</Badge>} · Shared mailbox: {settings.mailbox ? <Badge tone="ok">{settings.mailbox}</Badge> : <Badge tone="warn">Not set</Badge>}</p>
          <p className="text-ink-muted">Queue: {n("synced")} in Outlook · {n("pending")} waiting · {n("failed")} failed · {n("skipped")} not sent (switched off)</p>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={testOutlook}><SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">Send me a test invite</SubmitButton></ActionForm>
            <ActionForm action={runOutlookNow}><SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">Send waiting items now</SubmitButton></ActionForm>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Settings" />
        <ActionForm action={saveOutlookSettings} className="space-y-4 p-4 sm:p-5">
          <TextField label="Shared mailbox" name="mailbox" type="email" defaultValue={settings.mailbox ?? ""} placeholder={`hub@${BRAND.exampleDomain}`} hint="Invites come from this address and replies go to it. It must be a mailbox in your Microsoft 365." />
          <fieldset>
            <legend className="text-sm font-medium">Send these automatically</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {Object.entries(AUTO_KINDS).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto_kinds" value={k} defaultChecked={settings.auto_kinds.includes(k)} className="size-4" /> {label}</label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-muted">Task due dates → the people assigned · Shifts → the person · Project assignments → the team, start to end date · Approved leave → the person and their manager. Changes send updates; cancellations send cancellations.</p>
          </fieldset>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </ActionForm>
      </Panel>

      {(problems ?? []).length ? (
        <Panel>
          <PanelHeader title="Failed" />
          <ul className="divide-y divide-line">
            {(problems ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0"><strong>{KIND_LABEL[p.kind as string] ?? p.kind}</strong> · {p.attempts} tries<span className="block text-xs text-danger">{p.last_error}</span></span>
                <InlineActionForm action={retryOutlookItem}>
                  <input type="hidden" name="id" value={p.id as string} />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="…">Retry</SubmitButton>
                </InlineActionForm>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {!connected ? (
        <Notice tone="warn" title="One-time Microsoft 365 setup (your Microsoft admin)">
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Create a shared mailbox, e.g. <strong>hub@{BRAND.exampleDomain}</strong> (Microsoft 365 admin → Teams &amp; groups → Shared mailboxes).</li>
            <li>In Microsoft Entra → App registrations, use the {BRAND.product} app (the SharePoint one) or create it. Under API permissions add Microsoft Graph <strong>application</strong> permissions <strong>Calendars.ReadWrite</strong> and <strong>Mail.Send</strong> (plus Sites.Selected for SharePoint) and press “Grant admin consent”.</li>
            <li>Limit the app to the shared mailbox only (Exchange Online PowerShell): <code className="text-xs">New-ApplicationAccessPolicy -AppId &lt;client id&gt; -PolicyScopeGroupId hub@{BRAND.exampleDomain} -AccessRight RestrictAccess</code></li>
            <li>In Vercel → your project → Settings → Environment Variables add <strong>MS_TENANT_ID</strong>, <strong>MS_CLIENT_ID</strong> and <strong>MS_CLIENT_SECRET</strong> (secret: paste it only there), then redeploy.</li>
            <li>Enter the mailbox above, save, and press “Send me a test invite”.</li>
          </ol>
        </Notice>
      ) : null}
    </div>
  );
}
