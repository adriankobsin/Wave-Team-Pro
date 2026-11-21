import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { createShift, deleteShift } from "@/server/actions/workforce";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, dateOf, isDateString, timeOf, todayIn, weekDays, weekStart } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ week?: string; mine?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const tz = ctx.profile.timezone;
  const today = todayIn(tz);
  const wk = weekStart(isDateString(sp.week) ? sp.week : today);
  const days = weekDays(wk);
  const supabase = await createClient();
  const [people, { data: shifts }, { data: projects }] = await Promise.all([
    listPeople(ctx.org.id),
    supabase.from("shifts").select("id, membership_id, starts_at, ends_at, break_minutes, location, notes, project_id")
      .eq("organization_id", ctx.org.id)
      .gte("starts_at", new Date(Date.parse(`${addDays(wk, -1)}T00:00:00Z`)).toISOString())
      .lt("starts_at", new Date(Date.parse(`${addDays(wk, 8)}T00:00:00Z`)).toISOString())
      .order("starts_at"),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id).in("status", ["planning", "active"]).order("name"),
  ]);
  const canManage = ctx.perms.has("attendance.view.all") || ctx.perms.hasAnyScope("attendance.view.team");
  const onlyMine = sp.mine === "1";
  const rows = people.filter((p) => !onlyMine || p.membershipId === ctx.membership.id);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const base = `/o/${ctx.org.slug}/schedule`;
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description={`Week of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${wk}T00:00:00Z`))} · times in ${tz.replaceAll("_", " ")}`}
        actions={
          <div className="flex items-center gap-2">
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, -7)}${onlyMine ? "&mine=1" : ""}`} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}${onlyMine ? "?mine=1" : ""}`}>This week</Link>
            <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(wk, 7)}${onlyMine ? "&mine=1" : ""}`} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>
            <Link className={buttonClass("ghost", "sm")} href={`${base}?week=${wk}${onlyMine ? "" : "&mine=1"}`}>{onlyMine ? "Everyone" : "Only me"}</Link>
          </div>
        }
      />
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-48 px-3 py-2 text-left font-medium text-ink-muted">Person</th>
              {days.map((d) => (
                <th key={d} scope="col" className={cn("px-2 py-2 text-left font-medium", d === today ? "text-ink" : "text-ink-muted")}>{fmtDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.membershipId} className={p.membershipId === ctx.membership.id ? "bg-brass-soft/30" : undefined}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-2"><Avatar id={p.userId} name={p.name} src={p.avatarUrl} size="xs" /> <span className="truncate">{p.name}</span></span>
                </th>
                {days.map((d) => {
                  const mine = (shifts ?? []).filter((s) => s.membership_id === p.membershipId && dateOf(s.starts_at, tz) === d);
                  return (
                    <td key={d} className={cn("px-1.5 py-1.5 align-top", d === today && "bg-panel-sunk/60")}>
                      {mine.map((s) => (
                        <div key={s.id} className="mb-1 rounded border border-line bg-panel px-1.5 py-1 text-xs">
                          <p className="font-medium tabular">{timeOf(s.starts_at, tz)}–{timeOf(s.ends_at, tz)}</p>
                          {s.location || s.project_id ? <p className="truncate text-ink-muted">{s.project_id ? projectName.get(s.project_id) : s.location}</p> : null}
                          {canManage && p.membershipId !== ctx.membership.id ? (
                            <InlineActionForm action={deleteShift} confirm="Remove this shift?">
                              <input type="hidden" name="id" value={s.id} />
                              <button type="submit" className="text-[0.6875rem] text-ink-muted underline">Remove</button>
                            </InlineActionForm>
                          ) : null}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {canManage ? (
        <Panel>
          <PanelHeader title="Add a shift" description="You can schedule people you supervise. Shifts ending earlier than they start run overnight." />
          <ActionForm action={createShift} className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4" resetOnSuccess>
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <input type="hidden" name="timezone" value={tz} />
            <SelectField label="Person" name="membership_id" required defaultValue="">
              <option value="" disabled>Choose</option>
              {people.filter((p) => p.membershipId !== ctx.membership.id).map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
            </SelectField>
            <TextField label="Date" name="date" type="date" required defaultValue={days.includes(today) ? today : wk} />
            <TextField label="Start" name="start" type="time" required defaultValue="08:00" />
            <TextField label="End" name="end" type="time" required defaultValue="17:00" />
            <TextField label="Break (minutes)" name="break_minutes" type="number" min={0} max={600} defaultValue={60} />
            <SelectField label="Repeat for" name="repeat_days" defaultValue="1">
              <option value="1">This day only</option>
              <option value="5">5 days</option>
              <option value="7">7 days</option>
            </SelectField>
            <SelectField label="Project" name="project_id" optional defaultValue="">
              <option value="">—</option>
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectField>
            <TextField label="Location" name="location" optional maxLength={160} placeholder="Marina, vessel, office" />
            <div className="sm:col-span-3 lg:col-span-4"><SubmitButton pendingLabel="Adding…">Add shift</SubmitButton></div>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
