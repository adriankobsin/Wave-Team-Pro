import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import Link from "@/components/ui/link";
import { getHub } from "@/server/services/hub";
import { platformLogoVersion, logoVersion } from "@/server/services/branding";
import { removePlatformLogo, uploadPlatformLogo } from "@/server/actions/branding";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Settings" };

/** Group Hub settings: the platform logo, and the way into each company's own settings. */
export default async function HubSettingsPage() {
  const hub = await getHub();
  if (!hub || !(hub.isPlatform || hub.companies.some((c) => c.can.settings))) redirect("/hub");
  const [v, companyLogos] = await Promise.all([platformLogoVersion(), Promise.all(hub.companies.map((c) => logoVersion(c.id)))]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description={`Platform-wide settings for ${BRAND.hub}.`} />

      <Panel>
        <PanelHeader title="Platform logo" description={`Shown at the top of ${BRAND.hub} on phone and computer. Each company can still have its own logo for its pages and reports.`} />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex h-24 items-center justify-center rounded-md border border-line bg-white p-3">
            {v ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/hub/logo?v=${v}`} alt={`Current ${BRAND.hub} logo`} className="max-h-full max-w-full object-contain" />
            ) : <span className="text-sm text-[#556770]">No logo yet</span>}
          </div>
          <ActionForm action={uploadPlatformLogo} className="space-y-3">
            <label className="block text-sm">
              <span className="font-medium">Upload a logo</span> <span className="text-ink-muted">(PNG, JPG, WebP or SVG — a wide logo on a transparent or white background works best)</span>
              <input type="file" name="logo" required accept="image/png,image/jpeg,image/webp,image/svg+xml" className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
            </label>
            <SubmitButton pendingLabel="Uploading…">Save logo</SubmitButton>
          </ActionForm>
          {v ? (
            <ActionForm action={removePlatformLogo}>
              <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">Remove logo</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Company settings" description="Each company's own logo (used on its pages and its PDF/Excel reports), time zone, currency and rules." />
        <ul className="divide-y divide-line">
          {hub.companies.map((c, i) => (
            <li key={c.id}>
              <Link href={`/o/${c.slug}/admin/settings`} className="flex items-center justify-between px-4 py-3 hover:bg-panel-sunk sm:px-5">
                <span>{c.name}<span className="block text-xs text-ink-muted">{c.location} · {companyLogos[i] ? "has a logo" : "no logo yet"}</span></span>
                <ChevronRight className="size-4 text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <Link href="/hub/outlook" className="flex items-center justify-between px-4 py-3 hover:bg-panel-sunk sm:px-5">
          <span>Outlook<span className="block text-xs text-ink-muted">Shared mailbox and automatic calendar invites</span></span>
          <ChevronRight className="size-4 text-ink-muted" aria-hidden />
        </Link>
      </Panel>

      <Panel>
        <PanelHeader title="Microsoft 365 projects" description="Project tasks, updates and dates in Planner, To Do and Outlook for each project's team (not PA or HR). Switch on and Sync now per company." />
        <ul className="divide-y divide-line">
          {hub.companies.filter((c) => c.can.settings).map((c) => (
            <li key={c.id}>
              <Link href={`/o/${c.slug}/admin/m365`} className="flex items-center justify-between px-4 py-3 hover:bg-panel-sunk sm:px-5">
                <span>{c.name}<span className="block text-xs text-ink-muted">{c.location}</span></span>
                <ChevronRight className="size-4 text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
