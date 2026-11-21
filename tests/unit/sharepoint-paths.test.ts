import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, cleanSegment, dateVars, isoWeek, renderPath, siteLookupPath, templateProblems, versioned, weekRangeLabel } from "@/lib/sharepoint/paths";

describe("SharePoint paths", () => {
  it("computes ISO weeks, including year boundaries", () => {
    expect(isoWeek("2026-10-19")).toEqual({ year: 2026, week: 43 });
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
  });

  it("labels week ranges", () => {
    expect(weekRangeLabel("2026-10-19")).toBe("19-25 Oct");
    expect(weekRangeLabel("2026-09-28")).toBe("28 Sep-4 Oct");
    expect(weekRangeLabel("2025-12-29")).toBe("29 Dec 2025-4 Jan 2026");
  });

  it("renders the default layout for each company", () => {
    const vars = { company: "Acme (UK)", ...dateVars({ date: "2026-10-14", today: "2026-10-20" }), employee: "Jane Smith", merchant: "Farnell", expense_date: "2026-10-14", total: "74.50", currency: "GBP", ext: "pdf" };
    expect(renderPath("Wave Team Pro/{company}", DEFAULT_TEMPLATES.receipt, vars))
      .toBe("Wave Team Pro/Acme (UK)/2026/Expenses/10 October/Receipts/2026-10-14 Farnell 74.50 GBP - Jane Smith.pdf");
    const wk = { company: "Acme Singapore", ...dateVars({ weekStart: "2026-10-19", today: "2026-10-26" }), employee: "Sam Lee" };
    expect(renderPath("Wave Team Pro/{company}", DEFAULT_TEMPLATES.weekly_timesheets, wk))
      .toBe("Wave Team Pro/Acme Singapore/2026/Timesheets/Weekly - all staff/2026-W43 (19-25 Oct) All staff.xlsx");
    expect(renderPath("Wave Team Pro/{company}", DEFAULT_TEMPLATES.employee_timesheet, wk))
      .toBe("Wave Team Pro/Acme Singapore/2026/Timesheets/By employee/Sam Lee/2026-W43 (19-25 Oct) Sam Lee.xlsx");
  });

  it("keeps values from adding folders or using forbidden characters", () => {
    expect(renderPath("Root", "{merchant}.pdf", { merchant: "A/B: C*D?" })).toBe("Root/A-B- C-D-.pdf");
    expect(renderPath("Root", "../{x}/a", {})).toBe("Root/-/-/a");
    expect(cleanSegment("  .hidden. ")).toBe("hidden");
    expect(cleanSegment("CON")).toBe("CON-");
    expect(cleanSegment("x".repeat(200) + ".xlsx").length).toBe(120);
    expect(cleanSegment("x".repeat(200) + ".xlsx").endsWith(".xlsx")).toBe(true);
  });

  it("adds versions before the extension", () => {
    expect(versioned("a/b/Report.xlsx", 1)).toBe("a/b/Report.xlsx");
    expect(versioned("a/b/Report.xlsx", 2)).toBe("a/b/Report (v2).xlsx");
    expect(versioned("Report", 3)).toBe("Report (v3)");
  });

  it("validates templates", () => {
    expect(templateProblems("{year}/{nope}.xlsx")).toEqual(["Unknown placeholder {nope}"]);
    expect(templateProblems("../x")).toContain("“..” isn't allowed");
    expect(templateProblems(DEFAULT_TEMPLATES.xero_card)).toEqual([]);
  });

  it("turns site addresses into Graph lookups", () => {
    expect(siteLookupPath("https://AcmeGroup.sharepoint.com/sites/Finance/")).toBe("acmegroup.sharepoint.com:/sites/Finance");
    expect(siteLookupPath("https://acmegroup.sharepoint.com/sites/Finance/Shared%20Documents/Forms/AllItems.aspx")).toBe("acmegroup.sharepoint.com:/sites/Finance");
    expect(siteLookupPath("https://acmegroup.sharepoint.com")).toBe("acmegroup.sharepoint.com");
    expect(siteLookupPath("https://evil.example.com/sites/x")).toBeNull();
  });
});
