import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { cancelLeave, requestLeave } from "@/server/actions/workforce";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, addMonths, daysInMonth, isDateString, isoWeekday, monthStart, todayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leave" };

const TONE = { pending: "warn", approved: "ok", rejected: "danger", cancelled: "neutral" } as const;

export default async function LeavePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ month?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.hasAnyScope("leave.request") && !ctx.perms.hasAnyScope("leave.approve")) {
    return <AccessDenied message="Leave isn't enabled for your role." hint="Ask an administrator." />;
  }
  const tz = ctx.profile.timezone;
  const today = todayIn(tz);
  const month = monthStart(isDateString(sp.month) ? sp.month : today);
  const monthEnd = addDays(addMonths(month, 1), -1);
  const year = Number(today.slice(0, 4));
  const supabase = await createClient();
  const [{ data: balances }, { data: types }, { data: mine }, { data: absences }, { data: holidays }, people] = await Promise.all([
    supabase.rpc("leave_balances", { p_org: ctx.org.id, p_membership: ctx.membership.id, p_year: year }),
    supabase.from("leave_types").select("id, name, color, requires_note").eq("organization_id", ctx.org.id).eq("active", true).order("name"),
    supabase.from("leave_requests").select("id, leave_type_id, start_date, end_date, start_half, end_half, days, status, review_note, created_at").eq("membership_id", ctx.membership.id).order("start_date", { ascending: false }).limit(20),
    supabase.rpc("team_absences", { p_org: ctx.org.id, p_from: month, p_to: monthEnd }),
    supabase.from("public_holidays").select("holiday_date, name").eq("organization_id", ctx.org.id).gte("holiday_date", month).lte("holiday_date", monthEnd),
    listPeople(ctx.org.id),
  ]);
  const typeName = new Map((types ?? []).map((t) => [t.id, t]));
  const byUser = new Map(people.map((p) => [p.userId, p]));
  const away = (absences ?? []) as { membership_id: string; user_id: string; start_date: string; end_date: string; status: string }[];
  const awayPeople = [...new Set(away.map((a) => a.user_id))].map((id) => byUser.get(id)).filter(Boolean) as typeof people;
  const holidayOn = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => addDays(month, i));
  const base = `/o/${ctx.org.slug}/leave`;
  const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const canRequest = ctx.perms.hasAnyScope("leave.request");

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Book time off. Your manager approves it; reasons are visible only to you and HR." />
      {canRequest ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {((balances ?? []) as { leave_type_id: string; name: string; color: string; allowance: number | null; taken: number; pending: number; remaining: number | null }[]).map((b) => (
            <Panel key={b.leave_type_id}>
              <div className="p-4">
                <p className="flex items-center gap-2 text-sm text-ink-muted"><span className="size-2.5 rounded-full" style={{ background: b.color }} aria-hidden />{b.name} {year}</p>
                {b.remaining !== null ? (
                  <p className="display tabular mt-1 text-3xl font-semibold">{Number(b.remaining)} <span className="text-base font-normal text-ink-muted">of {Number(b.allowance)} days left</span></p>
                ) : (
                  <p className="display tabular mt-1 text-3xl font-semibold">{Number(b.taken)} <span className="text-base font-normal text-ink-muted">days taken</span></p>
                )}
                {Number(b.pending) ? <p className="text-xs text-ink-muted">{Number(b.pending)} days pending approval</p> : null}
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      <div className={canRequest ? "grid gap-6 lg:grid-cols-[1fr_1.4fr]" : ""}>
        {canRequest ? (
          <Panel className="h-fit">
            <PanelHeader title="Request leave" />
            <ActionForm action={requestLeave} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <div className="sm:col-span-2">
                <SelectField label="Type" name="leave_type_id" required defaultValue={types?.[0]?.id ?? ""}>
                  {(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.requires_note ? " (note required)" : ""}</option>)}
                </SelectField>
              </div>
              <TextField label="First day" name="start_date" type="date" required defaultValue={today} />
              <TextField label="Last day" name="end_date" type="date" required defaultValue={today} />
              <CheckboxField label="Start after lunch" name="start_half" hint="Half day on the first day" />
              <CheckboxField label="Finish at lunch" name="end_half" hint="Half day on the last day" />
              <div className="sm:col-span-2">
                <TextAreaField label="Note" name="reason" optional rows={2} maxLength={1000} hint="Private: only you and HR can see it." />
              </div>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Sending…">Request leave</SubmitButton></div>
            </ActionForm>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title={`Who's away · ${new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`))}`}
            action={
              <div className="flex gap-1">
                <Link className={buttonClass("secondary", "sm")} href={`${base}?month=${addMonths(month, -1)}`} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
                <Link className={buttonClass("secondary", "sm")} href={`${base}?month=${addMonths(month, 1)}`} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link>
              </div>
            }
          />
          {awayPeople.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-panel px-3 py-2 text-left font-medium text-ink-muted">Person</th>
                    {days.map((d) => (
                      <th key={d} className={cn("w-6 px-0.5 py-2 text-center font-normal tabular", isoWeekday(d) > 5 || holidayOn.has(d) ? "text-ink-muted/50" : "text-ink-muted", d === today && "text-ink font-semibold")} title={holidayOn.get(d)}>
                        {Number(d.slice(8))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {awayPeople.map((p) => (
                    <tr key={p.userId} className="border-t border-line">
                      <th scope="row" className="sticky left-0 whitespace-nowrap bg-panel px-3 py-1.5 text-left font-normal">
                        <span className="flex items-center gap-2"><Avatar id={p.userId} name={p.name} src={p.avatarUrl} size="xs" />{p.name}</span>
                      </th>
                      {days.map((d) => {
                        const a = away.find((x) => x.user_id === p.userId && x.start_date <= d && x.end_date >= d);
                        const weekend = isoWeekday(d) > 5 || holidayOn.has(d);
                        return (
                          <td key={d} className="px-0.5 py-1.5">
                            {a && !weekend ? (
                              <span className={cn("block h-4 rounded-sm", a.status === "approved" ? "bg-ok" : "bg-brass/60")} title={`${p.name}: ${a.status}`} />
                            ) : (
                              <span className={cn("block h-4 rounded-sm", weekend ? "bg-panel-sunk" : "")} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="flex gap-4 px-4 py-2 text-xs text-ink-muted">
                <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-ok" /> Approved</span>
                <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-brass/60" /> Pending</span>
              </p>
            </div>
          ) : (
            <EmptyState title="Nobody is away this month" />
          )}
          {holidays?.length ? <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">Public holidays: {holidays.map((h) => `${fmt(h.holiday_date)} ${h.name}`).join(", ")}</p> : null}
        </Panel>
      </div>

      {canRequest ? (
        <Panel>
          <PanelHeader title="My requests" />
          {mine?.length ? (
            <ul className="divide-y divide-line">
              {mine.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span>
                    <span className="font-medium">{typeName.get(r.leave_type_id)?.name ?? "Leave"}</span>
                    <span className="block text-sm text-ink-muted">
                      {fmt(r.start_date)}{r.start_half ? " (pm)" : ""}{r.end_date !== r.start_date ? ` – ${fmt(r.end_date)}${r.end_half ? " (am)" : ""}` : r.end_half ? " (am)" : ""} · {Number(r.days)} {Number(r.days) === 1 ? "day" : "days"}
                      {r.review_note ? ` · “${r.review_note}”` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                    {r.status === "pending" || (r.status === "approved" && r.start_date > today) ? (
                      <InlineActionForm action={cancelLeave} confirm="Cancel this leave request?">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" variant="ghost" pendingLabel="Cancelling…">Cancel</SubmitButton>
                      </InlineActionForm>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No leave requested yet" />
          )}
        </Panel>
      ) : null}
    </div>
  );
}
