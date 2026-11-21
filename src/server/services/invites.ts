import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import type { ComposerCompany, ComposerPerson, ComposerProject } from "@/components/invites/composer";

/** Companies (of those given) where the viewer may send invites. */
export async function inviteCompanies(companies: { id: string; name: string; timezone: string }[]): Promise<ComposerCompany[]> {
  const supabase = await createClient();
  const ok = await Promise.all(companies.map((c) => supabase.rpc("has_permission", { p_org: c.id, p_permission: "invites.send" })));
  return companies.filter((_, i) => ok[i].data === true);
}

/** People and open projects in those companies, for the "who is it for" lists. */
export async function composerData(companies: ComposerCompany[]): Promise<{ people: ComposerPerson[]; projects: ComposerProject[] }> {
  const supabase = await createClient();
  const [lists, { data: projects }] = await Promise.all([
    Promise.all(companies.map(async (c) => ({ c, people: await listPeople(c.id) }))),
    supabase.from("projects").select("id, name, code, organization_id").in("organization_id", companies.map((c) => c.id)).in("status", ["planning", "active", "on_hold"]).is("archived_at", null).order("name"),
  ]);
  const byUser = new Map<string, ComposerPerson>();
  for (const { c, people } of lists) for (const p of people) {
    if (p.status !== "active") continue;
    const row = byUser.get(p.userId) ?? { userId: p.userId, name: p.name, jobTitle: p.jobTitle, companies: [] };
    row.companies.push(c.name);
    byUser.set(p.userId, row);
  }
  const name = new Map(companies.map((c) => [c.id, c.name]));
  return {
    people: [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
    projects: (projects ?? []).map((p) => ({ id: p.id as string, name: p.code ? `${p.code} · ${p.name}` : (p.name as string), company: name.get(p.organization_id as string) ?? "" })),
  };
}

export type BroadcastRow = {
  id: string; organization_id: string; kind: "invite" | "update"; category: string; title: string; body: string | null; location: string | null;
  starts_at: string | null; ends_at: string | null; all_day: boolean; time_zone: string; audience: string | null;
  attendee_user_ids: string[]; attendee_emails: string[]; created_by: string; created_at: string;
  signature: string | null; attachments: { path: string; name: string; mime: string; size: number }[];
  outlook: { status: string; last_error: string | null } | null;
};

/** Invites and updates: everything sent in these companies (senders), or what was sent to me. */
export async function listBroadcasts(opts: { orgIds?: string[]; toUser?: string; limit?: number }): Promise<BroadcastRow[]> {
  const supabase = await createClient();
  let q = supabase.from("calendar_broadcasts").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  // Staff calendar and travel rows have their own pages; the senders' list shows communications.
  if (opts.orgIds) q = q.in("organization_id", opts.orgIds).is("source", null);
  if (opts.toUser) q = q.contains("attendee_user_ids", [opts.toUser]);
  const { data } = await q;
  const rows = (data ?? []) as Omit<BroadcastRow, "outlook">[];
  const { data: sync } = rows.length ? await supabase.from("calendar_sync").select("ref_id, status, last_error").eq("kind", "manual").in("ref_id", rows.map((r) => r.id)) : { data: [] };
  const s = new Map((sync ?? []).map((x) => [x.ref_id as string, { status: x.status as string, last_error: (x.last_error as string) ?? null }]));
  return rows.map((r) => ({ ...r, outlook: s.get(r.id) ?? null }));
}

export const CATEGORY_LABEL: Record<string, string> = { travel: "Travel", company: "Company update", project: "Project update", meeting: "Meeting", other: "Other" };

export function whenLabel(b: Pick<BroadcastRow, "starts_at" | "ends_at" | "all_day" | "time_zone">, viewerTz: string) {
  if (!b.starts_at) return null;
  const tz = b.all_day ? b.time_zone : viewerTz;
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", ...(b.all_day ? {} : { hour: "2-digit", minute: "2-digit" }), timeZone: tz });
  const end = b.ends_at ? new Date(b.all_day ? Date.parse(b.ends_at) - 1 : Date.parse(b.ends_at)) : null;
  const a = fmt.format(new Date(b.starts_at));
  const z = end ? fmt.format(end) : null;
  return z && z !== a ? `${a} – ${z}` : a;
}

/** The signed-in person's saved email signature. */
export async function mySignature(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("email_signatures").select("signature").maybeSingle();
  return ((data?.signature as string | undefined) ?? "").trim() || null;
}
