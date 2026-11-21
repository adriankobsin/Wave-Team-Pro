import Link from "@/components/ui/link";
import { BedDouble, Car, Paperclip, Plane, TrainFront } from "lucide-react";
import { InlineActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/misc";
import { cancelBooking, resendTravelRequest } from "@/server/actions/staffing";
import { BOOKING_KINDS, TRAVEL_LABEL, type BookingKind, type TravelStatus } from "@/lib/staffing";
import type { BookingRow } from "@/server/services/staffing";
import { dateOf, timeOf, addDays } from "@/lib/time";

const day = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

export function TravelBadge({ status }: { status: TravelStatus }) {
  return <Badge tone={status === "booked" ? "ok" : status === "cancelled" ? "neutral" : "warn"}>{TRAVEL_LABEL[status]}</Badge>;
}

export function OutlookState({ status }: { status: string | null }) {
  if (!status) return null;
  const text = status === "synced" ? "In Outlook" : status === "failed" ? "Outlook: failed, retrying" : status === "skipped" ? "Not sent to Outlook" : "Sending to Outlook…";
  return <span className={status === "failed" ? "text-xs text-danger" : "text-xs text-ink-muted"}>{text}</span>;
}

function Icon({ kind }: { kind: string }) {
  const I = kind === "hotel" ? BedDouble : kind === "train" ? TrainFront : kind === "car" || kind === "transfer" ? Car : Plane;
  return <I className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />;
}

export function whenOf(b: BookingRow) {
  if (b.all_day) return `Check-in ${day(dateOf(b.starts_at, b.start_tz))} · check-out ${day(addDays(dateOf(b.ends_at, b.start_tz), -1))}`;
  const a = `${day(dateOf(b.starts_at, b.start_tz))} ${timeOf(b.starts_at, b.start_tz)} (${city(b.start_tz)})`;
  const z = `${dateOf(b.ends_at, b.end_tz) === dateOf(b.starts_at, b.start_tz) ? "" : `${day(dateOf(b.ends_at, b.end_tz))} `}${timeOf(b.ends_at, b.end_tz)} (${city(b.end_tz)})`;
  return `${a} → ${z}`;
}

/** The bookings of a trip, with confirmations to download and (for coordinators) edit/remove. */
export function BookingList({ bookings, slug, editHref }: { bookings: BookingRow[]; slug: string; editHref?: (id: string) => string }) {
  if (!bookings.length) return <p className="p-4 text-sm text-ink-muted">No bookings yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {bookings.map((b) => (
        <li key={b.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
          <Icon kind={b.kind} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-medium">{BOOKING_KINDS[b.kind as BookingKind] ?? b.kind}: {b.title}{b.from_place && b.to_place ? ` · ${b.from_place} → ${b.to_place}` : ""}</p>
            <p className="text-ink-muted">{whenOf(b)}</p>
            {b.reference ? <p>Reference <span className="font-mono">{b.reference}</span></p> : null}
            {b.address ? <p className="text-ink-muted">{b.address}</p> : null}
            {b.notes ? <p className="whitespace-pre-wrap text-ink-muted">{b.notes}</p> : null}
            {b.attachments.length ? (
              <p className="flex flex-wrap gap-3">
                {b.attachments.map((f, i) => <a key={i} href={`/o/${slug}/travel/files/${b.id}/${i}`} className="inline-flex items-center gap-1 underline"><Paperclip className="size-3.5" aria-hidden />{f.name}</a>)}
              </p>
            ) : null}
            <OutlookState status={b.outlook} />
          </div>
          {editHref ? (
            <div className="flex items-center gap-3">
              <Link href={editHref(b.id)} className="text-xs underline">Edit</Link>
              <InlineActionForm action={cancelBooking} confirm="Remove this booking? It is taken out of the traveller's calendar.">
                <input type="hidden" name="id" value={b.id} />
                <button type="submit" className="text-xs text-danger underline">Remove</button>
              </InlineActionForm>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "The PA missed the email": sends the open travel request to the travel team again. */
export function ResendTravelButton({ assignmentId, trip, people }: { assignmentId: string; trip?: boolean; people?: number }) {
  return (
    <InlineActionForm action={resendTravelRequest} confirm={`Email the travel request again to the travel team${trip && people && people > 1 ? ` (${people} people)` : ""}? They also get a notification in the platform.`}>
      <input type="hidden" name="id" value={assignmentId} />
      {trip ? <input type="hidden" name="scope" value="trip" /> : null}
      <button type="submit" className="text-sm font-medium underline">Resend travel request</button>
    </InlineActionForm>
  );
}
