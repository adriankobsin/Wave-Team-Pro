import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { staffingCompanies, tripDetail } from "@/server/services/staffing";
import { cancelAssignment, updateAssignment } from "@/server/actions/staffing";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BookingList, OutlookState, ResendTravelButton, TravelBadge } from "@/components/staffing/trip-parts";
import { fmtRange } from "@/lib/staffing";

export const metadata: Metadata = { title: "Assignment" };

/** One person on one project: dates, notes, the Outlook invite and the travel that goes with it. */
export default async function AssignmentPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const trip = await tripDetail({ assignmentId: id });
  if (!trip || trip.assignment.organizationId !== ctx.org.id) notFound();
  const [me] = await staffingCompanies([{ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, timezone: ctx.org.timezone || "UTC" }]);
  const a = trip.assignment;
  const canEdit = me.canAssign && !a.cancelled;
  const r = trip.request;
  const others = trip.trip.filter((m) => m.assignmentId !== a.id);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {me.canView ? <Link href={`/o/${ctx.org.slug}/staffing?month=${a.start.slice(0, 7)}`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Staff calendar</Link> : null}
      <PageHeader
        title={`${trip.person.name} — ${trip.project.name}`}
        description={`${fmtRange(a.start, a.end)} · ${ctx.org.name}`}
        actions={a.cancelled ? <Badge tone="danger">Cancelled</Badge> : r ? <TravelBadge status={r.status} /> : null}
      />
      <Panel className="grid gap-3 p-4 text-sm sm:grid-cols-2 sm:p-5">
        <p><span className="text-ink-muted">Person</span><br />{trip.person.name}{trip.person.jobTitle ? ` · ${trip.person.jobTitle}` : ""}</p>
        <p><span className="text-ink-muted">Project</span><br /><Link href={`/o/${ctx.org.slug}/projects/${trip.project.id}`} className="underline">{trip.project.name}</Link></p>
        <p><span className="text-ink-muted">Dates</span><br />{fmtRange(a.start, a.end)}</p>
        <p><span className="text-ink-muted">Site</span><br />{[trip.project.site, trip.project.country].filter(Boolean).join(", ") || "—"}</p>
        {a.notes ? <p className="whitespace-pre-wrap sm:col-span-2"><span className="text-ink-muted">Notes</span><br />{a.notes}</p> : null}
        {others.length ? <p className="sm:col-span-2"><span className="text-ink-muted">On this trip with</span><br />{others.map((m, i) => <span key={m.assignmentId}>{i ? ", " : ""}<Link href={`/o/${ctx.org.slug}/staffing/${m.assignmentId}`} className="underline">{m.name}</Link></span>)}</p> : null}
        <p className="sm:col-span-2"><span className="text-ink-muted">Calendar invite</span><br />{trip.person.email ? <>{trip.person.email} · <OutlookState status={trip.invite} /></> : "This person has no email address, so no Outlook invite was sent."}</p>
      </Panel>

      {r ? (
        <Panel>
          <PanelHeader
            title="Travel & accommodation"
            description={`Requested ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: ctx.profile.timezone }).format(new Date(r.requestedAt))}${r.requestedBy ? ` by ${r.requestedBy}` : ""}${r.travelFrom ? ` · from ${r.travelFrom}` : ""}`}
            action={
              <span className="flex flex-wrap items-center gap-3">
                {(me.canAssign || me.canTravel) && (r.status === "requested" || r.status === "in_progress") ? <ResendTravelButton assignmentId={a.id} /> : null}
                {me.canTravel && r.status !== "cancelled" ? <Link href={`/o/${ctx.org.slug}/travel/${r.id}`} className="text-sm font-medium underline">Enter bookings</Link> : null}
              </span>
            }
          />
          {r.notes ? <p className="whitespace-pre-wrap px-4 pt-3 text-sm text-ink-muted">{r.notes}</p> : null}
          {r.coordinatorNotes ? <p className="whitespace-pre-wrap px-4 pt-3 text-sm"><span className="text-ink-muted">From the travel team:</span> {r.coordinatorNotes}</p> : null}
          <BookingList bookings={trip.bookings} slug={ctx.org.slug} />
        </Panel>
      ) : null}

      {canEdit ? (
        <Panel>
          <PanelHeader title="Change" description="Outlook invites are updated. When travel was requested, the travel team, the travellers and the requester are emailed about new dates or a cancellation, with the bookings that need changing." />
          <ActionForm action={updateAssignment} className="grid gap-3 p-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={a.id} />
            {others.length ? (
              <fieldset className="space-y-1.5 rounded-md border border-line p-3 text-sm sm:col-span-2">
                <legend className="px-1 font-medium">Apply the change to</legend>
                <label className="flex items-center gap-2"><input type="radio" name="scope" value="trip" defaultChecked className="size-4 accent-brass" />Everyone on this trip ({trip.trip.length} people: {trip.trip.map((m) => m.name).join(", ")})</label>
                <label className="flex items-center gap-2"><input type="radio" name="scope" value="one" className="size-4 accent-brass" />Only {trip.person.name}</label>
              </fieldset>
            ) : null}
            <TextField label="First day" name="start_date" type="date" required defaultValue={a.start} />
            <TextField label="Last day" name="end_date" type="date" required defaultValue={a.end} />
            <div className="sm:col-span-2"><TextAreaField label="Notes for the staff" name="notes" optional maxLength={1000} defaultValue={a.notes ?? ""} className="min-h-16" /></div>
            <div className="sm:col-span-2"><CheckboxField label="Needs travel & accommodation" name="needs_travel" defaultChecked={Boolean(r && r.status !== "cancelled")} hint="Unticking cancels the request and every booking, and tells the coordinators." /></div>
            <TextField label="Travelling from" name="travel_from" optional maxLength={200} defaultValue={r?.travelFrom ?? ""} />
            <TextField label="Notes for the coordinators" name="travel_notes" optional maxLength={2000} defaultValue={r?.notes ?? ""} />
            <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save changes</SubmitButton></div>
          </ActionForm>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line p-4">
            <InlineActionForm action={cancelAssignment} confirm={`Take ${trip.person.name} off ${trip.project.name}? The Outlook invite is cancelled${r && r.status !== "cancelled" ? ", the travel and bookings are cancelled, and the travel team, traveller and requester are emailed" : ""}.`}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="scope" value="one" />
              <button type="submit" className="text-sm font-medium text-danger underline">{others.length ? `Remove only ${trip.person.name}` : "Remove from the project"}</button>
            </InlineActionForm>
            {others.length ? (
              <InlineActionForm action={cancelAssignment} confirm={`Cancel the whole trip (${trip.trip.length} people)? Every Outlook invite, travel request and booking is cancelled, and everyone on it is emailed.`}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="scope" value="trip" />
                <button type="submit" className="text-sm font-medium text-danger underline">Cancel the whole trip ({trip.trip.length} people)</button>
              </InlineActionForm>
            ) : null}
          </div>
        </Panel>
      ) : a.cancelled ? <Notice tone="neutral" title="This assignment was cancelled">It no longer shows on the calendar and the Outlook invite was withdrawn.</Notice> : null}
    </div>
  );
}
