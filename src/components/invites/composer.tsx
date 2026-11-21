"use client";

import { useState } from "react";
import { sendInvite } from "@/server/actions/outlook";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { zoneLabel, type ZoneOption } from "@/lib/timezones";

export type ComposerCompany = { id: string; name: string; timezone: string };
export type ComposerPerson = { userId: string; name: string; jobTitle: string | null; companies: string[] };
export type ComposerProject = { id: string; name: string; company: string };

const box = "mt-1.5 max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-line p-2";

type Category = "travel" | "meeting" | "company" | "project" | "other";
const TYPES: { key: Category; label: string; hint: string }[] = [
  { key: "travel", label: "Travel information", hint: "Calendar invite with the journey: from, to, when, transport and where they stay." },
  { key: "meeting", label: "Meeting", hint: "Calendar invite with date, time, place or Teams link and the agenda." },
  { key: "company", label: "Company update", hint: "News for staff — sent as an email and a notification. No date needed." },
  { key: "project", label: "Project update", hint: "Progress or changes on a project — sent as an email to the team. No date needed." },
  { key: "other", label: "Other", hint: "Add a date to make it a calendar invite, or leave it empty to send it as an update." },
];

/**
 * PAs and super admins: travel details, meetings and updates. The form shows only what the
 * chosen type needs; travel and meetings become Outlook calendar invites, updates go by email.
 */
export function InviteComposer({ companies, people, projects, defaultCompany, defaultTz, signature, zoneGroups }: {
  companies: ComposerCompany[]; people: ComposerPerson[]; projects: ComposerProject[]; defaultCompany: string; defaultTz: string; signature: string | null;
  zoneGroups: { group: string; zones: ZoneOption[] }[]; // built on the server so the list matches exactly
}) {
  const [type, setType] = useState<Category>("travel");
  const [allDay, setAllDay] = useState(false);
  const dated = type === "travel" || type === "meeting" || type === "other";
  const groups = zoneGroups;
  // The group's own companies first, so the usual zones are one click away.
  const companyZones = [...new Map(companies.map((c) => [c.timezone, c])).values()];
  const zoneSelect = (name: string, label: string, hint?: string, optional?: boolean) => (
    <SelectField label={label} name={name} defaultValue={optional ? "" : defaultTz} hint={hint} optional={optional}>
      {optional ? <option value="">Same as departure</option> : null}
      <optgroup label="Your companies">
        {companyZones.map((c) => <option key={`co-${c.id}`} value={c.timezone}>{zoneLabel(c.timezone)} — {companies.filter((x) => x.timezone === c.timezone).map((x) => x.name).join(", ")}</option>)}
        {!companyZones.some((c) => c.timezone === defaultTz) ? <option value={defaultTz}>{zoneLabel(defaultTz)} — your time zone</option> : null}
      </optgroup>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.zones.map((z) => <option key={`${g.group}-${z.value}`} value={z.value}>{z.label}</option>)}
        </optgroup>
      ))}
    </SelectField>
  );
  const tzField = zoneSelect("time_zone", "Time zone", type === "meeting" ? "The meeting's local time; Outlook shows it in each person's own time." : undefined);

  return (
    <ActionForm action={sendInvite} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5" resetOnSuccess>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium">What are you sending?</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <label key={t.key} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-brass has-[:checked]:bg-brass-soft">
              <input type="radio" name="category" value={t.key} checked={type === t.key} onChange={() => setType(t.key)} className="size-4" /> {t.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">{TYPES.find((t) => t.key === type)!.hint}</p>
      </fieldset>

      {companies.length > 1 ? (
        <div className="sm:col-span-2 sm:max-w-sm">
          <SelectField label="Sent for" name="organization_id" defaultValue={defaultCompany}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        </div>
      ) : <input type="hidden" name="organization_id" value={defaultCompany} />}

      <div className="sm:col-span-2">
        <TextField
          label="Title" name="title" required maxLength={200}
          placeholder={{ travel: "Flight to Bangkok — MY Triple Seven install", meeting: "Weekly operations meeting", company: "New office opening in Phnom Penh", project: "MY Kensho — phase 2 starts", other: "Title" }[type]}
        />
      </div>

      {type === "travel" ? (
        <>
          <TextField label="From" name="from_place" required maxLength={140} placeholder="London Heathrow (LHR)" />
          <TextField label="To" name="to_place" required maxLength={140} placeholder="Bangkok Suvarnabhumi (BKK)" />
          <TextField label="Departure date" name="start_date" type="date" required />
          <TextField label="Departure time" name="start_time" type="time" required />
          <div className="sm:col-span-2">{zoneSelect("time_zone", "Departure time zone", "Local time where they leave from, as on the ticket")}</div>
          <TextField label="Arrival / return date" name="end_date" type="date" optional hint="Arrival, or the day they come back" />
          <TextField label="Arrival / return time" name="end_time" type="time" optional />
          <div className="sm:col-span-2">{zoneSelect("end_time_zone", "Arrival time zone", "Local time where they arrive", true)}</div>
          <TextField label="Transport" name="transport" optional maxLength={200} placeholder="Thai Airways TG917, seat 34A, booking ABC123" />
          <TextField label="Accommodation" name="accommodation" optional maxLength={200} placeholder="Hotel name, address, check-in" />
        </>
      ) : null}

      {type === "meeting" ? (
        <>
          <TextField label="Date" name="start_date" type="date" required />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Starts" name="start_time" type="time" required />
            <TextField label="Ends" name="end_time" type="time" optional hint="Default: one hour" />
          </div>
          <TextField label="Where" name="location" optional maxLength={300} placeholder="Office, marina, or Teams link" />
          {tzField}
        </>
      ) : null}

      {type === "other" ? (
        <>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="all_day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4" /> All day</label>
          <TextField label="Starts" name="start_date" type="date" optional hint="Leave empty to send as an update" />
          {!allDay ? <TextField label="Start time" name="start_time" type="time" optional /> : <span />}
          <TextField label="Ends" name="end_date" type="date" optional />
          {!allDay ? <TextField label="End time" name="end_time" type="time" optional /> : <span />}
          <TextField label="Location" name="location" optional maxLength={300} />
          {tzField}
        </>
      ) : null}

      <div className="sm:col-span-2">
        <TextAreaField
          label={{ travel: "Notes", meeting: "Agenda / notes", company: "Update", project: "Update", other: "Details" }[type]}
          name="body" required={type === "company" || type === "project"} optional={!(type === "company" || type === "project")} rows={type === "company" || type === "project" ? 8 : 4} maxLength={8000}
          hint={type === "travel" ? "Pick-up, what to bring, contacts on arrival…" : undefined}
        />
      </div>
      {!dated ? <input type="hidden" name="time_zone" value={defaultTz} /> : null}

      <div className="sm:col-span-2">
        <label className="block text-sm">
          <span className="font-medium">Attachments</span> <span className="text-ink-muted">(optional — up to 5 files, 3 MB each: tickets, itineraries, PDFs, photos, Word, Excel)</span>
          <input type="file" name="attachments" multiple accept="image/*,application/pdf,.docx,.xlsx,.pptx,.txt,.csv" className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
        </label>
      </div>

      <div className="sm:col-span-2 rounded-md border border-line p-3">
        {signature ? (
          <>
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="use_signature" defaultChecked className="size-4" /> Add my signature</label>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-muted">{signature}</p>
            <p className="mt-1 text-xs text-ink-muted">Change it in “Your email signature” below.</p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">No signature yet — add one in “Your email signature” below and it will go on everything you send.</p>
        )}
      </div>

      <div className="sm:col-span-2 grid gap-3 lg:grid-cols-3">
        <fieldset>
          <legend className="text-sm font-medium">Everyone in</legend>
          <div className={box}>
            {companies.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="companies" value={c.id} className="size-4" /> {c.name}</label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Project teams</legend>
          <div className={box}>
            {projects.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm"><input type="checkbox" name="projects" value={p.id} className="mt-0.5 size-4" /><span>{p.name}<span className="block text-xs text-ink-muted">{p.company}</span></span></label>
            ))}
            {!projects.length ? <p className="text-sm text-ink-muted">No open projects.</p> : null}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">People</legend>
          <div className={box}>
            {people.map((p) => (
              <label key={p.userId} className="flex items-start gap-2 text-sm"><input type="checkbox" name="people" value={p.userId} className="mt-0.5 size-4" /><span>{p.name}<span className="block text-xs text-ink-muted">{[p.jobTitle, p.companies.join(", ")].filter(Boolean).join(" · ")}</span></span></label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-ink-muted sm:col-span-2">
        {dated ? "Everyone chosen gets a calendar invite in Outlook (from the shared mailbox) and a notification here." : "Everyone chosen gets it by email (from the shared mailbox) and as a notification here."} People in more than one list get it once.
      </p>
      <div className="sm:col-span-2"><SubmitButton pendingLabel="Sending…">{dated && type !== "other" ? "Send invite" : "Send"}</SubmitButton></div>
    </ActionForm>
  );
}
