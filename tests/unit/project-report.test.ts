import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const report = {
  project: { name: "Harbourside Hotel", code: "HHW", company: "Acme Systems UK", site: "Canary Wharf", country: "United Kingdom", status: "Active", manager: "James", start: "2026-10-01", end: "2026-12-20", budgetHours: 1200, budgetAmount: 185000, budgetCurrency: "GBP", description: "Wi-Fi and IPTV" },
  approvedHours: 412.5, waitingHours: 38,
  tasks: [
    { title: "Install APs floor 9", assignees: "Tom, Liam", status: "In progress", priority: "High", due: "2026-11-03", overdue: true, outcome: "", reportedBy: "", reportedAt: "", outcomeNote: "", checklist: "1/3", notes: 2, photos: 4, setBy: "James", created: "2026-10-20", completed: "" },
    { title: "Fix casting", assignees: "Grace", status: "Done", priority: "Urgent", due: "2026-10-30", overdue: false, outcome: "Not completed", reportedBy: "Grace", reportedAt: "2026-10-30", outcomeNote: "Waiting on the hotel's firewall change", checklist: "", notes: 0, photos: 0, setBy: "James", created: "2026-10-25", completed: "2026-10-30" },
  ],
  counts: { total: 2, todo: 0, inProgress: 1, done: 1, overdue: 1, notCompleted: 1 },
  people: [{ person: "Tom", approved: 40, waiting: 8, draft: 0 }],
  expenses: [{ date: "2026-11-01", person: "Tom", merchant: "Screwfix", category: "Materials", total: 86.4, currency: "GBP", status: "submitted" }],
  log: [{ date: "2026-11-04", time: "09:15", kind: "Delivery received", title: "40 access points", supplier: "CEF", reference: "PO-1182", amount: 2140.5, currency: "GBP", by: "Liam", details: "Stored in plant room B", files: 2 }],
  generated: "2026-11-05 10:00 (Asia/Singapore)",
};

describe("project report", () => {
  it("builds an Excel workbook with summary, tasks, log, hours and expenses", async () => {
    const { projectReportWorkbook } = await import("@/server/services/project-report");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await projectReportWorkbook(report) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Tasks", "Project log", "Hours by person", "Expenses"]);
    expect(wb.getWorksheet("Tasks")!.getRow(3).getCell(7).value).toBe("Not completed");
    expect(wb.getWorksheet("Project log")!.getRow(2).getCell(5).value).toBe("CEF");
  });

  it("builds a PDF", async () => {
    const { projectReportPdf } = await import("@/server/services/project-report");
    const pdf = await PDFDocument.load(await projectReportPdf(report));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
