"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadError, validateUpload, type ValidatedUpload } from "@/lib/files/validate";
import { storeFile } from "@/server/services/files";
import { runExtractions } from "@/server/services/expenses";
import { receiptExtraction } from "@/lib/ai/receipt-schema";
import { aiConfig } from "@/lib/ai/provider";
import { consumeRateLimit } from "@/lib/rate-limit";
import { fieldErrors, formObject, uuid } from "@/lib/validation/common";
import { isDateString } from "@/lib/time";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";
import { fileInBackground } from "@/server/services/sharepoint";

const MAX_RECEIPTS = 5;
const optUuid = z.union([z.literal(""), uuid]).optional().transform((v) => v || null);
const optText = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const optMoney = z
  .union([z.literal(""), z.coerce.number().min(0, "Can't be negative").max(10_000_000)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : Math.round(v * 100) / 100));
const optDate = z.union([z.literal(""), z.string().refine(isDateString, "Choose a date")]).optional().transform((v) => v || null);
const optCurrency = z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/, "Use a 3-letter code like GBP").optional().transform((v) => v || null);

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}
const refresh = () => revalidatePath("/o/[org]", "layout");

function receiptFiles(formData: FormData): File[] {
  return formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
}

async function validateAll(files: File[]): Promise<ValidatedUpload[] | string> {
  const out: ValidatedUpload[] = [];
  for (const f of files) {
    try {
      out.push(await validateUpload(f, "image-or-pdf"));
    } catch (e) {
      return e instanceof UploadError ? `${f.name}: ${e.message}` : `${f.name} couldn't be processed.`;
    }
  }
  return out;
}

/** Stores receipts against an expense and queues reading in the background. */
async function attachReceipts(opts: { orgId: string; userId: string; expenseId: string; uploads: ValidatedUpload[]; autoRead: boolean }) {
  const admin = createAdminClient();
  const queue = opts.autoRead && aiConfig() !== null;
  for (const upload of opts.uploads) {
    const stored = await storeFile({ orgId: opts.orgId, userId: opts.userId, context: "expense", contextId: opts.expenseId, upload });
    if (queue) {
      await admin.from("expense_ai_extractions").insert({ organization_id: opts.orgId, expense_id: opts.expenseId, file_id: stored.id });
    }
  }
  if (queue) {
    await admin.from("expenses").update({ extraction_status: "pending" }).eq("id", opts.expenseId);
    after(() => runExtractions(opts.expenseId));
  }
}

// ------------------------------------------------------------------- capture

const createSchema = z.object({
  organization_id: uuid,
  org_slug: z.string().regex(/^[a-z0-9-]+$/),
  project_id: optUuid,
  category_id: optUuid,
  description: optText(1000),
  auto_read: z.literal("on").optional(),
});

export async function createExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the form." };
  const d = parsed.data;
  const files = receiptFiles(formData);
  if (files.length > MAX_RECEIPTS) return { ok: false, error: `Attach up to ${MAX_RECEIPTS} files per expense.` };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!(await consumeRateLimit(["expense-create", userId], 60, 3600))) return { ok: false, error: "Too many expenses in a short time. Try again later." };
  const uploads = await validateAll(files);
  if (typeof uploads === "string") return { ok: false, error: uploads };

  const { data: membershipId } = await supabase.rpc("my_membership_id", { p_org: d.organization_id });
  if (!membershipId) return { ok: false, error: "You're not a member of this organization." };
  // Basic staff don't choose projects; management codes the expense.
  const { data: canChoose } = await supabase.rpc("has_permission", { p_org: d.organization_id, p_permission: "work.self_manage" });
  if (canChoose !== true) d.project_id = null;
  const { data: org } = await supabase.from("organizations").select("base_currency").eq("id", d.organization_id).single();
  const { data: exp, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: d.organization_id,
      membership_id: membershipId,
      project_id: d.project_id,
      category_id: d.category_id,
      description: d.description,
      currency: uploads.length ? null : (org?.base_currency ?? null),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !exp) return { ok: false, error: friendlyDbError(error, "You can't create expenses here.") };
  try {
    await attachReceipts({ orgId: d.organization_id, userId, expenseId: exp.id, uploads, autoRead: d.auto_read === "on" });
  } catch (e) {
    logServerError("expenses.create", e);
    return { ok: false, error: "The expense was created but a receipt couldn't be saved. Open it from your expenses and try again." };
  }
  refresh();
  redirect(`/o/${d.org_slug}/expenses/${exp.id}`);
}

export async function addReceipts(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expense_id: uuid, auto_read: z.literal("on").optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const files = receiptFiles(formData);
  if (!files.length) return { ok: false, error: "Choose a photo or PDF." };
  const { data: canEdit } = await supabase.rpc("can_edit_expense", { p_expense: parsed.data.expense_id });
  if (canEdit !== true) return { ok: false, error: "This expense can no longer be changed." };
  const { data: exp } = await supabase.from("expenses").select("organization_id").eq("id", parsed.data.expense_id).single();
  const { count } = await supabase.from("files").select("id", { count: "exact", head: true }).eq("context_type", "expense").eq("context_id", parsed.data.expense_id);
  if ((count ?? 0) + files.length > MAX_RECEIPTS) return { ok: false, error: `An expense can have up to ${MAX_RECEIPTS} files.` };
  if (!(await consumeRateLimit(["expense-upload", userId], 120, 3600))) return { ok: false, error: "Upload limit reached. Try again later." };
  const uploads = await validateAll(files);
  if (typeof uploads === "string") return { ok: false, error: uploads };
  try {
    await attachReceipts({ orgId: exp!.organization_id, userId, expenseId: parsed.data.expense_id, uploads, autoRead: parsed.data.auto_read === "on" });
  } catch (e) {
    logServerError("expenses.addReceipts", e);
    return { ok: false, error: "Upload failed. Try again." };
  }
  refresh();
  return { ok: true, message: "Receipt added." };
}

export async function removeReceipt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ file_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { data: file } = await supabase.from("files").select("id, context_type, context_id, storage_path").eq("id", parsed.data.file_id).maybeSingle();
  if (!file || file.context_type !== "expense") return { ok: false, error: "Receipt not found." };
  const { data: canEdit } = await supabase.rpc("can_edit_expense", { p_expense: file.context_id });
  if (canEdit !== true) return { ok: false, error: "This expense can no longer be changed." };
  const admin = createAdminClient();
  await admin.from("files").delete().eq("id", file.id);
  await admin.storage.from("files").remove([file.storage_path]);
  refresh();
  return { ok: true, message: "Receipt removed." };
}

export async function retryReading(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expense_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase, userId } = await session();
  const { data: canEdit } = await supabase.rpc("can_edit_expense", { p_expense: parsed.data.expense_id });
  if (canEdit !== true || !userId) return { ok: false, error: "This expense can no longer be changed." };
  if (!aiConfig()) return { ok: false, error: "Automatic reading isn't set up. Enter the details by hand." };
  if (!(await consumeRateLimit(["expense-retry", userId], 20, 3600))) return { ok: false, error: "Try again later." };
  const admin = createAdminClient();
  const { data: exp } = await admin.from("expenses").select("organization_id").eq("id", parsed.data.expense_id).single();
  const { data: files } = await admin.from("files").select("id").eq("context_type", "expense").eq("context_id", parsed.data.expense_id);
  for (const f of files ?? []) {
    await admin.from("expense_ai_extractions").upsert(
      { organization_id: exp!.organization_id, expense_id: parsed.data.expense_id, file_id: f.id, status: "pending", attempts: 0, error: null },
      { onConflict: "file_id" },
    );
  }
  await admin.from("expenses").update({ extraction_status: "pending" }).eq("id", parsed.data.expense_id);
  after(() => runExtractions(parsed.data.expense_id));
  refresh();
  return { ok: true, message: "Reading the receipt again…" };
}

// --------------------------------------------------------------------- edit

const editSchema = z.object({
  id: uuid,
  project_id: optUuid,
  category_id: optUuid,
  expense_date: optDate,
  merchant: optText(200),
  reference: optText(100),
  tax_number: optText(60),
  description: optText(1000),
  currency: optCurrency,
  subtotal: optMoney,
  tax_amount: optMoney,
  tip_amount: optMoney,
  total: optMoney,
  payment_method: z.enum(["personal", "company_card", "cash", "other"]),
  reimbursable: z.literal("on").optional().transform((v) => v === "on"),
  no_receipt_reason: optText(300),
  tax_rate_id: optUuid,
  card_id: optUuid,
});

export async function saveExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = editSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, ...rest } = parsed.data;
  const upd: Record<string, unknown> = { ...rest };
  // Only send optional selects that were on the form, so hidden ones don't clear stored values.
  if (!formData.has("tax_rate_id")) delete upd.tax_rate_id;
  if (!formData.has("card_id")) delete upd.card_id;
  if (!formData.has("project_id")) delete upd.project_id;
  if (rest.payment_method === "company_card") upd.reimbursable = false;
  else upd.card_id = null;
  const { supabase } = await session();
  if ("project_id" in upd) {
    const { data: own } = await supabase.from("expenses").select("organization_id").eq("id", id).maybeSingle();
    const { data: canChoose } = own ? await supabase.rpc("has_permission", { p_org: own.organization_id, p_permission: "work.self_manage" }) : { data: false };
    if (canChoose !== true) delete upd.project_id;
  }
  const { data, error } = await supabase.from("expenses").update(upd).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error, "This expense can no longer be changed.") };
  if (formData.get("intent") === "submit") {
    const { error: sErr } = await supabase.rpc("submit_expense", { p_id: id, p_confirm_repeat: formData.get("confirm_repeat") === "on" });
    if (sErr) {
      const msg = friendlyDbError(sErr);
      return { ok: false, error: msg.startsWith("DUPLICATE: ") ? msg.slice(11) : `Saved, but not submitted: ${msg}` };
    }
    refresh();
    return { ok: true, message: "Submitted for approval." };
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function cancelExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = await supabase.rpc("cancel_expense", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Expense withdrawn." };
}

// ------------------------------------------------------------------- review

export async function reviewExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = await supabase.rpc("review_expense", { p_id: parsed.data.id, p_approve: parsed.data.decision === "approve", p_note: parsed.data.note || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (parsed.data.decision === "approve") fileInBackground();
  refresh();
  return { ok: true, message: parsed.data.decision === "approve" ? "Approved." : "Returned for changes." };
}

export async function correctExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    id: uuid, category_id: optUuid, project_id: optUuid, expense_date: optDate, merchant: optText(200),
    currency: optCurrency, subtotal: optMoney, tax_amount: optMoney, total: optMoney,
    note: z.string().trim().min(3, "Say why you're correcting it").max(500),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const { supabase } = await session();
  const { error } = await supabase.rpc("correct_expense", {
    p_id: d.id, p_category: d.category_id, p_project: d.project_id, p_expense_date: d.expense_date, p_merchant: d.merchant,
    p_currency: d.currency, p_subtotal: d.subtotal, p_tax: d.tax_amount, p_total: d.total, p_note: d.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Correction saved and recorded in the history." };
}

export async function markReimbursed(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, reference: z.string().trim().max(100).optional() }).safeParse(formObject(formData));
  const ids = formData.getAll("ids").flatMap((v) => String(v).split(",")).filter((v) => uuid.safeParse(v).success);
  if (!parsed.success || !ids.length) return { ok: false, error: "Select at least one expense." };
  const { supabase } = await session();
  const { data, error } = await supabase.rpc("mark_expenses_reimbursed", { p_org: parsed.data.organization_id, p_ids: ids, p_reference: parsed.data.reference || null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: `${data ?? 0} expense${data === 1 ? "" : "s"} marked as reimbursed.` };
}

// ----------------------------------------------------------------- settings

export async function saveCategory(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid, id: optUuid,
    name: z.string().trim().min(2, "Enter a name").max(60),
    accounting_code: optText(32),
    receipt_required: z.literal("on").optional().transform((v) => v === "on"),
    active: z.literal("on").optional().transform((v) => v === "on"),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { id, organization_id, ...c } = parsed.data;
  const { supabase } = await session();
  const { data, error } = id
    ? await supabase.from("expense_categories").update(c).eq("id", id).select("id")
    : await supabase.from("expense_categories").insert({ organization_id, ...c, active: true }).select("id");
  if (error || !data?.length) return { ok: false, error: error?.code === "23505" ? "A category with that name exists." : friendlyDbError(error, "You can't manage categories.") };
  refresh();
  return { ok: true, message: "Category saved." };
}

export async function addExchangeRate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid,
    from_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter code"),
    to_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    rate: z.coerce.number().positive("Must be above zero").max(1_000_000),
    rate_date: z.string().refine(isDateString, "Choose a date"),
    source: z.string().trim().min(2, "Where is the rate from?").max(120),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (parsed.data.from_currency === parsed.data.to_currency) return { ok: false, error: "Choose a different currency." };
  const { supabase, userId } = await session();
  const { error } = await supabase.from("exchange_rates").insert({ ...parsed.data, created_by: userId });
  if (error) return { ok: false, error: error.code === "23505" ? "A rate for that pair and date already exists." : friendlyDbError(error, "You can't manage exchange rates.") };
  refresh();
  return { ok: true, message: "Rate added. It applies to expenses submitted or approved from now on." };
}

export async function deleteExchangeRate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase } = await session();
  const { error } = await supabase.from("exchange_rates").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------- bookkeeping

export async function codeExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, category_id: optUuid, tax_rate_id: optUuid, tax_amount: optMoney, card_id: optUuid, note: optText(500) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const { supabase } = await session();
  const { error } = await supabase.rpc("code_expense", { p_id: d.id, p_category: d.category_id, p_tax_rate: d.tax_rate_id, p_tax: d.tax_amount, p_card: d.card_id, p_note: d.note });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Coding saved." };
}

/** Creates a new draft for another receipt found in the same file, with its own copy of the file. */
export async function splitReceipt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expense_id: uuid, org_slug: z.string().regex(/^[a-z0-9-]+$/), index: z.coerce.number().int().min(0).max(9) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase, userId } = await session();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data: canEdit } = await supabase.rpc("can_edit_expense", { p_expense: parsed.data.expense_id });
  if (canEdit !== true) return { ok: false, error: "This expense can no longer be changed." };
  const { data: src } = await supabase.from("expenses").select("organization_id, membership_id, project_id, category_id, description, payment_method, card_id").eq("id", parsed.data.expense_id).single();
  const { data: readings } = await supabase.from("expense_ai_extractions").select("file_id, result").eq("expense_id", parsed.data.expense_id).eq("status", "done");
  let found: { file_id: string; r: { merchant: string | null; date: string | null; currency: string | null; total: number | null } } | null = null;
  let k = 0;
  for (const row of readings ?? []) {
    const p = receiptExtraction.safeParse(row.result);
    if (!p.success) continue;
    for (const r of p.data.other_receipts) {
      if (k === parsed.data.index) found = { file_id: row.file_id, r };
      k++;
    }
  }
  if (!src || !found) return { ok: false, error: "That receipt couldn't be found." };
  const { data: exp, error } = await supabase.from("expenses").insert({
    organization_id: src.organization_id, membership_id: src.membership_id, project_id: src.project_id, category_id: src.category_id,
    description: src.description, payment_method: src.payment_method, card_id: src.card_id,
    merchant: found.r.merchant, expense_date: found.r.date, currency: found.r.currency, total: found.r.total, created_by: userId,
  }).select("id").single();
  if (error || !exp) return { ok: false, error: friendlyDbError(error) };
  try {
    const admin = createAdminClient();
    const { data: file } = await admin.from("files").select("*").eq("id", found.file_id).single();
    const ext = file.storage_path.split(".").pop();
    const path = `${src.organization_id}/expense/${exp.id}/${crypto.randomUUID()}.${ext}`;
    const { error: cpErr } = await admin.storage.from("files").copy(file.storage_path, path);
    if (cpErr) throw cpErr;
    await admin.from("files").insert({
      organization_id: src.organization_id, storage_path: path, file_name: file.file_name, mime_type: file.mime_type,
      size_bytes: file.size_bytes, sha256: file.sha256, context_type: "expense", context_id: exp.id, uploaded_by: userId,
    });
  } catch (e) {
    logServerError("expenses.split", e);
  }
  refresh();
  redirect(`/o/${parsed.data.org_slug}/expenses/${exp.id}`);
}
