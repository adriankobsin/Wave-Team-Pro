"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveBooking } from "@/server/actions/staffing";
import { BOOKING_KINDS, type BookingKind } from "@/lib/staffing";

type Zone = { group: string; zones: { value: string; label: string }[] };
export type BookingDraft = {
  id: string; kind: BookingKind; title: string; reference: string; from_place: string; to_place: string; address: string;
  start_date: string; start_time: string; start_tz: string; end_date: string; end_time: string; end_tz: string; notes: string;
};

function ZoneSelect({ name, label, value, onChange, zones }: { name: string; label: string; value: string; onChange: (v: string) => void; zones: Zone[] }) {
  return (
    <SelectField label={label} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </optgroup>
      ))}
    </SelectField>
  );
}

/** Flight, hotel, train, car or transfer for one traveller; times are local to where they happen. */
export function BookingForm({ requestId, draft, defaultTz, defaultDate, zones }: { requestId: string; draft?: BookingDraft; defaultTz: string; defaultDate: string; zones: Zone[] }) {
  const [kind, setKind] = useState<BookingKind>(draft?.kind ?? "flight");
  const [startTz, setStartTz] = useState(draft?.start_tz ?? defaultTz);
  const [endTz, setEndTz] = useState(draft?.end_tz ?? defaultTz);
  const hotel = kind === "hotel";
  const titleLabel = { flight: "Airline and flight number", hotel: "Hotel name", train: "Train operator and number", car: "Car hire company", transfer: "Transfer company or driver", other: "What it is" }[kind];
  const titleHint = { flight: "e.g. Thai Airways TG 403", hotel: "e.g. ONE°15 Marina Club", train: "e.g. Eurostar 9014", car: "e.g. Hertz, Changi T3", transfer: "e.g. Grab pre-booked", other: "" }[kind];
  return (
    <ActionForm action={saveBooking} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess={!draft}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="booking_id" value={draft?.id ?? ""} />
      <SelectField label="Type" name="kind" value={kind} onChange={(e) => setKind(e.target.value as BookingKind)}>
        {Object.entries(BOOKING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectField>
      <TextField label={titleLabel} name="title" required maxLength={200} defaultValue={draft?.title} placeholder={titleHint} className="" />
      <TextField label="Booking reference" name="reference" optional maxLength={100} defaultValue={draft?.reference} placeholder="PNR / confirmation number" />
      {hotel ? (
        <TextField label="Address" name="address" optional maxLength={300} defaultValue={draft?.address} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="From" name="from_place" optional maxLength={200} defaultValue={draft?.from_place} placeholder="BKK" />
          <TextField label="To" name="to_place" optional maxLength={200} defaultValue={draft?.to_place} placeholder="SIN" />
        </div>
      )}
      {hotel ? (
        <>
          <TextField label="Check-in" name="start_date" type="date" required defaultValue={draft?.start_date ?? defaultDate} />
          <TextField label="Check-out" name="end_date" type="date" required defaultValue={draft?.end_date} />
          <ZoneSelect name="start_tz" label="Hotel time zone" value={startTz} onChange={setStartTz} zones={zones} />
        </>
      ) : (
        <>
          <TextField label="Departure date" name="start_date" type="date" required defaultValue={draft?.start_date ?? defaultDate} />
          <TextField label="Departure time (local)" name="start_time" type="time" required defaultValue={draft?.start_time} />
          <ZoneSelect name="start_tz" label="Departure time zone" value={startTz} onChange={(v) => { setStartTz(v); if (!draft) setEndTz(v); }} zones={zones} />
          <TextField label="Arrival date" name="end_date" type="date" optional defaultValue={draft?.end_date} hint="Leave empty for the same day" />
          <TextField label="Arrival time (local)" name="end_time" type="time" optional defaultValue={draft?.end_time} />
          <ZoneSelect name="end_tz" label="Arrival time zone" value={endTz} onChange={setEndTz} zones={zones} />
        </>
      )}
      <div className="sm:col-span-2">
        <TextAreaField label="Notes for the traveller" name="notes" optional maxLength={2000} defaultValue={draft?.notes} placeholder="Baggage allowance, seat, who picks them up…" className="min-h-16" />
      </div>
      <div className="sm:col-span-2">
        <TextField label="Booking confirmation" name="attachments" type="file" multiple optional hint="PDF or image, up to 3 files of 3 MB. Attached to the traveller's calendar invite." />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <SubmitButton pendingLabel="Saving…">{draft ? "Save changes" : `Add ${BOOKING_KINDS[kind].toLowerCase()}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}
