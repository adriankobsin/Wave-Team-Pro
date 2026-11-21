import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { staffingCompanies, travelRequests } from "@/server/services/staffing";
import { saveCoordinators } from "@/server/actions/staffing";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { ResendTravelButton, TravelBadge } from "@/components/staffing/trip-parts";
import { fmtRange } from "@/lib/staffing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Travel" };

/** Travel & accommodation requests for this company, and who handles them. */
export default async function TravelPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ all?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const [me] = await staffingCompanies([{ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, timezone: ctx.org.timezone || "UTC" }]);
  if (!me.canView) return <AccessDenied message="You can't see travel requests." hint="Ask a super admin to make you a travel coordinator or give you the staff calendar permission." />;
  const all = sp.all === "1";
  const supabase = await createClient();
  const [rows, people, { data: coord }] = await Promise.all([
    travelRequests(ctx.org.id, all),
    me.canSettings ? listPeople(ctx.org.id) : Promise.resolve([]),
    supabase.from("travel_coordinators").select("membership_id, is_lead").eq("organization_id", ctx.org.id),
  ]);
  const role = new Map((coord ?? []).map((c) => [c.membership_id as string, c.is_lead ? "lead" : "cc"]));
  const base = `/o/${ctx.org.slug}/travel`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel"
        description="Requests for flights, hotels and transfers when staff are sent to a project. Enter each booking on the request: it goes straight into the traveller's Outlook calendar."
        actions={<div className="flex gap-2 text-sm">
          <Link href={base} className={cn("rounded px-2 py-1", !all ? "bg-panel-sunk font-medium" : "text-ink-muted")}>Open</Link>
          <Link href={`${base}?all=1`} className={cn("rounded px-2 py-1", all ? "bg-panel-sunk font-medium" : "text-ink-muted")}>All</Link>
        </div>}
      />
      <Panel className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted">
              <th className="px-4 py-2 font-medium">Traveller</th><th className="px-4 py-2 font-medium">Project</th><th className="px-4 py-2 font-medium">Dates on site</th>
              <th className="px-4 py-2 font-medium">From</th><th className="px-4 py-2 font-medium">Bookings</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-panel-sunk/50">
                  <td className="px-4 py-2"><Link href={`${base}/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.person}</Link></td>
                  <td className="px-4 py-2">{r.project}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtRange(r.start, r.end)}</td>
                  <td className="px-4 py-2 text-ink-muted">{r.travelFrom ?? "—"}</td>
                  <td className="px-4 py-2 tabular">{r.bookings}</td>
                  <td className="px-4 py-2"><TravelBadge status={r.status} /></td>
                  <td className="px-4 py-2 text-right">{me.canAssign && (r.status === "requested" || r.status === "in_progress") ? <ResendTravelButton assignmentId={r.assignmentId} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title={all ? "No travel requests yet" : "No open travel requests"}>Requests appear here when someone is assigned to a project with “Needs travel &amp; accommodation” ticked.</EmptyState>}
      </Panel>

      <Panel>
        <PanelHeader
          title="Who handles travel"
          description={me.canSettings ? "“Gets the request” people receive the email; “Copied” people are copied in. Both can enter bookings." : "These people receive the travel request emails for this company."}
        />
        {me.canSettings ? (
          <ActionForm action={saveCoordinators} className="space-y-3 p-4">
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <div className="max-h-96 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-ink-muted"><th className="px-3 py-2 font-medium">Person</th><th className="px-3 py-2 text-center font-medium">Gets the request</th><th className="px-3 py-2 text-center font-medium">Copied</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {people.map((p) => (
                    <tr key={p.membershipId}>
                      <td className="px-3 py-1.5">{p.name}{p.jobTitle ? <span className="text-ink-muted"> · {p.jobTitle}</span> : null}</td>
                      <td className="px-3 py-1.5 text-center"><input type="checkbox" name="lead" value={p.membershipId} defaultChecked={role.get(p.membershipId) === "lead"} className="size-4 accent-brass" aria-label={`${p.name} gets the request`} /></td>
                      <td className="px-3 py-1.5 text-center"><input type="checkbox" name="cc" value={p.membershipId} defaultChecked={role.get(p.membershipId) === "cc"} className="size-4 accent-brass" aria-label={`${p.name} is copied`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        ) : (
          <CoordinatorNames orgId={ctx.org.id} />
        )}
      </Panel>
    </div>
  );
}

async function CoordinatorNames({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("travel_coordinators").select("membership_id, is_lead").eq("organization_id", orgId),
    listPeople(orgId),
  ]);
  const name = new Map(people.map((p) => [p.membershipId, p.name]));
  const list = (data ?? []).map((c) => `${name.get(c.membership_id as string) ?? "Someone"}${c.is_lead ? "" : " (copied)"}`);
  return <p className="p-4 text-sm">{list.length ? list.join(", ") : "Nobody is set yet."}</p>;
}
