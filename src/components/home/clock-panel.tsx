import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyOrganizations } from "@/lib/auth/session";
import { clockAction } from "@/server/actions/workforce";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel } from "@/components/ui/misc";
import { timeOf, zoneCity } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";
import { BRAND } from "@/lib/brand";

type Status = { organization_id: string; organization_name: string; state: "in" | "break"; project_id: string | null; project_name: string | null; since: string };

/**
 * One clock for every company the person works for: choose company and project in one list.
 * Clocking in somewhere else clocks you out of the current company at the same moment.
 *
 * `hubHome`: for Group Hub users there is no company choice at all — one clock, recorded under their
 * home company, showing the same status on every page.
 */
export async function ClockPanel({ tz, orgId, shiftLine, hubHome }: { tz: string; orgId?: string; shiftLine: string; hubHome?: { id: string } | null }) {
  const supabase = await createClient();
  // Group Hub: the same one clock, but the company and project must be chosen on purpose.
  const hub = Boolean(hubHome);
  const orgs = (await getMyOrganizations()).filter((o) => o.membership_status === "active" && o.organization_status === "active");
  const allowed = await Promise.all(orgs.map((o) => supabase.rpc("has_permission", { p_org: o.organization_id, p_permission: "attendance.view.self" })));
  const companies = orgs.filter((_, i) => allowed[i].data === true).sort((a, b) => (a.organization_id === orgId ? -1 : b.organization_id === orgId ? 1 : a.name.localeCompare(b.name)));
  if (!companies.length) return null;

  const [{ data: statusRows }, { data: projects }, { data: assignments }] = await Promise.all([
    supabase.rpc("my_clock_status"),
    supabase.from("projects").select("id, name, code, organization_id").in("organization_id", companies.map((c) => c.organization_id)).in("status", ["planning", "active", "on_hold"]).order("name"),
    supabase.rpc("my_assignments"),
  ]);
  // Basic staff don't pick projects: they clock in to the company, and the project their manager
  // assigned (today's shift or their standing assignment) is filled in.
  const assigned = new Map(((assignments ?? []) as { organization_id: string; project_name: string | null; can_choose: boolean }[]).map((a) => [a.organization_id, a]));
  const canChoose = (org: string) => assigned.get(org)?.can_choose === true;
  const current = ((statusRows ?? []) as Status[])[0] ?? null;
  // The time shown is local time where the project is (Bangkok for a Thailand project, and so on).
  let clockTz = tz;
  if (current) {
    const zones = await projectZones(supabase, [current.project_id]);
    const own = current.project_id ? zones.get(current.project_id) : undefined;
    if (own) clockTz = own;
    else {
      const { data: o } = await supabase.from("organizations").select("timezone").eq("id", current.organization_id).maybeSingle();
      if (o?.timezone) clockTz = o.timezone as string;
    }
  }
  const byOrg = new Map<string, { id: string; label: string }[]>();
  for (const p of (projects ?? []) as { id: string; name: string; code: string | null; organization_id: string }[]) {
    if (!canChoose(p.organization_id)) continue;
    byOrg.set(p.organization_id, [...(byOrg.get(p.organization_id) ?? []), { id: p.id, label: p.code ? `${p.code} · ${p.name}` : p.name }]);
  }
  const several = companies.length > 1;
  const options = (withoutProject: boolean) =>
    companies.map((c) => (
      <optgroup key={c.organization_id} label={c.name}>
        {withoutProject || !canChoose(c.organization_id) ? (
          <option value={`${c.organization_id}|`}>
            {canChoose(c.organization_id)
              ? (several ? `${c.name} — no project` : "No project")
              : `${c.name}${assigned.get(c.organization_id)?.project_name ? ` — ${assigned.get(c.organization_id)!.project_name}` : ""}`}
          </option>
        ) : null}
        {(byOrg.get(c.organization_id) ?? []).map((p) => <option key={p.id} value={`${c.organization_id}|${p.id}`}>{p.label}</option>)}
      </optgroup>
    ));
  const anyProjects = [...byOrg.values()].some((l) => l.length > 0);
  const here = assigned.get(companies[0].organization_id);
  const select = "h-9 max-w-72 rounded-md border border-line bg-panel px-2 text-sm";

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Clock className="size-4" aria-hidden /> {hub ? `${BRAND.hub} clock` : "Today"}</p>
          <p className="mt-1 font-semibold">
            {!current ? "You’re not clocked in" : current.state === "break" ? "You’re on a break" : "You’re clocked in"}
            {current ? (
              <span className="font-normal text-ink-muted">
                {" "}· {several ? current.organization_name : null}{several && current.project_name ? " · " : ""}{current.project_name ?? ""} since {timeOf(current.since, clockTz)} <span className="text-xs">({zoneCity(clockTz)} time)</span>
              </span>
            ) : null}
          </p>
          <p className="text-sm text-ink-muted">{shiftLine}</p>
          {!current && !several && here && !here.can_choose ? (
            <p className="text-sm text-ink-muted">{here.project_name ? `Project: ${here.project_name}` : "No project assigned"}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {!current ? (
            <ActionForm action={clockAction} hideMessage className="flex flex-wrap items-center justify-end gap-2">
              <input type="hidden" name="organization_id" value={companies[0].organization_id} />
              {hub ? <input type="hidden" name="require_target" value="1" /> : null}
              {several || anyProjects || hub ? (
                <select name="target" aria-label="Company and project" defaultValue={hub ? "" : `${companies[0].organization_id}|`} required={hub} className={select}>
                  {hub ? <option value="" disabled>Choose company and project…</option> : null}
                  {options(true)}
                </select>
              ) : null}
              <SubmitButton name="kind" value="clock_in" pendingLabel="…">Clock in</SubmitButton>
            </ActionForm>
          ) : (
            <>
              <ActionForm action={clockAction} hideMessage className="flex flex-wrap items-center justify-end gap-2">
                <input type="hidden" name="organization_id" value={current.organization_id} />
                {current.state === "in"
                  ? <SubmitButton name="kind" value="break_start" variant="secondary" pendingLabel="…">Break</SubmitButton>
                  : <SubmitButton name="kind" value="break_end" variant="secondary" pendingLabel="…">End break</SubmitButton>}
                <SubmitButton name="kind" value="clock_out" pendingLabel="…">Clock out</SubmitButton>
              </ActionForm>
              {several || anyProjects ? (
                <ActionForm action={clockAction} hideMessage className="flex flex-wrap items-center justify-end gap-2">
                  <input type="hidden" name="organization_id" value={current.organization_id} />
                  <select name="target" aria-label="Switch to" defaultValue="" required className={`${select} h-8 text-xs`}>
                    <option value="" disabled>{several ? "Switch company or project…" : "Switch project…"}</option>
                    {options(several)}
                  </select>
                  <SubmitButton name="kind" value="switch" size="sm" variant="secondary" pendingLabel="…">Switch</SubmitButton>
                </ActionForm>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

