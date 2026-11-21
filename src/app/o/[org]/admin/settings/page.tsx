import type { Metadata } from "next";
import { CountrySelect, CurrencySelect } from "@/components/ui/region-select";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { updateOrganizationSettings } from "@/server/actions/organization";
import { addHoliday, deleteHoliday, saveLeaveType } from "@/server/actions/workforce";
import { InlineActionForm } from "@/components/ui/action-form";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ui/action-form";
import { CheckboxField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { AlertSettings, ALERT_LABELS } from "@/components/admin/alert-settings";
import { listPeople } from "@/server/services/people";
import { emailConfigured } from "@/lib/email";
import { uploadLogo, removeLogo } from "@/server/actions/branding";
import { logoVersion } from "@/server/services/branding";

export const metadata: Metadata = { title: "Organization settings" };

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("org.settings.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const { org, settings } = ctx;
  const logoV = await logoVersion(org.id);
  const supabase = await createClient();
  const [people, { data: alertSettings }, { data: alertRecipients }, ...currentLists] = await Promise.all([
    listPeople(org.id),
    supabase.from("management_alert_events").select("event, enabled, email, custom_recipients").eq("organization_id", org.id),
    supabase.from("management_alert_recipients").select("event, membership_id").eq("organization_id", org.id),
    ...Object.keys(ALERT_LABELS).map((ev) => supabase.rpc("management_recipients", { p_org: org.id, p_event: ev })),
  ]);
  const nameByMembership = new Map(people.map((p) => [p.membershipId, p.name]));
  const current = Object.fromEntries(Object.keys(ALERT_LABELS).map((ev, i) => [ev, (((currentLists[i] as { data: { membership_id: string }[] | null }).data) ?? []).map((r) => nameByMembership.get(r.membership_id) ?? "Colleague")]));
  const [{ data: leaveTypes }, { data: holidays }] = await Promise.all([
    supabase.from("leave_types").select("id, name, color, paid, annual_days, requires_note, active").eq("organization_id", org.id).order("name"),
    supabase.from("public_holidays").select("id, holiday_date, name").eq("organization_id", org.id).gte("holiday_date", `${new Date().getUTCFullYear()}-01-01`).order("holiday_date"),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Organization settings" />
      <Panel className="mb-6">
        <PanelHeader title="Company logo" description="Shown in the menu for everyone in this company and at the top of every downloaded report (PDF and Excel). PNG with a transparent background works best." />
        <div className="flex flex-wrap items-center gap-6 p-4 sm:p-5">
          <div className="flex h-20 w-60 items-center justify-center rounded-md border border-dashed border-line bg-panel-sunk p-2">
            {logoV ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/o/${org.slug}/logo?v=${logoV}`} alt={`${org.name} logo`} className="max-h-full max-w-full object-contain" />
            ) : <span className="text-xs text-ink-muted">No logo yet</span>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <ActionForm action={uploadLogo} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="organization_id" value={org.id} />
              <label className="text-sm">
                <span className="mb-1 block font-medium">Upload a logo</span>
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" required className="block text-sm" />
              </label>
              <SubmitButton size="sm" pendingLabel="Uploading…">Save logo</SubmitButton>
            </ActionForm>
            {logoV ? (
              <ActionForm action={removeLogo} confirm="Remove the company logo?">
                <input type="hidden" name="organization_id" value={org.id} />
                <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…">Remove</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </div>
      </Panel>
      <ActionForm action={updateOrganizationSettings} className="space-y-6">
        <input type="hidden" name="organization_id" value={org.id} />
        <Panel>
          <PanelHeader title="Legal entity" description={`Web address /o/${org.slug} can't be changed.`} />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <TextField label="Name" name="name" defaultValue={org.name} required />
            <TextField label="Entity code" name="legal_entity_code" defaultValue={org.legal_entity_code ?? ""} optional />
            <CountrySelect label="Country" name="country" defaultValue={org.country} required />
            <CurrencySelect label="Base currency" name="base_currency" defaultValue={org.base_currency} required hint="Used for expense reporting" />
            <TextField label="Time zone" name="timezone" defaultValue={org.timezone} required hint="IANA name, e.g. Asia/Bangkok" />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Security and privacy" />
          <div className="space-y-4 p-4 sm:p-5">
            <CheckboxField
              label="Require two-step verification for protected permissions"
              hint="Admin, HR-private, audit and finance permissions only work after the person verifies with an authenticator app."
              name="mfa_required_for_sensitive"
              defaultChecked={settings.mfa_required_for_sensitive}
            />
            <CheckboxField label="Show work emails in the directory" name="directory_show_email" defaultChecked={settings.directory_show_email} />
            <div className="max-w-48">
              <TextField label="Invitation validity (days)" name="invitation_expiry_days" type="number" min={1} max={30} defaultValue={settings.invitation_expiry_days} required />
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Modules" description="Optional parts of the platform for this company." />
          <div className="space-y-4 p-4 sm:p-5">
            <CheckboxField
              label="Systems integration toolkit"
              hint="Adds Site & imports, cables and patch panels, devices, switches, VLANs and IPs, racks, lighting loads, Lutron integration, drawings and QR labels to every project. For AV, IT, security and lighting installers."
              name="site_toolkit_enabled"
              defaultChecked={settings.site_toolkit_enabled}
            />
          </div>
        </Panel>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>

      <AlertSettings orgId={org.id} people={people} settings={alertSettings ?? []} recipients={alertRecipients ?? []} current={current} emailReady={emailConfigured()} />

      <Panel className="mt-8">
        <PanelHeader title="Leave types" description="Allowance is days per calendar year. Leave it empty for types without a limit (e.g. sick leave)." />
        <ul className="divide-y divide-line">
          {(leaveTypes ?? []).map((t) => (
            <li key={t.id} className="px-4 py-3 sm:px-5">
              <details>
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="font-medium">{t.name}</span>
                  <span className="text-sm text-ink-muted">{t.annual_days !== null ? `${Number(t.annual_days)} days/year` : "no limit"}{t.paid ? "" : ", unpaid"}{t.active ? "" : ", inactive"}</span>
                </summary>
                <ActionForm action={saveLeaveType} className="mt-3 grid gap-3 sm:grid-cols-3">
                  <input type="hidden" name="organization_id" value={org.id} />
                  <input type="hidden" name="id" value={t.id} />
                  <TextField label="Name" name="name" required defaultValue={t.name} />
                  <TextField label="Days per year" name="annual_days" type="number" min={0} step="0.5" optional defaultValue={t.annual_days ?? ""} />
                  <TextField label="Colour" name="color" type="color" defaultValue={t.color} />
                  <CheckboxField label="Paid" name="paid" defaultChecked={t.paid} />
                  <CheckboxField label="Note required" name="requires_note" defaultChecked={t.requires_note} />
                  <CheckboxField label="Active" name="active" defaultChecked={t.active} />
                  <div className="sm:col-span-3"><SubmitButton size="sm" variant="secondary">Save</SubmitButton></div>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <ActionForm action={saveLeaveType} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 sm:p-5" resetOnSuccess>
          <input type="hidden" name="organization_id" value={org.id} />
          <TextField label="New leave type" name="name" required placeholder="Parental leave" />
          <TextField label="Days per year" name="annual_days" type="number" min={0} step="0.5" optional />
          <TextField label="Colour" name="color" type="color" defaultValue="#3a6ea5" />
          <CheckboxField label="Paid" name="paid" defaultChecked />
          <CheckboxField label="Note required" name="requires_note" />
          <div className="sm:col-span-3"><SubmitButton size="sm" variant="secondary">Add leave type</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Public holidays" description={`Excluded from leave day counts for ${org.name}.`} />
        <ul className="divide-y divide-line">
          {(holidays ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-2.5 text-sm sm:px-5">
              <span><span className="tabular">{h.holiday_date}</span> · {h.name}</span>
              <InlineActionForm action={deleteHoliday}>
                <input type="hidden" name="id" value={h.id} />
                <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
              </InlineActionForm>
            </li>
          ))}
          {!holidays?.length ? <li className="px-5 py-3 text-sm text-ink-muted">None added for this year.</li> : null}
        </ul>
        <ActionForm action={addHoliday} className="flex flex-wrap items-end gap-3 border-t border-line p-4 sm:p-5" resetOnSuccess>
          <input type="hidden" name="organization_id" value={org.id} />
          <TextField label="Date" name="holiday_date" type="date" required />
          <TextField label="Name" name="name" required placeholder="Christmas Day" />
          <SubmitButton size="sm" variant="secondary">Add holiday</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
