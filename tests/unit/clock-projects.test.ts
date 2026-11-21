import { describe, expect, it, vi } from "vitest";
import { minutesByDayProject, projectSessionsFrom } from "@/lib/time";

vi.mock("server-only", () => ({}));

describe("clock-ins by project", () => {
  it("splits a day by project switch and keeps breaks out", () => {
    const s = projectSessionsFrom([
      { kind: "clock_in", occurred_at: "2026-10-20T06:00:00Z", project_id: "nl" },
      { kind: "break_start", occurred_at: "2026-10-20T10:30:00Z" },
      { kind: "break_end", occurred_at: "2026-10-20T11:00:00Z" },
      { kind: "clock_out", occurred_at: "2026-10-20T11:30:00.000Z" },
      { kind: "clock_in", occurred_at: "2026-10-20T11:30:00.001Z", project_id: "uk" },
      { kind: "clock_out", occurred_at: "2026-10-20T14:30:00Z" },
    ]);
    const m = minutesByDayProject(s, "Europe/Amsterdam");
    expect(m.get("2026-10-20|nl")).toBe(300); // 5.5 h minus 30 min break
    expect(m.get("2026-10-20|uk")).toBe(180);
  });

  it("measures a running session up to now and attributes it to its start day in the company's zone", () => {
    const s = projectSessionsFrom([{ kind: "clock_in", occurred_at: "2026-10-20T23:30:00Z", project_id: null }], new Date("2026-10-21T01:30:00Z"));
    expect(s[0].end).toBeNull();
    expect(minutesByDayProject(s, "Asia/Bangkok").get("2026-10-21|")).toBe(120);
  });
});

describe("PDF reports", () => {
  it("writes a PDF and survives characters Helvetica can't draw", async () => {
    const { PdfReport, pdfSafe } = await import("@/lib/export/pdf");
    expect(pdfSafe("Somchai สมชาย – €5")).toBe("Somchai ????? - ?5");
    const r = await PdfReport.create("footer");
    r.title("Mia Jansen — timesheet", "Week of 19 Oct");
    r.table([{ label: "Project", width: 40 }, { label: "Mon", width: 10, align: "right" }], Array.from({ length: 80 }, (_, i) => [`Row ${i}`, i]));
    const bytes = await r.bytes();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
