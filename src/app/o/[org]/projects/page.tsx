import type { Metadata } from "next";
import { CountrySelect, CurrencySelect } from "@/components/ui/region-select";
import { countryName } from "@/lib/regions";
import { getHub } from "@/server/services/hub";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { getStructure, listPeople } from "@/server/services/people";
import { saveProject } from "@/server/actions/projects";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ZoneSelect } from "@/components/ui/zone-select";
import { SubmitButton } from "@/components/ui/submit-button";
import { PersonLabel } from "@/components/ui/avatar";
import { PROJECT_STATUS, PROJECT_TONE as TONE } from "@/components/projects/task-card";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Projects" };


export default async function ProjectsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ show?: string }> }) {
  const { org: slug } = await params;
  const { show } = await searchParams;
  const ctx = await getOrgContext(slug);
  // Everyone sees the projects they're on (row-level security); managers see the company's projects.
  const supabase = await createClient();
  const all = show === "all";
  let q = supabase.from("projects").select("id, code, name, site_label, country, status, manager_membership_id, end_date, team_id").eq("organization_id", ctx.org.id).is("archived_at", null).order("name");
  if (!all) q = q.in("status", ["planning", "active", "on_hold"]);
  const [{ data: projects }, people, structure, { data: openTasks }] = await Promise.all([
    q,
    listPeople(ctx.org.id),
    getStructure(ctx.org.id),
    supabase.from("tasks").select("project_id, status").eq("organization_id", ctx.org.id).not("project_id", "is", null).is("archived_at", null),
  ]);
  const byMembership = new Map(people.map((p) => [p.membershipId, p]));
  const canCreate = ctx.perms.hasAnyScope("projects.create");
  const hub = canCreate ? await getHub() : null;
  const base = `/o/${ctx.org.slug}/projects`;
  const progress = (id: string) => {
    const ts = (openTasks ?? []).filter((t) => t.project_id === id);
    return { total: ts.length, done: ts.filter((t) => t.status === "done").length };
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="Internal workspaces for jobs, refits and installations." actions={<Link href={all ? base : `${base}?show=all`} className="text-sm underline">{all ? "Hide finished" : "Show finished"}</Link>} />
      <div className={canCreate ? "grid gap-6 lg:grid-cols-[1.6fr_1fr]" : ""}>
        <Panel>
          {projects?.length ? (
            <ul className="divide-y divide-line">
              {projects.map((p) => {
                const pr = progress(p.id);
                const mgr = p.manager_membership_id ? byMembership.get(p.manager_membership_id) : undefined;
                return (
                  <li key={p.id}>
                    <Link href={`${base}/${p.id}`} className="block px-4 py-3.5 hover:bg-panel-sunk sm:px-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{p.code ? <span className="mr-1.5 text-ink-muted tabular">{p.code}</span> : null}{p.name}</p>
                          {p.site_label || p.country ? <p className="text-sm text-ink-muted">{[p.site_label, p.country ? countryName(p.country) : null].filter(Boolean).join(" · ")}</p> : null}
                        </div>
                        <Badge tone={TONE[p.status as keyof typeof TONE]}>{PROJECT_STATUS[p.status as keyof typeof PROJECT_STATUS]}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                        {mgr ? <PersonLabel id={mgr.userId} name={mgr.name} src={mgr.avatarUrl} size="xs" /> : null}
                        {pr.total ? (
                          <span className="flex items-center gap-2 text-ink-muted">
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-panel-sunk"><span className="block h-full bg-ok" style={{ width: `${Math.round((pr.done / pr.total) * 100)}%` }} /></span>
                            <span className="tabular">{pr.done}/{pr.total} tasks</span>
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No projects yet">{canCreate ? "Create the first one." : "Projects you're part of will appear here."}</EmptyState>
          )}
        </Panel>
        {canCreate ? (
          <Panel className="h-fit">
            <PanelHeader title="New project" description={hub ? <>For {ctx.org.name}. To pick another company or people from across the group, use <Link className="underline" href="/hub/projects?new=1">{BRAND.hub} → Projects</Link>.</> : undefined} />
            <ActionForm action={saveProject} className="grid gap-3 p-4">
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="org_slug" value={ctx.org.slug} />
              <TextField label="Name" name="name" required maxLength={120} placeholder="MY Aurora AV/IT refit" />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Code" name="code" optional maxLength={32} placeholder="P-2026-014" />
                <TextField label="Cost centre" name="cost_center" optional maxLength={64} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Site / location" name="site_label" optional maxLength={160} placeholder="Port Vauban, Antibes" />
                <CountrySelect label="Country" name="country" optional defaultValue={ctx.org.country} />
              </div>
              <ZoneSelect defaultValue={ctx.org.timezone} hint="Clock-ins on this project show in this time zone." />
              <SelectField label="Project manager" name="manager_membership_id" optional defaultValue={ctx.membership.id}>
                <option value="">—</option>
                {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
              </SelectField>
              <SelectField label="Team" name="team_id" optional defaultValue="">
                <option value="">—</option>
                {structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Start" name="start_date" type="date" optional />
                <TextField label="End" name="end_date" type="date" optional />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TextField label="Budget hours" name="budget_hours" type="number" min={0} step="0.5" optional />
                <TextField label="Budget" name="budget_amount" type="number" min={0} step="0.01" optional />
                <CurrencySelect label="Currency" name="budget_currency" optional defaultValue={ctx.org.base_currency} />
              </div>
              <TextAreaField label="Description" name="description" optional rows={3} maxLength={4000} />
              <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
            </ActionForm>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
