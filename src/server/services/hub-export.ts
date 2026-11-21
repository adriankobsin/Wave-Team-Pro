import "server-only";
import ExcelJS from "exceljs";
import { safeText } from "@/lib/export/cells";
import { PdfReport } from "@/lib/export/pdf";
import { addLogo } from "@/lib/export/excel-logo";
import { addDays } from "@/lib/time";
import type { HubTimesheetRow } from "@/server/services/hub";
import { BRAND } from "@/lib/brand";

const STATUS = { none: "Not started", draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Returned" } as const;
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
type Logo = { png: Buffer; width: number; height: number } | null;

/** The whole group's week: one sheet with everyone, then one sheet per company. */
export async function hubWeekWorkbook(rows: HubTimesheetRow[], week: string, logo?: Logo): Promise<Buffer> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const companies = [...new Map(rows.map((r) => [r.company.id, r.company])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const sheet = (name: string, list: HubTimesheetRow[], withCompany: boolean) => {
    const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
    ws.addRow([`${name} — week of ${dayLabel(week)} to ${dayLabel(addDays(week, 6))}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    ws.addRow(["Person", ...(withCompany ? ["Company"] : []), ...days.map(dayLabel), "Total", "Status"]).font = { bold: true };
    for (const r of list) ws.addRow([safeText(r.name), ...(withCompany ? [safeText(r.company.name)] : []), ...r.perDay, r.hours, STATUS[r.status]]);
    ws.addRow(["Total", ...(withCompany ? [""] : []), ...days.map((_, i) => Math.round(list.reduce((n, r) => n + r.perDay[i], 0) * 100) / 100), Math.round(list.reduce((n, r) => n + r.hours, 0) * 100) / 100, ""]).font = { bold: true };
    ws.columns.forEach((col, i) => (col.width = i === 0 ? 28 : withCompany && i === 1 ? 26 : 12));
    addLogo(wb, ws, logo ?? null, withCompany ? 11 : 10);
  };
  sheet("All companies", rows, true);
  for (const c of companies) sheet(c.name, rows.filter((r) => r.company.id === c.id), false);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function hubWeekPdf(rows: HubTimesheetRow[], week: string, logo?: Logo): Promise<Buffer> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const pdf = await PdfReport.create(`${BRAND.product} · all companies · week of ${week}`, logo);
  const total = Math.round(rows.reduce((n, r) => n + r.hours, 0) * 100) / 100;
  pdf.title("Timesheets — all companies", `Week of ${dayLabel(week)} to ${dayLabel(addDays(week, 6))} · ${rows.length} timesheets · ${total.toFixed(2)} h`);
  const companies = [...new Map(rows.map((r) => [r.company.id, r.company])).values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of companies) {
    const list = rows.filter((r) => r.company.id === c.id);
    pdf.heading(c.name, `${list.length} people · ${(Math.round(list.reduce((n, r) => n + r.hours, 0) * 100) / 100).toFixed(2)} h`);
    pdf.table(
      [{ label: "Person", width: 44 }, ...days.map((d) => ({ label: dayLabel(d).split(" ")[0], width: 9, align: "right" as const })), { label: "Total", width: 11, align: "right" }, { label: "Status", width: 30 }],
      [...list.map((r) => [r.name, ...r.perDay, r.hours, STATUS[r.status]]), ["Total", ...days.map((_, i) => Math.round(list.reduce((n, r) => n + r.perDay[i], 0) * 100) / 100), Math.round(list.reduce((n, r) => n + r.hours, 0) * 100) / 100, ""]],
      { totalRow: true },
    );
  }
  if (!companies.length) pdf.text("No timesheets this week.");
  return pdf.bytes();
}
