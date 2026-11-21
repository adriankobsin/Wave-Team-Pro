import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { aiConfig, extractReceipt, ExtractionError } from "@/lib/ai/provider";
import { draftFromReading, suggestTaxRate, type ReceiptExtraction } from "@/lib/ai/receipt-schema";

const MAX_ATTEMPTS = 3;
const STALE_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(event: Record<string, unknown>) {
  // Telemetry only: never the receipt contents.
  console.log(JSON.stringify({ level: "info", scope: "ai.receipt", ...event }));
}

async function rollUpStatus(expenseId: string) {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("expense_ai_extractions").select("status").eq("expense_id", expenseId);
  const s = new Set((rows ?? []).map((r) => r.status));
  const status = !s.size ? "none" : s.has("processing") ? "processing" : s.has("pending") ? "pending" : s.has("failed") ? "failed" : s.has("done") ? "done" : "skipped";
  await admin.from("expenses").update({ extraction_status: status }).eq("id", expenseId);
}

/**
 * Durable background job: each receipt has an expense_ai_extractions row that is claimed
 * atomically (so two runners never process the same file), retried with backoff on transient
 * errors, and parked as "failed" after MAX_ATTEMPTS (the dead-letter state, retryable by hand).
 */
export async function runExtractions(expenseId: string) {
  const admin = createAdminClient();
  const cfg = aiConfig();
  const { data: rows } = await admin.from("expense_ai_extractions").select("id, file_id, status, attempts, started_at").eq("expense_id", expenseId);
  for (const row of rows ?? []) {
    if (!cfg) {
      await admin.from("expense_ai_extractions").update({ status: "skipped", error: "Automatic reading is not configured" }).eq("id", row.id).eq("status", "pending");
      continue;
    }
    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    for (let attempt = row.attempts; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: claimed } = await admin
        .from("expense_ai_extractions")
        .update({ status: "processing", attempts: attempt + 1, started_at: new Date().toISOString(), provider: cfg.provider, model: cfg.model })
        .eq("id", row.id)
        .eq("attempts", attempt)
        .or(`status.eq.pending,and(status.eq.processing,started_at.lt.${staleBefore})`)
        .select("id")
        .maybeSingle();
      if (!claimed) break;
      await rollUpStatus(expenseId);
      try {
        const { data: file } = await admin.from("files").select("storage_path, mime_type").eq("id", row.file_id).single();
        if (!file) throw new ExtractionError("Receipt file is missing", false);
        const { data: blob, error } = await admin.storage.from("files").download(file.storage_path);
        if (error || !blob) throw new ExtractionError("Receipt file could not be read", true);
        const out = await extractReceipt(cfg, { bytes: Buffer.from(await blob.arrayBuffer()), mime: file.mime_type });
        log({ ok: true, provider: cfg.provider, model: cfg.model, ms: out.ms, input_tokens: out.usage?.input, output_tokens: out.usage?.output });
        await admin.from("expense_ai_extractions").update({ status: "done", result: out.data, error: null, completed_at: new Date().toISOString() }).eq("id", row.id);
        await applyReading(expenseId, out.data);
        break;
      } catch (e) {
        const err = e instanceof ExtractionError ? e : new ExtractionError("Unexpected error while reading", true);
        log({ ok: false, provider: cfg.provider, model: cfg.model, attempt: attempt + 1, error: err.message });
        const last = !err.retryable || attempt + 1 >= MAX_ATTEMPTS;
        await admin.from("expense_ai_extractions").update({ status: last ? "failed" : "pending", error: err.message.slice(0, 500) }).eq("id", row.id);
        if (last) break;
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  await rollUpStatus(expenseId);
}

async function applyReading(expenseId: string, reading: ReceiptExtraction) {
  const admin = createAdminClient();
  const { data: e } = await admin.from("expenses").select("*").eq("id", expenseId).single();
  if (!e || !["draft", "rejected"].includes(e.status)) return;
  const fill = draftFromReading(reading);
  const upd: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fill)) if (e[k] === null || e[k] === undefined || e[k] === "") upd[k] = v;
  if (reading.payment_hint.value === "cash" && e.payment_method === "personal") upd.payment_method = "cash";
  if (reading.is_receipt && reading.document_type !== "other") {
    const [{ data: org }, { data: rates }] = await Promise.all([
      admin.from("organizations").select("country, base_currency").eq("id", e.organization_id).single(),
      admin.from("tax_rates").select("id, name, rate, reclaimable, active").eq("organization_id", e.organization_id),
    ]);
    if (!e.tax_rate_id && org) {
      const rate = suggestTaxRate(reading, (rates ?? []).map((t) => ({ ...t, rate: Number(t.rate) })), { country: org.country, currency: org.base_currency });
      if (rate) upd.tax_rate_id = rate;
    }
    // A printed card ending that matches a company card held by this person marks it as a card payment.
    if (reading.card_last4 && !e.card_id) {
      const { data: card } = await admin.from("company_cards").select("id").eq("organization_id", e.organization_id)
        .eq("last4", reading.card_last4).eq("holder_membership_id", e.membership_id).eq("active", true).maybeSingle();
      if (card) {
        upd.card_id = card.id;
        upd.payment_method = "company_card";
        upd.reimbursable = false;
      }
    }
  }
  if (Object.keys(upd).length) await admin.from("expenses").update(upd).eq("id", expenseId);
  await admin.from("expense_events").insert({ organization_id: e.organization_id, expense_id: expenseId, actor_id: null, event: "extracted", changes: { filled: Object.keys(upd) } });
}

// ------------------------------------------------------------------ queries

export type ExpenseRow = {
  id: string;
  organization_id: string;
  membership_id: string;
  project_id: string | null;
  category_id: string | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
  expense_date: string | null;
  merchant: string | null;
  reference: string | null;
  tax_number: string | null;
  description: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  tip_amount: number | null;
  total: number | null;
  payment_method: string;
  reimbursable: boolean;
  no_receipt_reason: string | null;
  reporting_currency: string | null;
  fx_rate: number | null;
  fx_date: string | null;
  fx_source: string | null;
  reporting_total: number | null;
  extraction_status: string;
  duplicate_of: string | null;
  duplicate_override: boolean;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reimbursement_status: "not_required" | "pending" | "paid";
  reimbursed_at: string | null;
  reimbursement_reference: string | null;
  created_at: string;
  tax_rate_id: string | null;
  card_id: string | null;
  accounting_export_id: string | null;
  accounting_exported_at: string | null;
  receipts: { id: string; file_name: string; mime_type: string }[];
};

export type ExpenseFilters = {
  month?: string | null; // YYYY-MM
  status?: string | null;
  membershipId?: string | null;
  projectId?: string | null;
  categoryId?: string | null;
  currency?: string | null;
  reimbursement?: string | null;
  missingReceipt?: boolean;
  ids?: string[];
  limit?: number;
  from?: string | null;
  to?: string | null;
  exported?: boolean | null;
  paidBy?: "card" | "employee" | null;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Lists expenses the viewer may see (RLS decides), with their receipt files. */
export async function listExpenses(orgId: string, f: ExpenseFilters = {}, client?: SupabaseClient): Promise<ExpenseRow[]> {
  const supabase = client ?? (await createClient());
  let q = supabase.from("expenses").select("*").eq("organization_id", orgId);
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const [y, m] = f.month.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    q = q.gte("expense_date", `${f.month}-01`).lte("expense_date", end);
  }
  if (f.status === "any") {
    // no status filter
  } else if (f.status === "open") q = q.in("status", ["draft", "submitted", "rejected"]);
  else if (f.status) q = q.eq("status", f.status);
  else q = q.neq("status", "cancelled");
  if (f.from) q = q.gte("expense_date", f.from);
  if (f.to) q = q.lte("expense_date", f.to);
  if (f.exported === true) q = q.not("accounting_export_id", "is", null);
  if (f.exported === false) q = q.is("accounting_export_id", null);
  if (f.paidBy === "card") q = q.eq("payment_method", "company_card");
  if (f.paidBy === "employee") q = q.neq("payment_method", "company_card");
  if (f.membershipId) q = q.eq("membership_id", f.membershipId);
  if (f.projectId) q = q.eq("project_id", f.projectId);
  if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.currency) q = q.eq("currency", f.currency);
  if (f.reimbursement) q = q.eq("reimbursement_status", f.reimbursement);
  if (f.ids) q = q.in("id", f.ids.length ? f.ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("expense_date", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }).limit(f.limit ?? 2000);
  const rows = (data ?? []) as Omit<ExpenseRow, "receipts">[];
  const receipts = new Map<string, ExpenseRow["receipts"]>();
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.id);
    const { data: files } = await supabase.from("files").select("id, file_name, mime_type, context_id, created_at").eq("context_type", "expense").in("context_id", ids).order("created_at");
    for (const file of files ?? []) {
      const list = receipts.get(file.context_id) ?? [];
      list.push({ id: file.id, file_name: file.file_name, mime_type: file.mime_type });
      receipts.set(file.context_id, list);
    }
  }
  const out = rows.map((r) => ({
    ...r,
    subtotal: num(r.subtotal), tax_amount: num(r.tax_amount), tip_amount: num(r.tip_amount), total: num(r.total),
    fx_rate: num(r.fx_rate), reporting_total: num(r.reporting_total),
    receipts: receipts.get(r.id) ?? [],
  }));
  return f.missingReceipt ? out.filter((r) => !r.receipts.length) : out;
}
