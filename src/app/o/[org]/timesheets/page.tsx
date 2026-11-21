import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { syncTimesheetFromClock } from "@/server/services/timesheet-sync";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { addTimesheetEntry, deleteTimesheetEntry, submitTimesheet } from "@/server/actions/workforce";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, EmptyState, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, isDateString, minutesByDayZoned, minutesLabel, projectSessionsFrom, todayIn, weekDays, weekStart, type ProjectPunch } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";
import { formatDateTime } from "@/lib/utils";
import { listPeople } from "@/server/services/people";
import { AttendanceCalendar } from "@/components/timesheets/attendance-calendar";
import { monthStart } from "@/lib/time";

export const metadata: Metadata = { title: "Timesheets" };

const STATUS_TONE = { draft: "neutral", submitted: "warn", approved: "ok", rejected: "danger" } as const;
const CATEGORY = { work: "Work", travel: "Travel", training: "Training", admin: "Admin", standby: "Standby" } as const;

export default async function TimesheetsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ week?: string; month?: string; person?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const tz = ctx.profile.timezone;
  const today = todayIn(tz);
  const canSubmit = ctx.perms.hasAnyScope("timesheets.submit");
  const supabaseForPeople = await createClient();

  // Attendance calendar: yourself, or anyone whose time you're allowed to see.
  const [{ data: visible }, people] = await Promise.all([
    supabaseForPeople.rpc("time_people", { p_org: ctx.org.id }),
    listPeople(ctx.org.id),
  ]);
  const visibleRows = (visible ?? []) as { membership_id: string; joined: string }[];
  const joinedOf = new Map(visibleRows.map((v) => [v.membership_id, v.joined]));
  const staff = people.filter((p) => joinedOf.has(p.membershipId)).sort((a, b) => (a.membershipId === ctx.membership.id ? -1 : b.membershipId === ctx.membership.id ? 1 : a.name.localeCompare(b.name)));
  const othersVisible = staff.some((p) => p.membershipId !== ctx.membership.id);
  if (!canSubmit && !othersVisible) {
    return <AccessDenied message="Timesheets aren't enabled for your role." hint="Ask an administrator." />;
  }
  const defaultPerson = canSubmit ? ctx.membership.id : staff.find((p) => p.membershipId !== ctx.membership.id)?.membershipId ?? ctx.membership.id;
  const person = sp.person && joinedOf.has(sp.person) ? sp.person : defaultPerson;
  const personInfo = staff.find((p) => p.membershipId === person);
  const calMonth = monthStart(sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : today);
  const calHref = (m: string) => {
    const q = new URLSearchParams({ month: m.slice(0, 7), ...(person !== ctx.membership.id ? { person } : {}), ...(sp.week ? { week: sp.week } : {}) });
    return `/o/${ctx.org.slug}/timesheets?${q}#calendar`;
  };
  const calendar = (
    <section id="calendar" className="space-y-3 scroll-mt-20">
      {othersVisible ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="month" value={calMonth.slice(0, 7)} />
          <label className="text-sm">Show attendance for
            <select name="person" defaultValue={person} className="mt-1 block h-9 min-w-56 rounded-md border border-line bg-panel px-2">
              {staff.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.membershipId === ctx.membership.id ? `${p.name} (me)` : p.name}</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>Show</button>
        </form>
      ) : null}
      <AttendanceCalendar
        orgId={ctx.org.id}
        membershipId={person}
        month={calMonth}
        tz={tz}
        today={today}
        joined={personInfo?.startDate ?? joinedOf.get(person) ?? null}
        title={person === ctx.membership.id ? "My attendance" : `Attendance — ${personInfo?.name ?? "Colleague"}`}
        hrefFor={calHref}
      />
    </section>
  );
  if (!canSubmit) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timesheets" description="Staff attendance by month. Review submitted timesheets in Approvals." />
        {calendar}
      </div>
    );
  }
  const wk = weekStart(isDateString(sp.week) ? sp.week : today);
  const days = weekDays(wk);
  const supabase = await createClient();
  const { data: sheetId, error: ensureErr } = await supabase.rpc("ensure_timesheet", { p_org: ctx.org.id, p_week: wk });
  if (ensureErr || !sheetId) return <AccessDenied message="Couldn't open this timesheet." hint="Refresh the page." />;
  // Clocked time (by day and project) is kept in step with the clock-ins while the week is open.
  await syncTimesheetFromClock(supabase, { id: ctx.org.id, timezone: ctx.org.timezone }, ctx.membership.id, wk);

  const [{ data: sheet }, { data: entries }, { data: projects }, { data: tasks }, { data: punches }, { data: history }] = await Promise.all([
    supabase.from("timesheets").select("id, status, submitted_at, reviewed_at, review_note").eq("id", sheetId).single(),
    supabase.from("timesheet_entries").select("id, work_date, project_id, task_id, hours, category, description, is_overtime, from_clock").eq("timesheet_id", sheetId).order("work_date").order("created_at"),
    supabase.from("projects").select("id, name, code").eq("organization_id", ctx.org.id).in("status", ["planning", "active", "on_hold"]).order("name"),
    supabase.from("tasks").select("id, title, project_id").eq("organization_id", ctx.org.id).neq("status", "done").not("project_id", "is", null).order("title").limit(300),
    supabase.from("attendance_events").select("kind, occurred_at, project_id").eq("membership_id", ctx.membership.id).gte("occurred_at", new Date(Date.parse(`${addDays(wk, -1)}T00:00:00Z`)).toISOString()).lt("occurred_at", new Date(Date.parse(`${addDays(wk, 8)}T00:00:00Z`)).toISOString()),
    supabase.from("timesheets").select("week_start, status").eq("membership_id", ctx.membership.id).order("week_start", { ascending: false }).limit(8),
  ]);
  const open = sheet?.status === "draft" || sheet?.status === "rejected";
  // Basic staff only submit: their lines come from clock-ins; managers add time for them if needed.
  const editable = open && ctx.perms.has("work.self_manage");
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]));
  const taskName = new Map((tasks ?? []).map((t) => [t.id, t.title]));
  const hoursByDay: Record<string, number> = {};
  for (const e of entries ?? []) hoursByDay[e.work_date] = (hoursByDay[e.work_date] ?? 0) + Number(e.hours);
  const total = Object.values(hoursByDay).reduce((a, b) => a + b, 0);
  const clockSessions = projectSessionsFrom((punches ?? []) as ProjectPunch[]);
  const clocked = minutesByDayZoned(clockSessions, await projectZones(supabase, clockSessions.map((x) => x.projectId)), tz);
  const base = `/o/${ctx.org.slug}/timesheets`;
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timesheet"
        description={`Week of ${fmtDay(wk)} – ${fmtDay(addDays(wk, 6))}`}
        actions={
          <div className="flex items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, -7)}`} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={base}>This week</Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, 7)}`} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link className={buttonClass("secondary", "sm")} href={`${base}/week?week=${wk}`}>All companies</Link>
        <a className={buttonClass("secondary", "sm")} href={`${base}/export?week=${wk}&scope=company&format=pdf`}><Download className="size-4" aria-hidden /> PDF</a>
        <a className={buttonClass("secondary", "sm")} href={`${base}/export?week=${wk}&scope=company&format=xlsx`}><Download className="size-4" aria-hidden /> Excel</a>
      </div>
      <p className="text-xs text-ink-muted">Rows marked “Clock-ins” come from your clock-ins and update by themselves. To change them, request an attendance correction{ctx.perms.has("work.self_manage") ? "; add anything else with “Add time”" : ""}.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={STATUS_TONE[sheet!.status as keyof typeof STATUS_TONE]}>{sheet!.status}</Badge>
        <span className="text-sm tabular">{total.toFixed(2)} h logged</span>
        {sheet?.submitted_at ? <span className="text-sm text-ink-muted">Submitted {formatDateTime(sheet.submitted_at, tz)}</span> : null}
      </div>
      {sheet?.status === "rejected" && sheet.review_note ? <Notice tone="danger" title="Returned for changes">{sheet.review_note}</Notice> : null}
      {sheet?.status === "approved" ? <Notice tone="ok">Approved and locked. Contact your manager if something needs correcting.</Notice> : null}

      {calendar}

      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-muted">
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="px-2 py-2 font-medium">Project / task</th>
              <th className="px-2 py-2 font-medium">Notes</th>
              <th className="px-2 py-2 text-right font-medium">Hours</th>
              <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDay(e.work_date)}</td>
                <td className="px-2 py-2">
                  {e.project_id ? projectName.get(e.project_id) ?? "Project" : <span className="text-ink-muted">No project</span>}
                  {e.task_id ? <span className="block text-xs text-ink-muted">{taskName.get(e.task_id) ?? "Task"}</span> : null}
                </td>
                <td className="px-2 py-2 text-ink-muted">
                  {CATEGORY[e.category as keyof typeof CATEGORY]}{e.is_overtime ? ", overtime" : ""}{e.description ? ` — ${e.description}` : ""}
                </td>
                <td className="px-2 py-2 text-right tabular">{Number(e.hours).toFixed(2)}</td>
                <td className="px-4 py-2 text-right">
                  {e.from_clock ? <Badge>Clock-ins</Badge> : editable ? (
                    <InlineActionForm action={deleteTimesheetEntry}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="text-xs text-ink-muted underline">Remove</button>
                    </InlineActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
            {!(entries ?? []).length ? <tr><td colSpan={5}><EmptyState title="No time logged this week" /></td></tr> : null}
          </tbody>
          <tfoot className="border-t border-line text-sm">
            <tr>
              <td colSpan={5} className="px-4 py-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  {days.map((d) => (
                    <span key={d} className="tabular">{fmtDay(d)}: <strong className="text-ink">{(hoursByDay[d] ?? 0).toFixed(2)} h</strong>{clocked[d] ? ` (clocked ${minutesLabel(clocked[d])})` : ""}</span>
                  ))}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </Panel>

      {open && !editable ? (
        <Panel className="h-fit">
          <PanelHeader title="Submit for approval" description="Your hours come from your clock-ins. If something is wrong, request a correction under Attendance before you submit." />
          <ActionForm action={submitTimesheet} className="p-4" confirm={`Submit ${total.toFixed(2)} hours for approval?`}>
            <input type="hidden" name="id" value={sheetId} />
            <SubmitButton disabled={!total} pendingLabel="Submitting…">Submit week</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
      {editable ? (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Panel>
            <PanelHeader title="Add time" />
            <ActionForm action={addTimesheetEntry} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="timesheet_id" value={sheetId} />
              <SelectField label="Day" name="work_date" defaultValue={days.includes(today) ? today : wk}>
                {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
              </SelectField>
              <TextField label="Hours" name="hours" type="number" step="0.25" min="0.25" max="24" required defaultValue="8" />
              <SelectField label="Project" name="project_id" optional defaultValue="">
                <option value="">No project</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{projectName.get(p.id)}</option>)}
              </SelectField>
              <SelectField label="Task" name="task_id" optional defaultValue="" hint="Must belong to the selected project">
                <option value="">—</option>
                {(tasks ?? []).map((t) => <option key={t.id} value={t.id}>{projectName.get(t.project_id!)?.split(" · ")[0]}: {t.title}</option>)}
              </SelectField>
              <SelectField label="Type of work" name="category" defaultValue="work">
                {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectField>
              <TextField label="Notes" name="description" optional maxLength={500} />
              <CheckboxField label="Overtime" name="is_overtime" />
              <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Adding…">Add time</SubmitButton></div>
            </ActionForm>
          </Panel>
          <Panel className="h-fit">
            <PanelHeader title="Submit for approval" description="Your manager is notified. You can't edit after submitting unless it's returned." />
            <ActionForm action={submitTimesheet} className="p-4" confirm={`Submit ${total.toFixed(2)} hours for approval?`}>
              <input type="hidden" name="id" value={sheetId} />
              <SubmitButton disabled={!total} pendingLabel="Submitting…">Submit week</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      ) : null}

      {history?.length ? (
        <Panel>
          <PanelHeader title="Recent weeks" />
          <ul className="flex flex-wrap gap-2 p-4">
            {history.map((h) => (
              <li key={h.week_start}>
                <Link href={`${base}?week=${h.week_start}`} className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-panel-sunk">
                  {fmtDay(h.week_start)} <Badge tone={STATUS_TONE[h.status as keyof typeof STATUS_TONE]}>{h.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
