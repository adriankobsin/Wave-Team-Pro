"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, type ActionResult } from "@/lib/errors";
import { DEFAULT_TEMPLATES, SHAREPOINT_KINDS, renderPath, siteLookupPath, templateProblems, type SharePointKind } from "@/lib/sharepoint/paths";
import { GraphError, ensureFolder, graphConfigured, resolveDrive } from "@/lib/sharepoint/graph";
import { enqueueManual, fileInBackground, runSharepointUploads } from "@/server/services/sharepoint";
import { weekStart } from "@/lib/time";

const refresh = () => revalidatePath("/o/[org]/admin/sharepoint", "page");

export async function saveSharePointSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const f = formObject(formData);
  const parsed = z.object({
    organization_id: uuid,
    site_url: z.string().trim().max(400).optional().default(""),
    library: z.string().trim().min(1, "Enter the library name").max(120),
    root_folder: z.string().trim().min(1, "Enter a folder").max(300),
  }).safeParse(f);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(await authorize(d.organization_id, "org.settings.manage"))) return { ok: false, error: "You don't have permission to change these settings." };
  const enabled = formData.get("enabled") === "on";
  if (d.site_url && !siteLookupPath(d.site_url)) return { ok: false, error: "The site address should look like https://yourcompany.sharepoint.com/sites/Finance", fieldErrors: { site_url: ["Not a SharePoint site address"] } };
  if (enabled && !d.site_url) return { ok: false, error: "Enter the SharePoint site address before switching filing on.", fieldErrors: { site_url: ["Required"] } };
  const rootProblems = templateProblems(d.root_folder);
  if (rootProblems.length) return { ok: false, error: `Company folder: ${rootProblems.join(", ")}`, fieldErrors: { root_folder: rootProblems } };

  const templates: Record<string, string> = {};
  const disabled: SharePointKind[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const kind of SHAREPOINT_KINDS) {
    const t = String(formData.get(`tpl_${kind}`) ?? "").trim();
    if (t && t !== DEFAULT_TEMPLATES[kind]) {
      const problems = templateProblems(t);
      if (problems.length) fieldErrors[`tpl_${kind}`] = problems;
      templates[kind] = t;
    }
    if (formData.get(`on_${kind}`) !== "on") disabled.push(kind);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Some file names need fixing.", fieldErrors };

  const supabase = await createClient();
  const { data: before } = await supabase.from("sharepoint_settings").select("site_url, library").eq("organization_id", d.organization_id).maybeSingle();
  const row = { enabled, site_url: d.site_url || null, library: d.library, root_folder: d.root_folder, templates, disabled_kinds: disabled, updated_at: new Date().toISOString() };
  const { error } = before
    ? await supabase.from("sharepoint_settings").update(row).eq("organization_id", d.organization_id)
    : await supabase.from("sharepoint_settings").insert({ organization_id: d.organization_id, ...row });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (before && (before.site_url !== row.site_url || before.library !== row.library)) {
    // Different site or library: forget the cached Microsoft ids (only the server may write them).
    await createAdminClient().from("sharepoint_settings").update({ site_id: null, drive_id: null, verified_at: null }).eq("organization_id", d.organization_id);
  }
  refresh();
  return { ok: true, message: enabled ? "Saved. Files will be filed to SharePoint from now on." : "Saved. Filing is switched off." };
}

const orgRef = z.object({ organization_id: uuid });

export async function testSharePoint(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = orgRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await authorize(parsed.data.organization_id, "org.settings.manage"))) return { ok: false, error: "You don't have permission to do that." };
  if (!graphConfigured()) return { ok: false, error: "Microsoft 365 isn't connected yet: MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET must be added in Vercel (then redeploy)." };
  const admin = createAdminClient();
  const [{ data: s }, { data: org }] = await Promise.all([
    admin.from("sharepoint_settings").select("site_url, library, root_folder").eq("organization_id", parsed.data.organization_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", parsed.data.organization_id).single(),
  ]);
  if (!s?.site_url) return { ok: false, error: "Save the SharePoint site address first." };
  try {
    const d = await resolveDrive(s.site_url, s.library);
    const root = renderPath(s.root_folder, "", { company: org?.name ?? "Company" });
    await ensureFolder(d.driveId, root);
    await admin.from("sharepoint_settings").update({ site_id: d.siteId, drive_id: d.driveId, verified_at: new Date().toISOString() }).eq("organization_id", parsed.data.organization_id);
    refresh();
    return { ok: true, message: `Connected to “${d.siteName}” → ${s.library}. The folder “${root}” is ready.` };
  } catch (e) {
    return { ok: false, error: e instanceof GraphError ? e.message : "Couldn't reach Microsoft 365. Try again in a minute." };
  }
}

export async function runSharePointNow(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = orgRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await authorize(parsed.data.organization_id, "org.settings.manage"))) return { ok: false, error: "You don't have permission to do that." };
  const s = await runSharepointUploads({ orgId: parsed.data.organization_id, budgetMs: 50_000, limit: 100 });
  refresh();
  const parts = [`${s.done} uploaded`, s.retry ? `${s.retry} will retry` : "", s.failed ? `${s.failed} failed` : "", s.skipped ? `${s.skipped} skipped` : ""].filter(Boolean);
  return { ok: true, message: s.done + s.retry + s.failed + s.skipped ? parts.join(", ") + "." : "Nothing waiting to upload." };
}

export async function retrySharePointUpload(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sharepoint_retry", { p_upload: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  fileInBackground(parsed.data.organization_id);
  refresh();
  return { ok: true, message: "Queued again." };
}

const manualKinds = ["weekly_timesheets", "weekly_report", "monthly_report", "leave_register", "expense_month"] as const;

export async function fileNow(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    organization_id: uuid,
    kind: z.enum(manualKinds),
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose what to file and the week or month." };
  const d = parsed.data;
  if (!(await authorize(d.organization_id, "org.settings.manage"))) return { ok: false, error: "You don't have permission to do that." };
  const weekly = d.kind === "weekly_timesheets" || d.kind === "weekly_report";
  if (weekly && !d.week) return { ok: false, error: "Pick a day in the week to file.", fieldErrors: { week: ["Required"] } };
  if (!weekly && !d.month) return { ok: false, error: "Pick the month to file.", fieldErrors: { month: ["Required"] } };
  const admin = createAdminClient();
  const { data: s } = await admin.from("sharepoint_settings").select("enabled").eq("organization_id", d.organization_id).maybeSingle();
  if (!s?.enabled) return { ok: false, error: "Switch SharePoint filing on first." };
  const ref = weekly
    ? { week_start: weekStart(d.week!) }
    : d.kind === "leave_register"
      ? { to: new Date(Date.UTC(Number(d.month!.slice(0, 4)), Number(d.month!.slice(5, 7)), 0)).toISOString().slice(0, 10) }
      : { month: d.month };
  await enqueueManual(admin, d.organization_id, d.kind, ref);
  fileInBackground(d.organization_id);
  refresh();
  return { ok: true, message: "Queued. It will appear in the log below within a minute." };
}
