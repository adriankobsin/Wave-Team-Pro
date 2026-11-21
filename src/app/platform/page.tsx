import type { Metadata } from "next";
import { CountrySelect, CurrencySelect } from "@/components/ui/region-select";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "@/server/actions/organization";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel, PanelHeader, PageHeader } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Provision organizations" };

export default async function PlatformPage() {
  await requireActiveProfile();
  const supabase = await createClient();
  const { data: isPlatform } = await supabase.rpc("is_platform_admin");
  if (!isPlatform) redirect("/");
  const { data: orgs } = await supabase.from("organizations").select("id, name, slug, country, base_currency, created_at").order("created_at", { ascending: false });

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader
        title="Provision organizations"
        description="Create a legal entity and invite its first Super Admin. Platform owners can't see employee data, messages or files inside organizations."
        actions={<Link href="/onboarding" className="text-sm underline underline-offset-4">Back</Link>}
      />
      <Panel>
        <PanelHeader title="New organization" />
        <ActionForm action={createOrganization} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5" resetOnSuccess>
          <TextField label="Legal entity name" name="name" required placeholder={`${BRAND.exampleCompany} Ltd`} />
          <TextField label="Web address" name="slug" required placeholder="acme-uk" hint="Used in links: /o/acme-uk" pattern="[a-z0-9-]+" />
          <TextField label="Entity code" name="legal_entity_code" optional placeholder="Company registration no." />
          <CountrySelect label="Country" name="country" required hint="Sets the VAT/GST rates the company starts with" />
          <CurrencySelect label="Base currency" name="base_currency" required defaultValue="GBP" hint="Reporting currency (Cambodia usually USD)" />
          <TextField label="Time zone" name="timezone" required placeholder="Europe/London" />
          <TextField label="First Super Admin email" name="admin_email" type="email" required />
          <TextField label="Their name" name="admin_name" optional />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Creating…">Create organization and send invitation</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
      <Panel className="mt-6">
        <PanelHeader title="Organizations you created" />
        <ul className="divide-y divide-line">
          {(orgs ?? []).map((o) => (
            <li key={o.id} className="flex justify-between gap-3 px-4 py-3 text-sm sm:px-5">
              <span className="font-medium">{o.name}</span>
              <span className="text-ink-muted tabular">/o/{o.slug}, {o.country}, {o.base_currency}</span>
            </li>
          ))}
          {!orgs?.length ? <li className="px-5 py-6 text-sm text-ink-muted">None yet.</li> : null}
        </ul>
      </Panel>
    </main>
  );
}
