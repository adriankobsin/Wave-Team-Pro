import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHub, groupPeople } from "@/server/services/hub";
import { createGroupProject } from "@/server/actions/projects";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ZoneSelect } from "@/components/ui/zone-select";
import { CountrySelect } from "@/components/ui/region-select";
import { SubmitButton } from "@/components/ui/submit-button";
import { countryName } from "@/lib/regions";
import { PROJECT_STATUS, PROJECT_TONE } from "@/components/projects/task-card";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Projects" };

type Row = { id: string; organization_id: string; code: string | null; name: string; site_label: string | null; country: string | null; status: keyof typeof PROJECT_STATUS; start_date: string | null; end_date: string | null };

export default async function HubProjectsPage({ searchParams }: { searchParams: Promise<{ company?: string; status?: string; q?: string; new?: string }> }) {
  const sp = await searchParams;
  const hub = await getHub();
  if (!hub) redirect("/");
  const supabase = await createClient();
  const company = hub.companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const status = sp.status === "all" || (sp.status && sp.status in PROJECT_STATUS) ? sp.status : "open";
  let q = supabase.from("projects").select("id, organization_id, code, name, site_label, country, status, start_date, end_date")
    .in("organization_id", company ? [company] : hub.companies.map((c) => c.id)).is("archived_at", null).order("name");
  if (status === "open") q = q.in("status", ["planning", "active", "on_hold"]);
  else if (status !== "all") q = q.eq("status", status!);
  const [{ data }, people] = await Promise.all([q, groupPeople(hub.companies)]);
  const text = (sp.q ?? "").trim().toLowerCase();
  const rows = ((data ?? []) as Row[]).filter((p) => !text || `${p.name} ${p.code ?? ""} ${p.site_label ?? ""} ${p.country ? countryName(p.country) : ""}`.toLowerCase().includes(text));
  const byId = new Map(hub.companies.map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Every company's projects. Create one in any company and staff it from the whole group; edit or move existing ones."
        actions={<Link className={buttonClass()} href="?new=1">New project</Link>}
      />
      <Panel>
        <details open={sp.new === "1"}>
          <summary className="cursor-pointer px-4 py-3 font-semibold sm:px-5">New project</summary>
          <ActionForm action={createGroupProject} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 sm:p-5">
            <SelectField label="Company" name="organization_id" required defaultValue={company || ""} hint="The company that runs and invoices this project.">
              <option value="" disabled>Choose</option>
              {hub.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.location})</option>)}
            </SelectField>
            <TextField label="Project name" name="name" required maxLength={120} placeholder="MY Aurora AV/IT refit" />
            <TextField label="Code" name="code" optional maxLength={32} />
            <SelectField label="Status" name="status" defaultValue="active">
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectField>
            <TextField label="Site / location" name="site_label" optional maxLength={160} placeholder="Port Vauban, Antibes" />
            <CountrySelect label="Country" name="country" optional />
            <ZoneSelect hint="Clock-ins on this project show in this time zone." />
            <TextField label="Start" name="start_date" type="date" optional />
            <TextField label="End" name="end_date" type="date" optional />
            <SelectField label="Project manager" name="manager_user" optional defaultValue="">
              <option value="">—</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ""}</option>)}
            </SelectField>
            <div className="sm:col-span-2"><TextAreaField label="Description" name="description" optional rows={2} maxLength={4000} /></div>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">People on this project</legend>
              <p className="text-xs text-ink-muted">Anyone in the group. People not in the chosen company yet are added to it as Employee.</p>
              <div className="mt-1.5 grid max-h-64 gap-1.5 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                {people.map((p) => (
                  <label key={p.userId} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="members" value={p.userId} className="mt-0.5 size-4" />
                    <span>{p.name}<span className="block text-xs text-ink-muted">{[p.jobTitle, p.companies.map((c) => c.name).join(", ")].filter(Boolean).join(" · ")}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2"><SubmitButton pendingLabel="Creating…">Create project</SubmitButton></div>
          </ActionForm>
        </details>
      </Panel>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, site, country" className="mt-1 block h-9 w-48 rounded-md border border-line bg-panel px-2" />
        </label>
        <label className="text-sm">Company
          <select name="company" defaultValue={company} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">All companies</option>
            {hub.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Status
          <select name="status" defaultValue={status} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="open">Open (planning, active, on hold)</option>
            <option value="all">All</option>
            {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary")}>Show</button>
      </form>

      <Panel className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Site / country</th>
                <th className="px-2 py-2 font-medium">Dates</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const c = byId.get(p.organization_id)!;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/o/${c.slug}/projects/${p.id}`} className="font-medium hover:underline">{p.code ? <span className="mr-1.5 text-ink-muted">{p.code}</span> : null}{p.name}</Link>
                    </td>
                    <td className="px-2 py-2">{c.name}<span className="block text-xs text-ink-muted">{c.location}</span></td>
                    <td className="px-2 py-2 text-ink-muted">{[p.site_label, p.country ? countryName(p.country) : null].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="tabular px-2 py-2 text-ink-muted">{p.start_date || p.end_date ? `${p.start_date ?? "…"} → ${p.end_date ?? "…"}` : "—"}</td>
                    <td className="px-2 py-2"><Badge tone={PROJECT_TONE[p.status]}>{PROJECT_STATUS[p.status]}</Badge></td>
                    <td className="px-4 py-2 text-right">
                      <Link className={buttonClass("secondary", "sm")} href={`/o/${c.slug}/projects/${p.id}?edit=1#edit`}>Edit or move</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <EmptyState title="No projects match" />}
      </Panel>

    </div>
  );
}
