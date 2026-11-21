import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { DEFAULT_TEMPLATES, KIND_LABEL, PLACEHOLDERS, SHAREPOINT_KINDS, renderPath, type SharePointKind } from "@/lib/sharepoint/paths";
import { graphConfigured } from "@/lib/sharepoint/graph";
import { fileNow, retrySharePointUpload, runSharePointNow, saveSharePointSettings, testSharePoint } from "@/server/actions/sharepoint";
import { todayIn } from "@/lib/time";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "SharePoint filing" };

const STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "danger" | "warn" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  uploading: { label: "Uploading", tone: "neutral" },
  done: { label: "Filed", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "warn" },
};

const EXAMPLE: Record<string, string> = {
  company: "", year: "2026", month_num: "10", month_name: "October", date: "2026-11-02", week: "2026-W43", week_range: "19-25 Oct",
  employee: "Jane Smith", merchant: "Farnell", expense_date: "2026-10-14", total: "74.50", currency: "GBP", ext: "pdf", export_date: "2026-10-31", card: "4821",
};

export default async function SharePointPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("org.settings.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const supabase = await createClient();
  const [{ data: s }, { data: uploads }, { count: waiting }] = await Promise.all([
    supabase.from("sharepoint_settings").select("*").eq("organization_id", ctx.org.id).maybeSingle(),
    supabase.from("sharepoint_uploads").select("id, kind, status, path, web_url, last_error, attempts, created_at, completed_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("sharepoint_uploads").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "pending"),
  ]);
  const connected = graphConfigured();
  const settings = {
    enabled: s?.enabled ?? false,
    site_url: s?.site_url ?? "",
    library: s?.library ?? "Documents",
    root_folder: s?.root_folder ?? `${BRAND.product}/{company}`,
    templates: (s?.templates ?? {}) as Partial<Record<SharePointKind, string>>,
    disabled: new Set<string>(s?.disabled_kinds ?? []),
  };
  const example = { ...EXAMPLE, company: ctx.org.name };
  const today = todayIn(ctx.profile.timezone);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="SharePoint filing"
        description={`Copies ${ctx.org.name}'s receipts, expense workbooks, Xero files, timesheets and reports into your company SharePoint. Files are only ever added, never changed or deleted.`}
      />

      {!connected ? (
        <Notice tone="warn" title="Microsoft 365 isn't connected yet">
          Your Microsoft 365 administrator needs to register the app and add MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel. You can set everything up here now; files wait in the queue until the connection works.
        </Notice>
      ) : s?.verified_at ? (
        <Notice tone="ok" title="Connected">Last checked {new Date(s.verified_at).toLocaleString("en-GB", { timeZone: ctx.profile.timezone })}.</Notice>
      ) : null}

      <ActionForm action={saveSharePointSettings} className="mt-6 space-y-6">
        <input type="hidden" name="organization_id" value={ctx.org.id} />
        <Panel>
          <PanelHeader title="Where files go" />
          <div className="space-y-4 p-4 sm:p-5">
            <CheckboxField name="enabled" defaultChecked={settings.enabled} label={`File ${ctx.org.name}'s documents to SharePoint`} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="SharePoint site address" name="site_url" defaultValue={settings.site_url} placeholder="https://yourcompany.sharepoint.com/sites/Finance" hint="Open the site in your browser and copy the address up to the site name." optional />
              <TextField label="Document library" name="library" defaultValue={settings.library} required hint="Usually “Documents” (shown as “Shared Documents”)." />
            </div>
            <TextField label="Company folder" name="root_folder" defaultValue={settings.root_folder} required hint={`Everything for this company goes under this folder. Now: “${renderPath(settings.root_folder, "", example)}”.`} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="What is filed, and the file names" description="Use / for sub-folders. Placeholders in {braces} are filled in for each file. Clear a box to go back to the default." />
          <ul className="divide-y divide-line">
            {SHAREPOINT_KINDS.map((kind) => {
              const tpl = settings.templates[kind] ?? DEFAULT_TEMPLATES[kind];
              return (
                <li key={kind} className="space-y-2 px-4 py-3 sm:px-5">
                  <CheckboxField name={`on_${kind}`} defaultChecked={!settings.disabled.has(kind)} label={KIND_LABEL[kind]} />
                  <TextField label="Path and file name" name={`tpl_${kind}`} defaultValue={tpl} className="font-mono text-xs" />
                  <p className="break-all text-xs text-ink-muted">Example: {renderPath(settings.root_folder, tpl, example)}</p>
                </li>
              );
            })}
          </ul>
          <details className="border-t border-line px-4 py-3 text-sm sm:px-5">
            <summary className="cursor-pointer font-medium">Placeholders you can use</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
              {Object.entries(PLACEHOLDERS).map(([k, v]) => (
                <div key={k} className="contents"><dt className="font-mono text-xs">{`{${k}}`}</dt><dd className="text-ink-muted">{v}</dd></div>
              ))}
            </dl>
          </details>
        </Panel>
        <SubmitButton>Save SharePoint settings</SubmitButton>
      </ActionForm>

      <Panel className="mt-8">
        <PanelHeader title="Check and run" />
        <div className="flex flex-wrap gap-3 p-4 sm:p-5">
          <ActionForm action={testSharePoint}>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <SubmitButton variant="secondary" pendingLabel="Checking…">Test connection</SubmitButton>
          </ActionForm>
          <ActionForm action={runSharePointNow}>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <SubmitButton variant="secondary" pendingLabel="Uploading…">Upload waiting files now{waiting ? ` (${waiting})` : ""}</SubmitButton>
          </ActionForm>
        </div>
        <p className="px-4 pb-4 text-xs text-ink-muted sm:px-5">
          Receipts, approved timesheets, month closes and Xero exports are filed within a minute. Weekly and monthly files are filed every morning for the last complete week and month. Anything that fails is retried automatically.
        </p>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="File something now" description="For example last week's timesheets, or a month from before filing was switched on. Filing again adds a new version." />
        <ActionForm action={fileNow} className="grid gap-3 p-4 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end sm:p-5">
          <input type="hidden" name="organization_id" value={ctx.org.id} />
          <SelectField label="What" name="kind" defaultValue="weekly_timesheets">
            <option value="weekly_timesheets">Weekly timesheet — all staff</option>
            <option value="weekly_report">Weekly report</option>
            <option value="monthly_report">Monthly report</option>
            <option value="expense_month">Monthly expense workbook</option>
            <option value="leave_register">Leave register (year to month end)</option>
          </SelectField>
          <TextField label="Week (any day in it)" name="week" type="date" defaultValue={today} hint="For weekly files" />
          <TextField label="Month" name="month" type="month" defaultValue={today.slice(0, 7)} hint="For monthly files" />
          <SubmitButton variant="secondary" pendingLabel="Queuing…">File it</SubmitButton>
        </ActionForm>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Upload log" description="The last 100 files." />
        <ul className="divide-y divide-line">
          {(uploads ?? []).map((u) => {
            const st = STATUS[u.status] ?? STATUS.pending;
            return (
              <li key={u.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="text-ink-muted">{KIND_LABEL[u.kind as SharePointKind]?.split(" (")[0] ?? u.kind}</span>
                    <span className="text-xs text-ink-muted">{new Date(u.completed_at ?? u.created_at).toLocaleString("en-GB", { timeZone: ctx.profile.timezone, dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  {u.path ? (
                    u.web_url ? <a href={u.web_url} target="_blank" rel="noreferrer" className="block break-all text-xs underline">{u.path}</a> : <span className="block break-all text-xs">{u.path}</span>
                  ) : null}
                  {u.last_error && u.status !== "done" ? <span className="block text-xs text-danger">{u.last_error}{u.status === "pending" && u.attempts ? ` (attempt ${u.attempts})` : ""}</span> : null}
                </div>
                {u.status === "failed" || u.status === "skipped" ? (
                  <InlineActionForm action={retrySharePointUpload}>
                    <input type="hidden" name="organization_id" value={ctx.org.id} />
                    <input type="hidden" name="id" value={u.id} />
                    <button type="submit" className="text-xs underline">Retry</button>
                  </InlineActionForm>
                ) : null}
              </li>
            );
          })}
          {!uploads?.length ? <li className="px-5 py-4 text-sm text-ink-muted">Nothing filed yet.</li> : null}
        </ul>
      </Panel>
    </div>
  );
}
