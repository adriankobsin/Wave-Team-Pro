import type { Metadata } from "next";
import { Coffee, LogIn, LogOut } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { clockAction, requestCorrection } from "@/server/actions/workforce";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PersonLabel } from "@/components/ui/avatar";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, dateOf, minutesByDayZoned, minutesLabel, projectSessionsFrom, punchZones, timeOf, todayIn, weekDays, weekStart, zoneCity, type Punch, type ProjectPunch } from "@/lib/time";
import { projectZones } from "@/server/services/project-zones";

export const metadata: Metadata = { title: "Attendance" };

const KIND_LABEL: Record<string, string> = { clock_in: "Clock in", clock_out: "Clock out", break_start: "Break start", break_end: "Break end" };

/** Start of the "team right now" window (kept out of render for purity). */
function recentSince() {
  return new Date(Date.now() - 36 * 3600_000).toISOString();
}

function nowState(punches: Punch[]): "in" | "out" | "break" {
  const last = [...punches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)).at(-1);
  return last?.kind === "clock_in" || last?.kind === "break_end" ? "in" : last?.kind === "break_start" ? "break" : "out";
}

export default async function AttendancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.hasAnyScope("attendance.view.self")) return <AccessDenied message="Attendance isn't enabled for your role." hint="Ask an administrator." />;
  const tz = ctx.profile.timezone;
  // Look back far enough to cover "today" in any zone (up to a day either side).
  const from = new Date(Date.parse(`${addDays(weekStart(todayIn(ctx.org.timezone || tz)), -2)}T00:00:00Z`)).toISOString();
  const supabase = await createClient();
  const canTeam = ctx.perms.hasAnyScope("attendance.view.team") || ctx.perms.has("attendance.view.all");

  const [{ data: mine }, { data: corrections }, people, team] = await Promise.all([
    supabase.from("attendance_events").select("kind, occurred_at, source, project_id").eq("membership_id", ctx.membership.id).gte("occurred_at", from).order("occurred_at"),
    supabase.from("attendance_corrections").select("id, kind, occurred_at, reason, status, review_note, created_at").eq("membership_id", ctx.membership.id).order("created_at", { ascending: false }).limit(10),
    canTeam ? listPeople(ctx.org.id) : Promise.resolve([]),
    canTeam
      ? supabase.from("attendance_events").select("membership_id, kind, occurred_at").eq("organization_id", ctx.org.id).gte("occurred_at", recentSince()).neq("membership_id", ctx.membership.id).order("occurred_at")
      : Promise.resolve({ data: [] as { membership_id: string; kind: Punch["kind"]; occurred_at: string }[] }),
  ]);
  const punches = (mine ?? []) as (ProjectPunch & { source: string })[];
  const state = nowState(punches);
  // Times follow the project clocked into: Bangkok for a Thailand project, Singapore for Singapore, and so on.
  const companyTz = ctx.org.timezone || tz;
  const zones = await projectZones(supabase, punches.map((p) => p.project_id));
  const sessions = projectSessionsFrom(punches);
  const zoneOf = punchZones(punches, zones, companyTz);
  const lastZone = zoneOf.length ? zoneOf[punches.map((p, i) => ({ t: Date.parse(p.occurred_at), i })).sort((a, b) => b.t - a.t)[0].i] : companyTz;
  const todayTz = lastZone;
  const today = todayIn(todayTz);
  const wk = weekStart(today);
  const byDay = minutesByDayZoned(sessions, zones, companyTz);
  const days = weekDays(wk);
  const weekTotal = days.reduce((n, d) => n + (byDay[d] ?? 0), 0);
  const todays = punches.map((p, i) => ({ ...p, zone: zoneOf[i] })).filter((p) => dateOf(p.occurred_at, p.zone) === today);

  const teamRows = canTeam
    ? people
        .filter((p) => p.membershipId !== ctx.membership.id)
        .map((p) => {
          const ev = ((team as { data: { membership_id: string; kind: Punch["kind"]; occurred_at: string }[] | null }).data ?? []).filter((e) => e.membership_id === p.membershipId);
          const st = nowState(ev);
          const since = ev.at(-1)?.occurred_at;
          return { p, st, since };
        })
        .filter((r) => r.since)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Clock in and out from your phone or desk. Times are recorded by the server; your location is never collected." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel>
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-muted">Status</p>
              <Badge tone={state === "in" ? "ok" : state === "break" ? "warn" : "neutral"}>{state === "in" ? "Working" : state === "break" ? "On break" : "Not clocked in"}</Badge>
            </div>
            <p className="display tabular text-4xl font-semibold">{minutesLabel(byDay[today] ?? 0)}</p>
            <p className="text-sm text-ink-muted">worked today · {minutesLabel(weekTotal)} this week</p>
            <div className="grid grid-cols-2 gap-2">
              {state === "out" ? (
                <ActionForm action={clockAction} className="col-span-2">
                  <input type="hidden" name="organization_id" value={ctx.org.id} />
                  <input type="hidden" name="kind" value="clock_in" />
                  <SubmitButton className="h-14 w-full text-base" pendingLabel="Clocking in…"><LogIn className="size-5" aria-hidden /> Clock in</SubmitButton>
                </ActionForm>
              ) : (
                <>
                  <ActionForm action={clockAction}>
                    <input type="hidden" name="organization_id" value={ctx.org.id} />
                    <input type="hidden" name="kind" value={state === "break" ? "break_end" : "break_start"} />
                    <SubmitButton variant="secondary" className="h-14 w-full" pendingLabel="Saving…"><Coffee className="size-5" aria-hidden /> {state === "break" ? "End break" : "Start break"}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={clockAction}>
                    <input type="hidden" name="organization_id" value={ctx.org.id} />
                    <input type="hidden" name="kind" value="clock_out" />
                    <SubmitButton className="h-14 w-full" pendingLabel="Clocking out…"><LogOut className="size-5" aria-hidden /> Clock out</SubmitButton>
                  </ActionForm>
                </>
              )}
            </div>
            {todays.length ? (
              <ol className="space-y-1 border-t border-line pt-3 text-sm">
                {todays.map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{KIND_LABEL[p.kind]}{p.source === "correction" ? <span className="ml-1 text-xs text-ink-muted">(corrected)</span> : null}</span>
                    <time className="tabular">{timeOf(p.occurred_at, p.zone)} <span className="text-xs text-ink-muted">{zoneCity(p.zone)}</span></time>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="This week" description={`Times are local time where each project is (now ${zoneCity(todayTz)})`} />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {days.map((d) => (
                <tr key={d} className={d === today ? "bg-brass-soft/40" : undefined}>
                  <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`))}</th>
                  <td className="px-4 py-2 text-right tabular sm:px-5">{byDay[d] ? minutesLabel(byDay[d]) : "—"}</td>
                </tr>
              ))}
              <tr className="font-semibold"><th scope="row" className="px-4 py-2 text-left sm:px-5">Total</th><td className="px-4 py-2 text-right tabular sm:px-5">{minutesLabel(weekTotal)}</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Missed a punch?" description="Request a correction. Your manager approves it and the change is logged." />
          <ActionForm action={requestCorrection} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <input type="hidden" name="membership_id" value={ctx.membership.id} />
            <input type="hidden" name="timezone" value={todayTz} />
            <SelectField label="What" name="kind" defaultValue="clock_in">
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectField>
            <TextField label="Date" name="date" type="date" required defaultValue={today} max={today} />
            <TextField label="Time" name="time" type="time" required hint={`${zoneCity(todayTz)} time`} />
            <TextField label="Reason" name="reason" required maxLength={500} placeholder="Forgot to clock out" />
            <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Sending…">Request correction</SubmitButton></div>
          </ActionForm>
          {corrections?.length ? (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {corrections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <span>{KIND_LABEL[c.kind]} at {timeOf(c.occurred_at, todayTz)} on {dateOf(c.occurred_at, todayTz)}{c.review_note ? <span className="block text-xs text-ink-muted">“{c.review_note}”</span> : null}</span>
                  <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "danger" : "warn"}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        {canTeam ? (
          <Panel>
            <PanelHeader title="Your team right now" description="People with activity in the last 36 hours." />
            {teamRows.length ? (
              <ul className="divide-y divide-line">
                {teamRows.map(({ p, st, since }) => (
                  <li key={p.membershipId} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <PersonLabel id={p.userId} name={p.name} src={p.avatarUrl} sub={p.jobTitle} />
                    <span className="text-right text-sm">
                      <Badge tone={st === "in" ? "ok" : st === "break" ? "warn" : "neutral"}>{st === "in" ? "Working" : st === "break" ? "Break" : "Out"}</Badge>
                      <span className="block text-xs text-ink-muted">since {timeOf(since!, companyTz)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No recent activity" />
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
