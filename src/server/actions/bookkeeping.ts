"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { lineFingerprint, parseStatement } from "@/lib/bookkeeping/csv";
import { ECB_CURRENCIES } from "@/lib/regions";
import { fileInBackground } from "@/server/services/sharepoint";

const optUuid = z.union([z.literal(""), uuid]).optional().transform((v) => v || null);
const optText = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const bool = z.literal("on").optional().transform((v) => v === "on");
const refresh = () => revalidatePath("/o/[org]", "layout");

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}

// ------------------------------------------------------------------- VAT rates

export async function saveTaxRate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, id: optUuid,
    name: z.string().trim().min(2, "Enter a name").max(60),
    rate: z.coerce.number().min(0).max(100),
    accounting_name: z.string().trim().min(1, "Enter the name used in Xero").max(80),
    reclaimable: bool, active: bool,
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, organization_id, ...t } = parsed.data;
  const { supabase } = await session();
  const { data, error } = id
    ? await supabase.from("tax_rates").update(t).eq("id", id).select("id")
    : await supabase.from("tax_rates").insert({ organization_id, ...t, active: true, position: 50 }).select("id");
  if (error || !data?.length) return { ok: false, error: error?.code === "23505" ? "A VAT rate with that name exists." : friendlyDbError(error, "You can't manage VAT rates.") };
  refresh();
  return { ok: true, message: "VAT rate saved." };
}

export async function saveAccountingSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid,
    bill_prefix: z.string().trim().regex(/^[A-Za-z0-9-]{1,12}$/, "Letters, numbers and dashes only"),
    bill_due_days: z.coerce.number().int().min(0).max(90),
    tracking_name: optText(40),
    default_account_code: optText(32),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { supabase } = await session();
  const { error } = await supabase.from("accounting_settings").upsert(parsed.data, { onConflict: "organization_id" });
  if (error) return { ok: false, error: friendlyDbError(error, "You can't change accounting settings.") };
  refresh();
  return { ok: true, message: "Accounting settings saved." };
}

// ----------------------------------------------------------------------- cards

export async function saveCard(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, id: optUuid,
    name: z.string().trim().min(2, "Enter a name").max(60),
    last4: z.string().trim().regex(/^\d{4}$/, "The last 4 digits only"),
    holder_membership_id: optUuid,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter code"),
    account_code: optText(32),
    active: bool,
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, organization_id, ...c } = parsed.data;
  const { supabase } = await session();
  const { data, error } = id
    ? await supabase.from("company_cards").update(c).eq("id", id).select("id")
    : await supabase.from("company_cards").insert({ organization_id, ...c, active: true }).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "You can't manage company cards.") };
  refresh();
  return { ok: true, message: "Card saved." };
}

export async function importStatement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, card_id: uuid,
    date_order: z.enum(["dmy", "mdy", "ymd"]),
    spend_sign: z.enum(["negative", "positive"]),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the form." };
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose the statement CSV file." };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "The CSV must be smaller than 2 MB." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!(await consumeRateLimit(["card-import", userId], 30, 3600))) return { ok: false, error: "Too many imports. Try again later." };
  const { data: card } = await supabase.from("company_cards").select("id, currency").eq("id", parsed.data.card_id).maybeSingle();
  if (!card) return { ok: false, error: "Card not found." };
  const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
  if (text.includes("\u0000")) return { ok: false, error: "That isn't a CSV text file. Export the statement as CSV." };
  const result = parseStatement(text, { dateOrder: parsed.data.date_order, spendSign: parsed.data.spend_sign, currency: card.currency });
  if (!result.lines.length) {
    return { ok: false, error: `No card spending found. ${result.skipped[0]?.reason ?? ""} Detected columns: ${Object.values(result.columns).join(", ") || "none"}.` };
  }
  if (result.lines.length > 2000) return { ok: false, error: "Import at most 2,000 lines at a time." };
  const { data: imp, error: impErr } = await supabase.from("card_imports").insert({
    organization_id: parsed.data.organization_id, card_id: card.id, file_name: file.name.slice(0, 200),
    row_count: result.lines.length, skipped_count: result.skipped.length, imported_by: userId,
  }).select("id").single();
  if (impErr || !imp) return { ok: false, error: friendlyDbError(impErr, "You can't import statements.") };
  const seen = new Map<string, number>();
  const rows = result.lines.map((l) => {
    const key = lineFingerprint(l, 0);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return {
      organization_id: parsed.data.organization_id, card_id: card.id, import_id: imp.id, txn_date: l.date,
      description: l.description, amount: l.amount, currency: l.currency, reference: l.reference, fingerprint: lineFingerprint(l, n),
    };
  });
  const { data: inserted, error } = await supabase.from("card_transactions").upsert(rows, { onConflict: "card_id,fingerprint", ignoreDuplicates: true }).select("id");
  if (error) {
    logServerError("cards.import", error);
    return { ok: false, error: friendlyDbError(error) };
  }
  const { data: matched } = await supabase.rpc("auto_match_card", { p_card: card.id });
  refresh();
  const added = inserted?.length ?? 0;
  return {
    ok: true,
    message: `Imported ${added} new line${added === 1 ? "" : "s"}${rows.length - added ? ` (${rows.length - added} already imported)` : ""}, matched ${matched ?? 0} to expenses.${result.skipped.length ? ` Skipped ${result.skipped.length} (payments, refunds or unreadable rows).` : ""}`,
  };
}

export async function autoMatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ card_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { data, error } = await supabase.rpc("auto_match_card", { p_card: parsed.data.card_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: `Matched ${data ?? 0} line${data === 1 ? "" : "s"}.` };
}

export async function cardLineAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    id: uuid, action: z.enum(["match", "unmatch", "ignore", "request"]),
    expense_id: optUuid, note: optText(300),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const d = parsed.data;
  const { supabase } = await session();
  const { error } = d.action === "request"
    ? await supabase.rpc("request_card_receipt", { p_txn: d.id })
    : await supabase.rpc("set_card_transaction", { p_txn: d.id, p_action: d.action, p_expense: d.expense_id, p_note: d.note });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: { match: "Matched.", unmatch: "Unmatched.", ignore: "Ignored.", request: "Receipt requested from the card holder." }[d.action] };
}

// ------------------------------------------------------------- month close

export async function setPeriod(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, month: z.string().regex(/^\d{4}-\d{2}$/), closed: z.enum(["1", "0"]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = await supabase.rpc("set_period_closed", { p_org: parsed.data.organization_id, p_month: `${parsed.data.month}-01`, p_closed: parsed.data.closed === "1" });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (parsed.data.closed === "1") fileInBackground(parsed.data.organization_id);
  refresh();
  return { ok: true, message: parsed.data.closed === "1" ? "Month closed. Claims dated in it can no longer be submitted or changed." : "Month reopened." };
}

export async function undoExport(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { data, error } = await supabase.rpc("undo_accounting_export", { p_export: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: `${data ?? 0} expenses can be exported again.` };
}

// ------------------------------------------------------------ country packs & FX

export async function loadTaxPack(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, country: z.string().regex(/^[A-Z]{2}$/) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a country." };
  const { supabase } = await session();
  const { data, error } = await supabase.rpc("load_tax_rate_pack", { p_org: parsed.data.organization_id, p_country: parsed.data.country });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: data ? `Added ${data} VAT rate${data === 1 ? "" : "s"}. Check the names match your Xero.` : "Those rates were already there." };
}

type FrankfurterSeries = { base?: string; rates?: Record<string, Record<string, number>> };

/**
 * Fetches European Central Bank reference rates (via the Frankfurter API) for every foreign
 * currency used by claims in the month that still have no conversion, then applies them.
 */
export async function fetchEcbRates(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a month." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!(await consumeRateLimit(["ecb-fetch", userId], 30, 3600))) return { ok: false, error: "Try again later." };
  const orgId = parsed.data.organization_id;
  const from = `${parsed.data.month}-01`;
  const end = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const to = end > today ? today : end;
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10); // covers weekends/holidays
  const { data: org } = await supabase.from("organizations").select("base_currency").eq("id", orgId).single();
  const base = org?.base_currency as string | undefined;
  if (!base) return { ok: false, error: "Company not found." };
  const { data: claims } = await supabase.from("expenses").select("currency").eq("organization_id", orgId)
    .in("status", ["submitted", "approved"]).is("reporting_total", null).gte("expense_date", from).lte("expense_date", end).neq("currency", base);
  const currencies = [...new Set((claims ?? []).map((c) => c.currency as string).filter(Boolean))];
  if (!currencies.length) return { ok: true, message: "Every claim this month already has an exchange rate." };
  const unsupported = currencies.filter((c) => !ECB_CURRENCIES.has(c) || !ECB_CURRENCIES.has(base));
  let added = 0;
  const failed: string[] = [];
  for (const cur of currencies.filter((c) => !unsupported.includes(c))) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(`https://api.frankfurter.dev/v1/${start}..${to}?base=${cur}&symbols=${base}`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FrankfurterSeries;
      const rows = Object.entries(json.rates ?? {})
        .map(([date, r]) => ({ date, rate: r?.[base] }))
        .filter((r): r is { date: string; rate: number } => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && typeof r.rate === "number" && r.rate > 0)
        .map((r) => ({ organization_id: orgId, from_currency: cur, to_currency: base, rate: r.rate, rate_date: r.date, source: "European Central Bank reference rate", created_by: userId }));
      if (!rows.length) throw new Error("no rates");
      const { data: ins, error } = await supabase.from("exchange_rates").upsert(rows, { onConflict: "organization_id,from_currency,to_currency,rate_date", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      added += ins?.length ?? 0;
    } catch (e) {
      logServerError("fx.ecb", e);
      failed.push(cur);
    }
  }
  await supabase.rpc("refresh_expense_fx", { p_org: orgId, p_from: from, p_to: end });
  refresh();
  const notes = [
    `Added ${added} daily rate${added === 1 ? "" : "s"} and converted the month’s claims.`,
    unsupported.length ? `${unsupported.join(", ")}: no ECB rate published — enter these by hand (e.g. from the National Bank of Cambodia for KHR).` : "",
    failed.length ? `Couldn't fetch ${failed.join(", ")} right now; try again later.` : "",
  ].filter(Boolean);
  if (failed.length && !added) return { ok: false, error: notes.join(" ") };
  return { ok: true, message: notes.join(" ") };
}
