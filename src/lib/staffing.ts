/** Shared by the staff calendar pages, forms and server actions. */
export type TravelStatus = "requested" | "in_progress" | "booked" | "cancelled";

export const TRAVEL_LABEL: Record<TravelStatus, string> = { requested: "Travel requested", in_progress: "Travel being booked", booked: "Travel booked", cancelled: "Travel cancelled" };
export const BOOKING_KINDS = { flight: "Flight", hotel: "Hotel", train: "Train", car: "Car hire", transfer: "Transfer", other: "Other" } as const;
export type BookingKind = keyof typeof BOOKING_KINDS;

/** "3 – 9 Dec 2026", or one day "Thu 3 Dec 2026". */
export function fmtRange(a: string, b: string) {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  if (a === b) return f(a, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${f(a, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} – ${f(b, { day: "numeric", month: "short", year: "numeric" })}`;
}

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const zoneDate = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso));
const zoneTime = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

/** One line describing a booking, for emails: "Flight: TG 403 · BKK → SIN — Thu 19 Nov 08:40 (Bangkok), ref ABC123". */
export function describeBooking(b: { kind: string; title: string; reference: string | null; from_place: string | null; to_place: string | null; all_day: boolean; starts_at: string; ends_at: string; start_tz: string }) {
  const label = BOOKING_KINDS[b.kind as BookingKind] ?? "Booking";
  const route = b.from_place && b.to_place && b.kind !== "hotel" ? ` · ${b.from_place} → ${b.to_place}` : "";
  const when = b.all_day
    ? `${dayLabel(zoneDate(b.starts_at, b.start_tz))} – ${dayLabel(zoneDate(new Date(Date.parse(b.ends_at) - 86_400_000).toISOString(), b.start_tz))}`
    : `${dayLabel(zoneDate(b.starts_at, b.start_tz))} ${zoneTime(b.starts_at, b.start_tz)} (${city(b.start_tz)})`;
  return `${label}: ${b.title}${route} — ${when}${b.reference ? `, ref ${b.reference}` : ""}`;
}
