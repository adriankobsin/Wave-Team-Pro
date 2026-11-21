import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listExpenses } from "@/server/services/expenses";
import { prepareXero, xeroCsv } from "@/server/services/xero-export";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isDateString, todayIn } from "@/lib/time";
import { fileInBackground } from "@/server/services/sharepoint";

export const dynamic = "force-dynamic";

/**
 * Xero files for approved claims in a date range:
 *  kind=bills  → employee-paid claims as Bills (one per person and currency)
 *  kind=card   → one company card's spending as a pre-coded bank statement
 * With mark=1 the included claims are marked as exported so they aren't exported twice.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("expenses.export")) return new NextResponse("You don't have permission to export to accounting.", { status: 403 });
  if (!(await consumeRateLimit(["xero-export", ctx.userId], 60, 3600))) return new NextResponse("Export limit reached. Try again later.", { status: 429 });
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") === "card" ? "card" : "bills";
  const from = isDateString(sp.get("from")) ? sp.get("from")! : null;
  const to = isDateString(sp.get("to")) ? sp.get("to")! : null;
  const cardId = sp.get("card");
  const includeExported = sp.get("include_exported") === "1";
  const mark = sp.get("mark") === "1";
  if (kind === "card" && !cardId) return new NextResponse("Choose a card.", { status: 400 });

  const supabase = await createClient();
  const [rows, { data: card }] = await Promise.all([
    listExpenses(ctx.org.id, { status: "approved", from, to, exported: includeExported ? null : false, paidBy: kind === "card" ? "card" : "employee" }),
    kind === "card" ? supabase.from("company_cards").select("id, name, last4, account_code").eq("id", cardId!).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (kind === "card" && !card) return new NextResponse("Card not found.", { status: 404 });
  const scoped = kind === "card" ? rows.filter((r) => r.card_id === cardId) : rows;
  const { lines, opts, problems } = await prepareXero(supabase, ctx.org, scoped, todayIn(ctx.profile.timezone));
  if (!lines.length) return new NextResponse("Nothing to export: no approved, unexported claims match these filters.", { status: 404 });
  if (problems.length && sp.get("force") !== "1") {
    return new NextResponse(
      `Not exported: ${problems.length} claim(s) need coding first.\n\n` +
        problems.slice(0, 50).map((x) => `- ${x.l.expenseDate} ${x.l.merchant} ${x.l.currency} ${x.l.total.toFixed(2)} (${x.l.employeeName}): ${x.p.join(", ")}`).join("\n") +
        "\n\nOpen Bookkeeping to fix them, or set a default account code in Categories & rates.",
      { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const csv = xeroCsv(kind, lines, opts);
  if (mark) {
    const { error } = await supabase.rpc("mark_accounting_export", {
      p_org: ctx.org.id, p_kind: kind === "card" ? "xero_card" : "xero_bills", p_ids: lines.map((l) => l.id),
      p_filters: { from, to, card: cardId },
    });
    if (error) return new NextResponse("Couldn't mark the claims as exported. Nothing was downloaded; try again.", { status: 500 });
    fileInBackground(ctx.org.id);
  }
  const name = kind === "card" ? `xero-card-${card!.last4}-${from ?? "all"}-${to ?? ""}.csv` : `xero-bills-${from ?? "all"}-${to ?? ""}.csv`;
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name.replace(/-+\.csv$/, ".csv")}"`, "cache-control": "private, no-store" },
  });
}
