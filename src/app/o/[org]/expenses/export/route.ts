import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/server/services/people";
import { listExpenses } from "@/server/services/expenses";
import { buildExpenseWorkbook } from "@/server/services/expense-workbook";
import { csvField } from "@/lib/export/cells";
import { publicEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/errors";
import { getLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ZIP_BYTES = 250 * 1024 * 1024;

export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("expenses.export")) return new NextResponse("You don't have permission to export expenses.", { status: 403 });
  if (!(await consumeRateLimit(["expense-export", ctx.userId], 30, 3600))) return new NextResponse("Export limit reached. Try again later.", { status: 429 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "zip" ? "zip" : "xlsx";
  const filters = {
    month: sp.get("month"),
    status: sp.get("status") || "approved",
    membershipId: sp.get("person"),
    projectId: sp.get("project"),
    categoryId: sp.get("category"),
    currency: sp.get("currency"),
    reimbursement: sp.get("reimbursement"),
  };
  const supabase = await createClient();
  const [rows, people, { data: projects }, { data: categories }] = await Promise.all([
    listExpenses(ctx.org.id, { ...filters, status: filters.status === "all" ? null : filters.status }),
    listPeople(ctx.org.id, { includeInactive: true }),
    supabase.from("projects").select("id, name, code, cost_center").eq("organization_id", ctx.org.id),
    supabase.from("expense_categories").select("id, name, accounting_code").eq("organization_id", ctx.org.id),
  ]);
  const base = publicEnv().APP_BASE_URL;
  const { xlsx, zipNames } = await buildExpenseWorkbook({
    supabase, org: ctx.org, rows, people,
    projects: (projects ?? []) as { id: string; name: string; code: string | null; cost_center: string | null }[],
    categories: (categories ?? []) as { id: string; name: string; accounting_code: string | null }[],
    filters, generatedBy: ctx.profile.display_name, appBaseUrl: base, format, logo: await getLogo(ctx.org.id),
  });

  const stamp = filters.month ?? new Date().toISOString().slice(0, 10);
  const baseName = `expenses-${ctx.org.slug}-${stamp}`;

  let body: Buffer;
  let type: string;
  let fileName: string;
  if (format === "zip") {
    const zip = new JSZip();
    zip.file(`${baseName}.xlsx`, xlsx);
    const manifest = ["expense_id,receipt_file,original_name,merchant,date,currency,total,status"];
    let bytes = xlsx.length;
    try {
      for (const r of rows) {
        const names = zipNames.get(r.id) ?? [];
        for (let i = 0; i < r.receipts.length; i++) {
          const f = r.receipts[i];
          const { data: row } = await supabase.from("files").select("storage_path").eq("id", f.id).maybeSingle();
          if (!row) continue;
          const { data: blob } = await supabase.storage.from("files").download(row.storage_path);
          if (!blob) continue;
          const buf = Buffer.from(await blob.arrayBuffer());
          bytes += buf.length;
          if (bytes > MAX_ZIP_BYTES) return new NextResponse("Too many receipts for one download. Narrow the filters (for example one month).", { status: 413 });
          zip.file(names[i], buf);
          manifest.push([r.id, names[i], f.file_name, r.merchant, r.expense_date, r.currency, r.total, r.status].map((v) => csvField(v as string | number | null)).join(","));
        }
      }
    } catch (e) {
      logServerError("expenses.export.zip", e);
      return new NextResponse("Couldn't collect the receipts. Try again.", { status: 500 });
    }
    zip.file("manifest.csv", manifest.join("\n"));
    body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    type = "application/zip";
    fileName = `${baseName}.zip`;
  } else {
    body = xlsx;
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileName = `${baseName}.xlsx`;
  }

  const { error: logErr } = await supabase.rpc("log_expense_export", { p_org: ctx.org.id, p_format: format, p_filters: filters, p_rows: rows.length });
  if (logErr) return new NextResponse("You don't have permission to export expenses.", { status: 403 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
