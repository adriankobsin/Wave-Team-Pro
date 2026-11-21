import Link from "@/components/ui/link";
import { BedDouble, ChevronLeft, ChevronRight, Plane, TrainFront, Car } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { EmptyState, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { AssignForm } from "@/components/staffing/assign-form";
import { assignOptions, COMPANY_DOTS, COMPANY_TONES, staffMonth, tripsInMonth, type DayEntry, type StaffCompany } from "@/server/services/staffing";
import { InlineActionForm } from "@/components/ui/action-form";
import { cancelAssignment } from "@/server/actions/staffing";
import { ResendTravelButton, TravelBadge } from "@/components/staffing/trip-parts";
import { fmtRange, TRAVEL_LABEL } from "@/lib/staffing";
import { addMonths, isDateString, monthStart, todayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

type SP = { month?: string; company?: string; project?: string; person?: string; day?: string };

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const MAX_IN_CELL = 4;

function BookingIcon({ kind }: { kind: string }) {
  const I = kind === "hotel" ? BedDouble : kind === "train" ? TrainFront : kind === "car" || kind === "transfer" ? Car : Plane;
  return <I className="size-3 shrink-0" aria-hidden />;
}

function Chip({ e, tone, href, stacked }: { e: DayEntry; tone: string; href: string | null; stacked?: boolean }) {
  const title = `${e.person} — ${e.project}${e.state === "working" ? " (clocked in)" : e.state === "unplanned" ? " (clocked in, not assigned)" : " (assigned)"}${e.travel ? ` · ${TRAVEL_LABEL[e.travel]}` : ""}`;
  const body = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", e.state === "planned" ? "border border-current" : "bg-current")} aria-hidden />
      {stacked ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{e.person}</span>
          <span className="block truncate opacity-75">{e.project}</span>
        </span>
      ) : (
        <>
          <span className="truncate font-medium">{e.person}</span>
          <span className="truncate opacity-75">· {e.project}</span>
        </>
      )}
      {e.travel && e.travel !== "cancelled" ? <Plane className={cn("ml-auto size-3 shrink-0", e.travel === "booked" ? "opacity-100" : "opacity-50")} aria-label={TRAVEL_LABEL[e.travel]} /> : null}
    </>
  );
  // Bookings (assigned) are filled in the company colour; clock-ins without a booking are dashed and see-through.
  const cls = cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.6875rem] leading-tight", tone, e.state !== "unplanned" && "border-l-4", e.state === "unplanned" && "border-dashed bg-transparent dark:bg-transparent");
  return href ? <Link href={href} title={title} className={cn(cls, "hover:brightness-95")}>{body}</Link> : <span title={title} className={cls}>{body}</span>;
}

/**
 * The month view shared by Group Hub (every company) and each company: who is assigned where,
 * who actually clocked in on which project, leave and travel, plus the "Assign staff" form.
 */
export async function StaffCalendar({ companies, sp, base, viewerTz, showCompanyFilter }: { companies: StaffCompany[]; sp: SP; base: string; viewerTz: string; showCompanyFilter: boolean }) {
  const today = todayIn(viewerTz);
  const month = monthStart(sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : today);
  const visible = companies.filter((c) => c.canView);
  const inView = sp.company ? visible.filter((c) => c.id === sp.company) : visible;
  const [data, options, allTrips] = await Promise.all([
    staffMonth(inView, month, { project: sp.project || undefined, person: sp.person || undefined }),
    assignOptions(companies),
    tripsInMonth(inView, month),
  ]);
  const canAssign = new Set(companies.filter((c) => c.canAssign).map((c) => c.id));
  const toneOf = new Map(companies.map((c, i) => [c.id, i % COMPANY_TONES.length]));
  const slugOf = new Map(companies.map((c) => [c.id, c.slug]));
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const href = (e: DayEntry) => (e.assignmentId ? `/o/${slugOf.get(e.companyId)}/staffing/${e.assignmentId}` : null);
  const keep = (extra: Partial<SP>) => {
    const q = new URLSearchParams();
    const all = { month: month.slice(0, 7), company: sp.company, project: sp.project, person: sp.person, day: sp.day, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const day = isDateString(sp.day) ? sp.day : null;
  const selected = day ? { entries: data.entries.get(day) ?? [], leave: data.leave.get(day) ?? [], bookings: data.bookings.get(day) ?? [] } : null;
  const anyInMonth = data.days.some((d) => d.slice(0, 7) === month.slice(0, 7) && ((data.entries.get(d)?.length ?? 0) > 0 || (data.leave.get(d)?.length ?? 0) > 0));
  const projectChoices = data.projects.filter((p) => !sp.company || p.companyId === sp.company);
  const weeks: string[][] = [];
  for (let i = 0; i < data.days.length; i += 7) weeks.push(data.days.slice(i, i + 7));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff calendar"
        description="Who is assigned to which project each day, and who actually clocked in there. Leave and travel bookings show on the same days."
        actions={
          <div className="flex items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={keep({ month: addMonths(month, -1).slice(0, 7), day: undefined })} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={keep({ month: today.slice(0, 7), day: undefined })}>This month</Link>
            <Link className={buttonClass("secondary", "sm")} href={keep({ month: addMonths(month, 1).slice(0, 7), day: undefined })} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link>
          </div>
        }
      />

      {!visible.length ? (
        <Notice tone="neutral" title="Nothing to show">You don&apos;t have the “See the staff calendar” permission in any company. Ask a super admin.</Notice>
      ) : null}

      <Panel>
        <form method="get" action={base} className="flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="month" value={month.slice(0, 7)} />
          {showCompanyFilter ? (
            <label className="text-sm">
              <span className="mb-1 block font-medium">Company</span>
              <select name="company" defaultValue={sp.company ?? ""} className={cn(controlClass, "w-56")}>
                <option value="">All companies</option>
                {visible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            <span className="mb-1 block font-medium">Project</span>
            <select name="project" defaultValue={sp.project ?? ""} className={cn(controlClass, "w-64")}>
              <option value="">All projects</option>
              {projectChoices.map((p) => <option key={p.id} value={p.id}>{p.name}{showCompanyFilter ? ` — ${nameOf.get(p.companyId)}` : ""}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Person</span>
            <select name="person" defaultValue={sp.person ?? ""} className={cn(controlClass, "w-56")}>
              <option value="">Everyone</option>
              {data.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>Show</button>
          {sp.company || sp.project || sp.person ? <Link href={`${base}?month=${month.slice(0, 7)}`} className="pb-2 text-sm text-ink-muted underline">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
          {inView.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", COMPANY_DOTS[toneOf.get(c.id)!])} aria-hidden />{c.name}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-l-4 border-sky-400 bg-sky-100 dark:bg-sky-900" aria-hidden /><span className="-ml-0.5 size-2 rounded-full border border-ink-muted" aria-hidden />Booked (assigned)</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-muted" aria-hidden />Booked and clocked in</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-dashed border-ink-muted" aria-hidden />Clocked in, not assigned</span>
          <span className="inline-flex items-center gap-1.5"><Plane className="size-3" aria-hidden />Travel</span>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="px-4 pt-4 text-lg font-semibold">{fmt(month, { month: "long", year: "numeric" })}</div>
        {/* Month grid (tablet and desktop). */}
        <div className="hidden p-4 md:block">
          <div className="grid grid-cols-7 border-l border-t border-line text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b border-r border-line bg-panel-sunk px-2 py-1 font-medium text-ink-muted">{d}</div>)}
            {weeks.flat().map((d) => {
              const list = data.entries.get(d) ?? [];
              const leave = data.leave.get(d) ?? [];
              const trips = data.bookings.get(d) ?? [];
              const other = d.slice(0, 7) !== month.slice(0, 7);
              const shown = list.slice(0, MAX_IN_CELL);
              const more = list.length - shown.length + Math.max(0, leave.length - 1) + Math.max(0, trips.length - 2);
              return (
                <div key={d} className={cn("min-h-28 space-y-0.5 border-b border-r border-line p-1", other && "bg-panel-sunk/50", d === day && "ring-2 ring-inset ring-brass")}>
                  <Link href={keep({ day: d })} className={cn("mb-0.5 flex items-center justify-between rounded px-1 text-xs hover:bg-panel-sunk", d === today ? "font-bold text-brass" : other ? "text-ink-muted" : "")}>
                    <span>{Number(d.slice(8))}</span>
                    {list.length ? <span className="text-[0.625rem] text-ink-muted">{list.length}</span> : null}
                  </Link>
                  {shown.map((e) => <Chip key={`${e.membershipId}${e.projectId}`} e={e} tone={COMPANY_TONES[toneOf.get(e.companyId) ?? 0]} href={href(e)} stacked />)}
                  {leave.slice(0, 1).map((l) => <span key={l.userId} className="block truncate rounded bg-panel-sunk px-1.5 py-0.5 text-[0.6875rem] text-ink-muted" title={`${l.person} — ${l.type}`}>{l.person} · {l.type}</span>)}
                  {trips.slice(0, 2).map((b, i) => <span key={i} className="flex items-center gap-1 truncate px-1 text-[0.6875rem] text-ink-muted" title={`${b.person} — ${b.label}`}><BookingIcon kind={b.kind} /><span className="truncate">{b.person.split(" ")[0]}: {b.label}</span></span>)}
                  {more > 0 ? <Link href={keep({ day: d })} className="block px-1 text-[0.6875rem] font-medium text-ink-muted underline">+{more} more</Link> : null}
                </div>
              );
            })}
          </div>
        </div>
        {/* Phone: the days that have something, as a list. */}
        <div className="divide-y divide-line md:hidden">
          {data.days.filter((d) => d.slice(0, 7) === month.slice(0, 7) && ((data.entries.get(d)?.length ?? 0) + (data.leave.get(d)?.length ?? 0) + (data.bookings.get(d)?.length ?? 0) > 0)).map((d) => (
            <div key={d} className="space-y-1 px-4 py-3">
              <p className={cn("text-sm font-medium", d === today && "text-brass")}>{fmt(d, { weekday: "long", day: "numeric", month: "short" })}</p>
              {(data.entries.get(d) ?? []).map((e) => <Chip key={`${e.membershipId}${e.projectId}`} e={e} tone={COMPANY_TONES[toneOf.get(e.companyId) ?? 0]} href={href(e)} />)}
              {(data.leave.get(d) ?? []).map((l) => <p key={l.userId} className="text-xs text-ink-muted">{l.person} · {l.type}</p>)}
              {(data.bookings.get(d) ?? []).map((b, i) => <p key={i} className="flex items-center gap-1 text-xs text-ink-muted"><BookingIcon kind={b.kind} />{b.person}: {b.label}</p>)}
            </div>
          ))}
        </div>
        {!anyInMonth ? <div className="px-4 pb-4 text-sm text-ink-muted">Nobody is assigned or clocked in this month{sp.project || sp.person ? " for this filter" : ""}.</div> : null}
      </Panel>

      {selected && day ? (
        <Panel>
          <PanelHeader title={fmt(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} action={<Link href={keep({ day: undefined })} className="text-sm text-ink-muted underline">Close</Link>} />
          {selected.entries.length || selected.leave.length || selected.bookings.length ? (
            <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {inView.filter((c) => selected.entries.some((e) => e.companyId === c.id) || selected.leave.some((l) => l.companyId === c.id) || selected.bookings.some((b) => b.companyId === c.id)).map((c) => (
                <div key={c.id} className="space-y-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold"><span className={cn("size-2.5 rounded-full", COMPANY_DOTS[toneOf.get(c.id)!])} aria-hidden />{c.name}</p>
                  {selected.entries.filter((e) => e.companyId === c.id).map((e) => (
                    <div key={`${e.membershipId}${e.projectId}`} className="text-sm">
                      <Chip e={e} tone={COMPANY_TONES[toneOf.get(e.companyId) ?? 0]} href={href(e)} />
                      <p className="pl-1 text-xs text-ink-muted">{e.state === "working" ? "Assigned · clocked in" : e.state === "planned" ? (day < today ? "Assigned · no clock-in" : "Assigned") : "Clocked in without an assignment"}{e.travel ? ` · ${TRAVEL_LABEL[e.travel]}` : ""}</p>
                    </div>
                  ))}
                  {selected.leave.filter((l) => l.companyId === c.id).map((l) => <p key={l.userId} className="text-sm text-ink-muted">{l.person} · {l.type}</p>)}
                  {selected.bookings.filter((b) => b.companyId === c.id).map((b, i) => (
                    <Link key={i} href={`/o/${c.slug}/travel/${b.requestId}`} className="flex items-center gap-1 text-sm text-ink-muted hover:underline"><BookingIcon kind={b.kind} />{b.person}: {b.label}</Link>
                  ))}
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nobody on this day" />}
        </Panel>
      ) : null}

      {allTrips.length ? (
        <Panel>
          <PanelHeader title={`Trips in ${fmt(month, { month: "long" })}`} description="People assigned together are one trip. Change the dates or cancel it here: Outlook invites update, travel is updated or cancelled, and everyone on it is emailed." />
          <ul className="divide-y divide-line">
            {allTrips.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <span className={cn("size-2.5 shrink-0 rounded-full", COMPANY_DOTS[toneOf.get(t.companyId) ?? 0])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.project} <span className="font-normal text-ink-muted">· {fmtRange(t.start, t.end)}{showCompanyFilter ? ` · ${nameOf.get(t.companyId)}` : ""}</span></p>
                  <p className="text-ink-muted">{t.people.join(", ")}</p>
                </div>
                {t.travel ? <TravelBadge status={t.travel} /> : null}
                <Link href={`/o/${t.slug}/staffing/${t.firstId}`} className={buttonClass("secondary", "sm")}>{canAssign.has(t.companyId) ? "Change" : "Open"}</Link>
                {canAssign.has(t.companyId) && (t.travel === "requested" || t.travel === "in_progress") ? <ResendTravelButton assignmentId={t.firstId} trip people={t.people.length} /> : null}
                {canAssign.has(t.companyId) ? (
                  <InlineActionForm action={cancelAssignment} confirm={`Cancel this trip (${t.people.length} ${t.people.length === 1 ? "person" : "people"}, ${t.project})? Outlook invites, travel requests and bookings are cancelled and everyone on it is emailed.`}>
                    <input type="hidden" name="id" value={t.firstId} />
                    <input type="hidden" name="scope" value="trip" />
                    <button type="submit" className="text-sm font-medium text-danger underline">Cancel trip</button>
                  </InlineActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {options.companies.length ? (
        <Panel id="assign">
          <PanelHeader title="Assign staff" description="Each person gets an Outlook calendar invite for the dates. Tick “Needs travel & accommodation” to send the request to the company's travel coordinators." />
          <AssignForm
            options={options}
            defaultCompany={sp.company ?? companies.find((c) => c.canAssign)?.id}
            defaultProject={sp.project}
            defaultStart={day && day >= today ? day : today}
          />
        </Panel>
      ) : null}
    </div>
  );
}
