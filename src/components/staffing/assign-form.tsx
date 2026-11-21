"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { assignStaff, type AssignResult } from "@/server/actions/staffing";
import { controlClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export type AssignFormOptions = {
  companies: { id: string; name: string }[];
  projects: { id: string; name: string; companyId: string; start: string | null; end: string | null }[];
  people: { membershipId: string; userId: string; name: string; jobTitle: string | null; companyId: string }[];
};

const label = "mb-1 block text-sm font-medium";

/**
 * Assign staff: company → project → people → dates. Before saving, the server warns when someone
 * is already on another project or on leave; "Assign anyway" saves regardless.
 */
export function AssignForm({ options, defaultCompany, defaultProject, defaultStart }: { options: AssignFormOptions; defaultCompany?: string; defaultProject?: string; defaultStart: string }) {
  const [state, action, pending] = useActionState<AssignResult, FormData>(assignStaff, { ok: true });
  const first = options.companies.find((c) => c.id === defaultCompany)?.id ?? options.companies[0]?.id ?? "";
  const [company, setCompany] = useState(first);
  const projects = useMemo(() => options.projects.filter((p) => p.companyId === company), [options.projects, company]);
  const [project, setProject] = useState(projects.some((p) => p.id === defaultProject) ? defaultProject! : "");
  const people = useMemo(() => options.people.filter((p) => p.companyId === company), [options.people, company]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultStart);
  const [travel, setTravel] = useState(false);
  // Controlled, so a "check before assigning" round trip keeps what was typed.
  const [notes, setNotes] = useState("");
  const [from, setFrom] = useState("");
  const [tnotes, setTnotes] = useState("");
  const force = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const conflicts = state.ok && state.data?.conflicts?.length ? state.data.conflicts : null;

  // After a successful save, clear the form (adjusting state during render, not in an effect).
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok && state.message) {
      setPicked(new Set());
      setTravel(false);
      setNotes("");
      setFrom("");
      setTnotes("");
    }
  }
  useEffect(() => {
    if (force.current) force.current.value = "";
  }, [state]);

  const shown = people.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.jobTitle ?? "").toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const err = (k: string) => (!state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form ref={form} action={action} className="space-y-4 p-4 sm:p-5">
      <input ref={force} type="hidden" name="force" defaultValue="" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="as-company">Company</label>
          <select id="as-company" name="organization_id" className={controlClass} value={company} onChange={(e) => { setCompany(e.target.value); setProject(""); setPicked(new Set()); }}>
            {options.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="as-project">Project</label>
          <select id="as-project" name="project_id" required className={controlClass} value={project} onChange={(e) => {
            setProject(e.target.value);
            const p = projects.find((x) => x.id === e.target.value);
            if (p?.start && p.start > start) { setStart(p.start); if (end < p.start) setEnd(p.start); }
          }}>
            <option value="" disabled>{projects.length ? "Choose a project" : "No open projects"}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {err("project_id") ? <p className="mt-1 text-xs text-danger">{err("project_id")}</p> : null}
        </div>
        <div>
          <label className={label} htmlFor="as-start">First day</label>
          <input id="as-start" type="date" name="start_date" required className={controlClass} value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} />
        </div>
        <div>
          <label className={label} htmlFor="as-end">Last day</label>
          <input id="as-end" type="date" name="end_date" required min={start} className={controlClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          {err("end_date") ? <p className="mt-1 text-xs text-danger">{err("end_date")}</p> : null}
        </div>
      </div>

      <fieldset>
        <legend className={label}>People <span className="font-normal text-ink-muted">({picked.size} ticked)</span></legend>
        <input type="search" placeholder="Search by name or job title" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlClass, "mb-2 max-w-sm")} aria-label="Search people" />
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <label key={p.membershipId} className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-panel-sunk", picked.has(p.membershipId) && "bg-brass-soft/50")}>
              <input type="checkbox" name="people" value={p.membershipId} checked={picked.has(p.membershipId)} onChange={() => toggle(p.membershipId)} className="size-4 accent-brass" />
              <span className="min-w-0">
                <span className="block truncate">{p.name}</span>
                {p.jobTitle ? <span className="block truncate text-xs text-ink-muted">{p.jobTitle}</span> : null}
              </span>
            </label>
          ))}
          {!shown.length ? <p className="p-2 text-sm text-ink-muted">Nobody matches.</p> : null}
        </div>
        {err("people") ? <p className="mt-1 text-xs text-danger">{err("people")}</p> : null}
      </fieldset>

      <div>
        <label className={label} htmlFor="as-notes">Notes for the staff <span className="font-normal text-ink-muted">(optional)</span></label>
        <textarea id="as-notes" name="notes" rows={2} maxLength={1000} className={controlClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope of work, who to meet on site, dress code…" />
      </div>

      <div className="rounded-md border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="needs_travel" checked={travel} onChange={(e) => setTravel(e.target.checked)} className="size-4 accent-brass" />
          Needs travel &amp; accommodation
        </label>
        <p className="mt-1 text-xs text-ink-muted">The company&apos;s travel coordinators get an email request and add the flights and hotel here. Each booking goes into the traveller&apos;s Outlook calendar.</p>
        {travel ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="as-from">Travelling from</label>
              <input id="as-from" name="travel_from" maxLength={200} className={controlClass} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Bangkok, or London Heathrow" />
            </div>
            <div>
              <label className={label} htmlFor="as-tnotes">Notes for the coordinators <span className="font-normal text-ink-muted">(optional)</span></label>
              <input id="as-tnotes" name="travel_notes" maxLength={2000} className={controlClass} value={tnotes} onChange={(e) => setTnotes(e.target.value)} placeholder="Arrive the day before, hotel near the marina…" />
            </div>
          </div>
        ) : null}
      </div>

      {conflicts ? (
        <Notice tone="warn" title="Check before assigning">
          <ul className="list-disc space-y-1 pl-5">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => { if (force.current) force.current.value = "1"; form.current?.requestSubmit(); }}>Assign anyway</Button>
          </div>
        </Notice>
      ) : null}
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : state.message ? <Notice tone="ok">{state.message}</Notice> : null}
      <Button type="submit" disabled={pending || !project || !picked.size}>{pending ? "Assigning…" : `Assign ${picked.size || ""} ${picked.size === 1 ? "person" : "people"}`.replace("  ", " ")}</Button>
    </form>
  );
}
