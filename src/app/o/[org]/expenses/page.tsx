import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { Paperclip, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listExpenses, type ExpenseRow } from "@/server/services/expenses";
import { markReimbursed } from "@/server/actions/expenses";
import { totalsByCurrency } from "@/lib/export/cells";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { AccessDenied, Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { EXPENSE_STATUS, EXPENSE_TONE, READING_LABEL, REIMBURSE_LABEL } from "@/components/expenses/labels";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";
import { todayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Expenses" };

type SP = { view?: string; month?: string; status?: string; person?: string; project?: string; category?: string; currency?: string; reimbursement?: string; missing?: string };

export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<SP> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const p = ctx.perms;
  const canCreate = p.has("expenses.create");
  const canSeeOthers = p.has("expenses.view.all") || p.hasAnyScope("expenses.view.team") || p.has("reimbursements.manage") || p.has("expenses.export");
  const canReview = p.hasAnyScope("expenses.approve");
  if (!canCreate && !canSeeOthers && !canReview) return <AccessDenied message="Expenses aren't enabled for your role." hint="Ask an administrator." />;

  const views = [
    ...(canCreate ? [{ key: "mine", label: "My expenses" }] : []),
    ...(canReview ? [{ key: "review", label: "To review" }] : []),
    ...(canSeeOthers ? [{ key: "all", label: "All expenses" }] : []),
  ];
  const view = views.some((v) => v.key === sp.view) ? sp.view! : views[0].key;
  const base = `/o/${ctx.org.slug}/expenses`;
  const tz = ctx.profile.timezone;
  const supabase = await createClient();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : view === "all" ? todayIn(tz).slice(0, 7) : null;

  let rows: ExpenseRow[] = [];
  if (view === "mine") {
    rows = await listExpenses(ctx.org.id, { membershipId: ctx.membership.id, month, status: sp.status || "any", limit: 300 });
  } else if (view === "review") {
    const { data: pending } = await supabase.rpc("my_pending_approvals", { p_org: ctx.org.id });
    const ids = ((pending ?? []) as { kind: string; id: string }[]).filter((x) => x.kind === "expense").map((x) => x.id);
    rows = await listExpenses(ctx.org.id, { ids, status: "submitted" });
  } else {
    rows = await listExpenses(ctx.org.id, {
      month, status: sp.status || null, membershipId: sp.person || null, projectId: sp.project || null, categoryId: sp.category || null,
      currency: sp.currency || null, reimbursement: sp.reimbursement || null, missingReceipt: sp.missing === "1",
    });
  }
  const [people, { data: projects }, { data: categories }, { data: exports }] = await Promise.all([
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.from("projects").select("id, name").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("expense_categories").select("id, name").eq("organization_id", ctx.org.id).order("name"),
    view === "all" && p.has("expenses.export")
      ? supabase.from("expense_exports").select("id, actor_id, format, filters, row_count, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const byMembership = new Map(people.map((x) => [x.membershipId, x]));
  const byUser = new Map(people.map((x) => [x.userId, x]));
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const projName = new Map((projects ?? []).map((c) => [c.id, c.name]));
  const totals = totalsByCurrency(rows.filter((r) => r.status !== "cancelled"), (r) => r.currency, (r) => r.total);
  const reimbursable = rows.filter((r) => r.status === "approved" && r.reimbursement_status === "pending" && r.membership_id !== ctx.membership.id);
  const canReimburse = p.has("reimbursements.manage") && view === "all";
  const exportQuery = new URLSearchParams(Object.entries({ month: month ?? "", status: sp.status || "approved", person: sp.person ?? "", project: sp.project ?? "", category: sp.category ?? "", currency: sp.currency ?? "", reimbursement: sp.reimbursement ?? "" }).filter(([, v]) => v)).toString();
  const reading = rows.some((r) => r.extraction_status === "pending" || r.extraction_status === "processing");

  const list = (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const who = byMembership.get(r.membership_id);
        return (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            {canReimburse && reimbursable.includes(r) ? (
              <input type="checkbox" name="ids" value={r.id} form="reimburse-form" aria-label={`Select ${r.merchant ?? "expense"}`} className="mt-1.5 size-4" />
            ) : null}
            <Link href={`${base}/${r.id}`} className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.merchant ?? "Untitled expense"}</span>
                <span className="block text-sm text-ink-muted">
                  {[r.expense_date, view !== "mine" ? who?.name ?? "Former colleague" : null, r.category_id ? catName.get(r.category_id) : null, r.project_id ? projName.get(r.project_id) : null].filter(Boolean).join(" · ")}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={EXPENSE_TONE[r.status]}>{EXPENSE_STATUS[r.status]}</Badge>
                  {r.reimbursement_status !== "not_required" ? <Badge tone={r.reimbursement_status === "paid" ? "ok" : "neutral"}>{REIMBURSE_LABEL[r.reimbursement_status]}</Badge> : null}
                  {r.duplicate_override ? <Badge tone="warn">Possible duplicate</Badge> : null}
                  {!r.receipts.length ? <Badge tone="neutral">No receipt</Badge> : <span className="inline-flex items-center gap-0.5 text-xs text-ink-muted"><Paperclip className="size-3" aria-hidden />{r.receipts.length}</span>}
                  {r.status === "draft" && READING_LABEL[r.extraction_status] ? <span className="text-xs text-ink-muted">{READING_LABEL[r.extraction_status]}</span> : null}
                </span>
              </span>
              <span className="text-right">
                <span className="tabular block font-semibold">{r.total !== null && r.currency ? formatMoney(r.total, r.currency) : "—"}</span>
                {r.reporting_total !== null && r.reporting_currency !== r.currency ? <span className="tabular block text-xs text-ink-muted">{formatMoney(r.reporting_total, r.reporting_currency!)}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-6">
      {reading ? <LiveRefresh table="expenses" channel={`expenses-${ctx.membership.id}`} filter={`membership_id=eq.${ctx.membership.id}`} /> : null}
      <PageHeader
        title="Expenses"
        description="Snap a receipt, check the details, submit. Approved claims are reimbursed and exported for bookkeeping."
        actions={
          <>
            {canCreate ? <Link href={`${base}/new`} className={buttonClass("primary")}><Plus className="size-4" aria-hidden /> New expense</Link> : null}
            {p.has("expenses.export") || p.has("reimbursements.manage") ? <Link href={`${base}/bookkeeping`} className={buttonClass("secondary")}>Bookkeeping</Link> : null}
            {p.has("expenses.export") || p.has("reimbursements.manage") ? <Link href={`${base}/cards`} className={buttonClass("secondary")}>Company cards</Link> : null}
            {p.has("expenses.export") || p.has("org.settings.manage") || p.has("reimbursements.manage") ? <Link href={`${base}/settings`} className={buttonClass("secondary")}>VAT & accounts</Link> : null}
          </>
        }
      />

      {views.length > 1 ? (
        <nav aria-label="Expense views" className="flex gap-1 overflow-x-auto border-b border-line">
          {views.map((v) => (
            <Link key={v.key} href={`${base}?view=${v.key}`} aria-current={v.key === view ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", v.key === view ? "border-brass font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink")}>
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {view === "all" ? (
        <Panel>
          <form method="get" className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5 sm:p-5">
            <input type="hidden" name="view" value="all" />
            <label className="text-sm">Month<input type="month" name="month" defaultValue={month ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2" /></label>
            <label className="text-sm">Status
              <select name="status" defaultValue={sp.status ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2">
                <option value="">All except withdrawn</option>
                {Object.entries(EXPENSE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-sm">Employee
              <select name="person" defaultValue={sp.person ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2">
                <option value="">Everyone</option>
                {people.map((x) => <option key={x.membershipId} value={x.membershipId}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Project
              <select name="project" defaultValue={sp.project ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2">
                <option value="">Any</option>
                {(projects ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Category
              <select name="category" defaultValue={sp.category ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2">
                <option value="">Any</option>
                {(categories ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Currency<input name="currency" maxLength={3} defaultValue={sp.currency ?? ""} placeholder="Any" className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2 uppercase" /></label>
            <label className="text-sm">Reimbursement
              <select name="reimbursement" defaultValue={sp.reimbursement ?? ""} className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2">
                <option value="">Any</option>
                <option value="pending">Due</option>
                <option value="paid">Paid</option>
                <option value="not_required">Not required</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="missing" value="1" defaultChecked={sp.missing === "1"} className="size-4" /> Missing receipt</label>
            <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-2">
              <button type="submit" className={buttonClass("secondary")}>Filter</button>
              <Link href={`${base}?view=all`} className="pb-2 text-sm text-ink-muted underline">Reset</Link>
            </div>
          </form>
          {p.has("expenses.export") ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
              <span className="text-sm text-ink-muted">Export {sp.status ? EXPENSE_STATUS[sp.status as keyof typeof EXPENSE_STATUS]?.toLowerCase() : "approved"} expenses{month ? ` for ${month}` : ""}:</span>
              <a href={`${base}/export?${exportQuery}&format=xlsx`} className={buttonClass("secondary", "sm")}>Excel</a>
              <a href={`${base}/export?${exportQuery}&format=zip`} className={buttonClass("secondary", "sm")}>Excel + receipts (ZIP)</a>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {totals.size ? (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([cur, amount]) => (
            <Panel key={cur}><div className="px-4 py-3"><p className="text-xs text-ink-muted">{rows.filter((r) => r.currency === cur && r.status !== "cancelled").length} in {cur}</p><p className="tabular text-lg font-semibold">{formatMoney(amount, cur)}</p></div></Panel>
          ))}
        </div>
      ) : null}

      <Panel>
        <PanelHeader title={views.find((v) => v.key === view)!.label} description={view === "review" ? "Expenses from your team waiting for your decision." : undefined} />
        {rows.length ? list : (
          <EmptyState title={view === "mine" ? "No expenses yet" : view === "review" ? "Nothing to review" : "No expenses match these filters"}>
            {view === "mine" && canCreate ? <Link href={`${base}/new`} className="underline">Add your first receipt</Link> : null}
          </EmptyState>
        )}
      </Panel>

      {canReimburse && reimbursable.length ? (
        <Panel>
          <PanelHeader title="Record reimbursement" description={`Tick approved expenses above (${reimbursable.length} due), then record the payment.`} />
          <ActionForm id="reimburse-form" action={markReimbursed} className="flex flex-wrap items-end gap-3 p-4 sm:p-5">
            <input type="hidden" name="organization_id" value={ctx.org.id} />
            <div className="min-w-48 flex-1"><TextField label="Payment reference" name="reference" optional maxLength={100} /></div>
            <SubmitButton pendingLabel="Saving…">Mark selected as reimbursed</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      {(exports ?? []).length ? (
        <Panel>
          <PanelHeader title="Recent exports" />
          <ul className="divide-y divide-line text-sm">
            {(exports ?? []).map((x) => (
              <li key={x.id} className="px-4 py-2 sm:px-5">
                {x.format.toUpperCase()} · {x.row_count} rows · {byUser.get(x.actor_id)?.name ?? "Former colleague"} · {formatDateTime(x.created_at, tz)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
