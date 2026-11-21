import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";

export { DECKS, TEST_RESULT, ITEM_STATUS } from "@/lib/site-constants";
import { DECKS as DECK_NAMES, DEVICE_TYPES, MANUFACTURERS } from "@/lib/site-constants";
export const PAGE_SIZE = 100;

/** The project behind every site page, with what the viewer may do there. */
export const getSiteProject = cache(async (slug: string, id: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: project }, { data: canEdit }, { data: canLog }] = await Promise.all([
    supabase.from("projects").select("id, name, code, organization_id, status").eq("id", id).maybeSingle(),
    supabase.rpc("can_edit_project", { p_project: id }),
    supabase.rpc("can_log_on_project", { p_project: id }),
  ]);
  if (!project || project.organization_id !== ctx.org.id) notFound();
  return { ctx, project: project as { id: string; name: string; code: string | null }, canEdit: Boolean(canEdit), canLog: Boolean(canLog), base: `/o/${ctx.org.slug}/projects/${id}` };
});

/** Names for the people in a change history or a "tested by". */
export async function namesOf(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, string>();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", list);
  return new Map(((data ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
}

export type TeamMember = { id: string; name: string; job: string | null };
/** The project's team (and its project manager), for "Tested by": user id, name, job title. */
export async function projectTeam(projectId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const [{ data: pm }, { data: project }] = await Promise.all([
    supabase.from("project_members").select("membership_id").eq("project_id", projectId),
    supabase.from("projects").select("manager_membership_id").eq("id", projectId).maybeSingle(),
  ]);
  const ids = [...new Set([...(pm ?? []).map((m) => m.membership_id as string), project?.manager_membership_id as string | null].filter((x): x is string => Boolean(x)))];
  if (!ids.length) return [];
  const { data: ms } = await supabase.from("organization_memberships").select("user_id, job_title, status").in("id", ids);
  const active = (ms ?? []).filter((m) => m.status === "active");
  const names = await namesOf(active.map((m) => m.user_id as string));
  return active.map((m) => ({ id: m.user_id as string, name: names.get(m.user_id as string) ?? "Someone", job: (m.job_title as string | null) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type Change = { id: number; changes: Record<string, [unknown, unknown]>; changed_by: string | null; changed_at: string };
export async function changesOf(rowId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("site_changes").select("id, changes, changed_by, changed_at").eq("row_id", rowId).order("changed_at", { ascending: false }).limit(100);
  return (data ?? []) as Change[];
}

/** Team members of the project's company who can be named as "tested by". */
export async function projectPeople(orgId: string) {
  const people = await listPeople(orgId);
  return people.filter((p) => p.status === "active").map((p) => ({ userId: p.userId, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function siteCounts(projectId: string) {
  const supabase = await createClient();
  const count = (t: string, f?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const q = base(t);
    return (f ? f(q) : q).then((r) => r.count ?? 0);
  };
  function base(t: string) {
    return supabase.from(t).select("id", { count: "exact", head: true }).eq("project_id", projectId).is("archived_at", null);
  }
  const [devices, cables, cablesInUse, passed, failed, review, ports, vlans, lutron, zones, loads, loadsDone, drawings] = await Promise.all([
    count("site_devices"), count("site_cables"), count("site_cables", (q) => q.not("label", "is", null)),
    count("site_cables", (q) => q.eq("test_result", "passed")), count("site_cables", (q) => q.eq("test_result", "failed")),
    count("site_cables", (q) => q.in("test_result", ["needs_review", "retest"])),
    count("site_ports"), count("site_vlans"), count("lutron_items", (q) => q.eq("kind", "device")), count("lutron_items", (q) => q.eq("kind", "zone")),
    count("lighting_loads"), count("lighting_loads", (q) => q.in("status", ["commissioned", "tested"])), count("project_drawings", (q) => q.is("superseded_at", null)),
  ]);
  return { devices, cables, cablesInUse, passed, failed, review, ports, vlans, lutron, zones, loads, loadsDone, drawings };
}

/** Values offered while typing in the schedules: rooms, systems, types and brands already in this project. */
export async function siteSuggestions(projectId: string) {
  const supabase = await createClient();
  const [{ data: c }, { data: d }] = await Promise.all([
    supabase.from("site_cables").select("room, system, cable_type").eq("project_id", projectId).is("archived_at", null).limit(5000),
    supabase.from("site_devices").select("room, system, type, manufacturer").eq("project_id", projectId).is("archived_at", null).limit(5000),
  ]);
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
  return {
    "dl-decks": Object.entries(DECK_NAMES) as [string, string][],
    "dl-rooms": uniq([...(c ?? []).map((x) => x.room as string), ...(d ?? []).map((x) => x.room as string)]),
    "dl-systems": uniq([...(c ?? []).map((x) => x.system as string), ...(d ?? []).map((x) => x.system as string)]),
    "dl-cable-types": uniq(["CAT6A", "CAT6", "CAT7", "Fibre OM4", "Fibre OS2", "Coax", ...(c ?? []).map((x) => x.cable_type as string)]),
    "dl-types": uniq([...DEVICE_TYPES, ...(d ?? []).map((x) => x.type as string)]),
    "dl-manufacturers": uniq([...MANUFACTURERS, ...(d ?? []).map((x) => x.manufacturer as string)]),
  };
}
