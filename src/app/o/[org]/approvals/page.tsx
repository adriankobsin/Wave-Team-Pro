import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { reviewCorrection, reviewLeave, reviewTimesheet } from "@/server/actions/workforce";
import { reviewExpense } from "@/server/actions/expenses";
import { listExpenses } from "@/server/services/expenses";
import { formatMoney } from "@/lib/format";
import Link from "@/components/ui/link";
import { ReviewForm } from "@/components/ui/review-form";
import { PersonLabel } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { addDays, dateOf, timeOf } from "@/lib/time";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };

const KIND_LABEL: Record<string, string> = { clock_in: "Clock in", clock_out: "Clock out", break_start: "Break start", break_end: "Break end" };

export default async function ApprovalsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const tz = ctx.profile.timezone;
  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("my_pending_approvals", { p_org: ctx.org.id });
  const ids = (k: string) => ((pending ?? []) as { kind: string; id: string }[]).filter((p) => p.kind === k).map((p) => p.id);
  const tsIds = ids("timesheet");
  const lvIds = ids("leave");
  const crIds = ids("correction");
  const exIds = ids("expense");
  const expenses = exIds.length ? await listExpenses(ctx.org.id, { ids: exIds, status: "submitted" }) : [];
  const [people, { data: sheets }, { data: entries }, { data: leave }, { data: types }, { data: corrections }, { data: projects }] = await Promise.all([
    listPeople(ctx.org.id, { includeInactive: true }),
    tsIds.length ? supabase.from("timesheets").select("id, membership_id, week_start, submitted_at").in("id", tsIds).order("week_start") : Promise.resolve({ data: [] as never[] }),
    tsIds.length ? supabase.from("timesheet_entries").select("timesheet_id, work_date, project_id, hours, category, description, is_overtime").in("timesheet_id", tsIds).order("work_date") : Promise.resolve({ data: [] as never[] }),
    lvIds.length ? supabase.from("leave_requests").select("id, membership_id, leave_type_id, start_date, end_date, start_half, end_half, days, created_at").in("id", lvIds).order("start_date") : Promise.resolve({ data: [] as never[] }),
    supabase.from("leave_types").select("id, name").eq("organization_id", ctx.org.id),
    crIds.length ? supabase.from("attendance_corrections").select("id, membership_id, kind, occurred_at, reason, created_at").in("id", crIds).order("created_at") : Promise.resolve({ data: [] as never[] }),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id),
  ]);
  const byMembership = new Map(people.map((p) => [p.membershipId, p]));
  const typeName = new Map((types ?? []).map((t) => [t.id, t.name]));
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const Who = ({ m, sub }: { m: string; sub?: string }) => {
    const p = byMembership.get(m);
    return <PersonLabel id={p?.userId ?? m} name={p?.name ?? "Former colleague"} src={p?.avatarUrl} sub={sub ?? p?.jobTitle} />;
  };
  const total = (pending ?? []).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" description={total ? `${total} waiting for you` : "Nothing is waiting for you."} />

      <Panel>
        <PanelHeader title={`Timesheets (${tsIds.length})`} />
        {(sheets ?? []).length ? (
          <ul className="divide-y divide-line">
            {(sheets ?? []).map((s) => {
              const rows = (entries ?? []).filter((e) => e.timesheet_id === s.id);
              const hours = rows.reduce((n, e) => n + Number(e.hours), 0);
              const overtime = rows.filter((e) => e.is_overtime).reduce((n, e) => n + Number(e.hours), 0);
              return (
                <li key={s.id} className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Who m={s.membership_id} />
                    <span className="text-sm">
                      {fmt(s.week_start)} – {fmt(addDays(s.week_start, 6))} · <strong className="tabular">{hours.toFixed(2)} h</strong>{overtime ? ` (${overtime.toFixed(2)} h overtime)` : ""}
                    </span>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-ink-muted">{rows.length} entries</summary>
                    <table className="mt-2 w-full">
                      <tbody className="divide-y divide-line">
                        {rows.map((e, i) => (
                          <tr key={i}>
                            <td className="py-1 pr-2 whitespace-nowrap">{fmt(e.work_date)}</td>
                            <td className="py-1 pr-2">{e.project_id ? projectName.get(e.project_id) : "—"}</td>
                            <td className="py-1 pr-2 text-ink-muted">{e.category}{e.description ? ` — ${e.description}` : ""}</td>
                            <td className="py-1 text-right tabular">{Number(e.hours).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  <ReviewForm action={reviewTimesheet} id={s.id} rejectNeedsNote rejectLabel="Return for changes" />
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No timesheets to review" />
        )}
      </Panel>

      <Panel>
        <PanelHeader title={`Leave requests (${lvIds.length})`} />
        {(leave ?? []).length ? (
          <ul className="divide-y divide-line">
            {(leave ?? []).map((r) => (
              <li key={r.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Who m={r.membership_id} />
                  <span className="text-sm">
                    <strong>{typeName.get(r.leave_type_id)}</strong> · {fmt(r.start_date)}{r.start_half ? " pm" : ""} – {fmt(r.end_date)}{r.end_half ? " am" : ""} · {Number(r.days)} days
                  </span>
                </div>
                <ReviewForm action={reviewLeave} id={r.id} rejectLabel="Decline" />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No leave requests to review" />
        )}
      </Panel>

      <Panel>
        <PanelHeader title={`Expenses (${exIds.length})`} />
        {expenses.length ? (
          <ul className="divide-y divide-line">
            {expenses.map((e) => (
              <li key={e.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Who m={e.membership_id} />
                  <span className="text-sm">
                    <Link href={`/o/${ctx.org.slug}/expenses/${e.id}`} className="font-medium underline-offset-4 hover:underline">{e.merchant}</Link>
                    {" · "}{e.expense_date} · <strong className="tabular">{e.total !== null && e.currency ? formatMoney(e.total, e.currency) : "—"}</strong>
                    {!e.receipts.length ? " · no receipt" : ""}{e.duplicate_override ? " · possible duplicate" : ""}
                  </span>
                </div>
                {e.description ? <p className="text-sm text-ink-muted">“{e.description}”</p> : null}
                <ReviewForm action={reviewExpense} id={e.id} rejectNeedsNote rejectLabel="Return for changes" />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No expenses to review" />
        )}
      </Panel>

      <Panel>
        <PanelHeader title={`Attendance corrections (${crIds.length})`} />
        {(corrections ?? []).length ? (
          <ul className="divide-y divide-line">
            {(corrections ?? []).map((c) => (
              <li key={c.id} className="space-y-3 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Who m={c.membership_id} sub={`Requested ${formatDateTime(c.created_at, tz)}`} />
                  <span className="text-sm"><strong>{KIND_LABEL[c.kind]}</strong> at {timeOf(c.occurred_at, tz)} on {fmt(dateOf(c.occurred_at, tz))}</span>
                </div>
                <p className="text-sm text-ink-muted">“{c.reason}”</p>
                <ReviewForm action={reviewCorrection} id={c.id} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No corrections to review" />
        )}
      </Panel>
    </div>
  );
}
