import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { staffingCompanies, tripDetail } from "@/server/services/staffing";
import { updateTravelRequest } from "@/server/actions/staffing";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { BookingList, ResendTravelButton, TravelBadge } from "@/components/staffing/trip-parts";
import { BookingForm, type BookingDraft } from "@/components/staffing/booking-form";
import { fmtRange, type BookingKind } from "@/lib/staffing";
import { addDays, dateOf, timeOf } from "@/lib/time";
import { groupedZones } from "@/lib/timezones";

export const metadata: Metadata = { title: "Travel request" };

/** One travel request: who, where and when, and the bookings the coordinators enter. */
export default async function TravelRequestPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { org: slug, id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const [me] = await staffingCompanies([{ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, timezone: ctx.org.timezone || "UTC" }]);
  const trip = await tripDetail({ requestId: id });
  if (!trip || !trip.request || trip.assignment.organizationId !== ctx.org.id) notFound();
  if (!me.canView) return <AccessDenied message="You can't see this travel request." hint="Your trip is on the assignment page linked from your calendar invite." />;
  const r = trip.request;
  const a = trip.assignment;
  const open = r.status !== "cancelled" && me.canTravel;
  const editing = sp.edit ? trip.bookings.find((b) => b.id === sp.edit) : undefined;
  const draft: BookingDraft | undefined = editing ? {
    id: editing.id, kind: editing.kind as BookingKind, title: editing.title, reference: editing.reference ?? "", from_place: editing.from_place ?? "", to_place: editing.to_place ?? "",
    address: editing.address ?? "", notes: editing.notes ?? "",
    start_date: dateOf(editing.starts_at, editing.start_tz), start_time: editing.all_day ? "" : timeOf(editing.starts_at, editing.start_tz), start_tz: editing.start_tz,
    end_date: editing.all_day ? addDays(dateOf(editing.ends_at, editing.start_tz), -1) : dateOf(editing.ends_at, editing.end_tz),
    end_time: editing.all_day ? "" : timeOf(editing.ends_at, editing.end_tz), end_tz: editing.end_tz,
  } : undefined;
  const base = `/o/${ctx.org.slug}/travel/${r.id}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href={`/o/${ctx.org.slug}/travel`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Travel</Link>
      <PageHeader title={`${trip.person.name} — ${trip.project.name}`} description={`On site ${fmtRange(a.start, a.end)} · ${ctx.org.name}`} actions={<span className="flex items-center gap-3">{me.canAssign && (r.status === "requested" || r.status === "in_progress") ? <ResendTravelButton assignmentId={a.id} /> : null}<TravelBadge status={r.status} /></span>} />
      {r.datesChangedFrom && r.status !== "cancelled" ? <Notice tone="warn" title="The dates of this trip changed">It was {r.datesChangedFrom}; it is now {fmtRange(a.start, a.end)}. Change or remove the bookings below to match, then set the status to “Booked — all done”.</Notice> : null}
      {r.status === "cancelled" ? <Notice tone="warn" title="This trip is cancelled">Cancel anything already booked with the airline or hotel. The bookings below were taken out of the traveller&apos;s calendar.</Notice> : null}
      <Panel className="grid gap-3 p-4 text-sm sm:grid-cols-3 sm:p-5">
        <p><span className="text-ink-muted">Traveller</span><br />{trip.person.name}{trip.person.jobTitle ? ` · ${trip.person.jobTitle}` : ""}</p>
        <p><span className="text-ink-muted">Travelling from</span><br />{r.travelFrom ?? "—"}</p>
        <p><span className="text-ink-muted">Site</span><br />{[trip.project.site, trip.project.country].filter(Boolean).join(", ") || "—"}</p>
        <p><span className="text-ink-muted">Requested</span><br />{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.profile.timezone }).format(new Date(r.requestedAt))}{r.requestedBy ? ` by ${r.requestedBy}` : ""}</p>
        {r.notes ? <p className="whitespace-pre-wrap sm:col-span-2"><span className="text-ink-muted">Notes</span><br />{r.notes}</p> : null}
        <p className="sm:col-span-3"><Link href={`/o/${ctx.org.slug}/staffing/${a.id}`} className="underline">Open the assignment</Link></p>
      </Panel>

      <Panel>
        <PanelHeader title="Bookings" description="Each one is in the traveller's Outlook calendar, with the confirmation attached." />
        <BookingList bookings={trip.bookings} slug={ctx.org.slug} editHref={open ? (bid) => `${base}?edit=${bid}#booking` : undefined} />
      </Panel>

      {open ? (
        <Panel id="booking">
          <PanelHeader title={draft ? "Change the booking" : "Add a booking"} description="Times are local: the departure in the departure city's time zone, the arrival in the arrival city's." action={draft ? <Link href={base} className="text-sm underline">Cancel editing</Link> : null} />
          <BookingForm key={draft?.id ?? "new"} requestId={r.id} draft={draft} defaultTz={ctx.org.timezone || "UTC"} defaultDate={addDays(a.start, -1)} zones={groupedZones()} />
        </Panel>
      ) : null}

      {open ? (
        <Panel>
          <PanelHeader title="Status" description="Mark it booked when everything is arranged; the traveller is notified." />
          <ActionForm action={updateTravelRequest} className="grid gap-3 p-4 sm:grid-cols-3">
            <input type="hidden" name="id" value={r.id} />
            <SelectField label="Status" name="status" defaultValue={r.status}>
              <option value="requested">Requested</option>
              <option value="in_progress">Being booked</option>
              <option value="booked">Booked — all done</option>
            </SelectField>
            <div className="sm:col-span-2"><TextAreaField label="Note for the traveller and the requester" name="coordinator_notes" optional maxLength={2000} defaultValue={r.coordinatorNotes ?? ""} className="min-h-16" /></div>
            <div className="sm:col-span-3"><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
