import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ui/action-form";
import { CheckboxField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { graphConfigured } from "@/lib/sharepoint/graph";
import { saveM365Settings, syncM365Now } from "@/server/actions/m365";
import type { ProjectReport } from "@/server/services/m365-sync";

export const metadata: Metadata = { title: "Microsoft 365 projects" };

const SKIP_WHY: Record<string, string> = {
  no_email: "no email address on file",
  not_in_tenant: "email isn't in your Microsoft 365 tenant",
  disabled_account: "Microsoft account is disabled",
};

export default async function M365Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("org.settings.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const supabase = await createClient();
  const [{ data: s }, { data: links }, { data: projects }] = await Promise.all([
    supabase.from("m365_sync_settings").select("enabled, last_run_at, last_report").eq("organization_id", ctx.org.id).maybeSingle(),
    supabase.from("project_m365_links").select("project_id, report, last_error, last_synced_at").eq("organization_id", ctx.org.id),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id),
  ]);
  const name = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const rows = (links ?? []).map((l) => ({ id: l.project_id as string, name: name.get(l.project_id as string) ?? "Project", report: (l.report ?? null) as ProjectReport | null, error: (l.last_error as string) ?? null, at: l.last_synced_at as string | null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const connected = graphConfigured();
  const enabled = s?.enabled ?? false;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Microsoft 365 projects"
        description={`Gives every project its own private Microsoft 365 group and Planner plan. ${ctx.org.name}'s project tasks, project log and project dates appear there, so team members see them in Planner, Microsoft To Do (Assigned to me) and Outlook. PAs and HR are never added.`}
      />
      {!connected ? (
        <Notice tone="warn" title="Microsoft 365 isn't connected yet">
          Your Microsoft 365 administrator needs to add MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel and grant the app the permissions listed in docs/deploy/microsoft-365.md.
        </Notice>
      ) : null}

      <ActionForm action={saveM365Settings} className="mt-6 space-y-6">
        <input type="hidden" name="organization_id" value={ctx.org.id} />
        <Panel>
          <PanelHeader title="Project sync" description="Off by default. Switching it off stops syncing; nothing already in Microsoft 365 is deleted." />
          <div className="space-y-4 p-4 sm:p-5">
            <CheckboxField name="enabled" defaultChecked={enabled} label={`Sync ${ctx.org.name}'s planning and active projects to Microsoft 365`} />
            <SubmitButton>Save</SubmitButton>
          </div>
        </Panel>
      </ActionForm>

      {enabled ? (
        <ActionForm action={syncM365Now} className="mt-4">
          <input type="hidden" name="organization_id" value={ctx.org.id} />
          <SubmitButton>Sync now</SubmitButton>
          <p className="mt-2 text-xs text-ink-muted">Runs automatically once a day (00:00 UTC, 07:00 Bangkok) and on Sync now. {s?.last_run_at ? `Last run ${new Date(s.last_run_at as string).toLocaleString("en-GB", { timeZone: ctx.profile.timezone })}.` : "Not run yet."}</p>
        </ActionForm>
      ) : null}

      <Panel className="mt-6">
        <PanelHeader title="Sync report" description="Per project: who was added, who was left out and why, and anything that went wrong." />
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.error ? <Badge tone="danger">Failed</Badge> : <Badge tone="ok">Synced</Badge>}
                  {r.at ? <span className="text-xs text-ink-muted">{new Date(r.at).toLocaleString("en-GB", { timeZone: ctx.profile.timezone })}</span> : null}
                </div>
                {r.error ? <p className="text-xs text-danger">{r.error}</p> : null}
                {r.report ? (
                  <>
                    <p className="text-xs text-ink-muted">
                      {r.report.members.total} in the group (+{r.report.members.added} / −{r.report.members.removed}). Tasks: {r.report.tasks.created} new, {r.report.tasks.updated} updated, {r.report.tasks.removed} removed, {r.report.tasks.completedInHub} completed from Planner.
                    </p>
                    {r.report.excluded.length ? <p className="text-xs text-ink-muted">Left out (PA/HR): {r.report.excluded.map((x) => `${x.name} (${x.reason})`).join(", ")}</p> : null}
                    {r.report.skipped.length ? <p className="text-xs text-ink-muted">Not in Microsoft 365, skipped: {r.report.skipped.map((x) => `${x.name} (${SKIP_WHY[x.reason] ?? x.reason})`).join(", ")}</p> : null}
                    {r.report.warnings.map((w, i) => <p key={i} className="text-xs text-warn">{w}</p>)}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">Nothing synced yet.</p>
        )}
      </Panel>
    </div>
  );
}
