import { describe, expect, it } from "vitest";
import { classifyDay, leaveCategory, type DayInput } from "@/lib/attendance-calendar";

const base: DayInput = { date: "2026-10-14", today: "2026-10-21", joined: "2026-01-01", workedMinutes: 0, loggedHours: 0, leave: null, holiday: null, scheduled: false };
const day = (o: Partial<DayInput>) => classifyDay({ ...base, ...o });

describe("attendance calendar", () => {
  it("colours worked, absent and days off", () => {
    expect(day({ workedMinutes: 300 })).toBe("worked");
    expect(day({ loggedHours: 7.5 })).toBe("worked");
    expect(day({})).toBe("absent"); // past Wednesday with nothing
    expect(day({ date: "2026-10-18" })).toBe("day_off"); // Sunday
    expect(day({ date: "2026-10-18", scheduled: true })).toBe("absent"); // planned Sunday shift missed
  });

  it("maps leave types to colours", () => {
    expect(day({ leave: { type: "Sick leave", status: "approved" } })).toBe("sick");
    expect(day({ leave: { type: "Annual leave", status: "approved" } })).toBe("annual");
    expect(day({ leave: { type: "Unpaid leave", status: "approved" } })).toBe("other_leave");
    expect(day({ leave: { type: "Annual leave", status: "pending" } })).toBe("pending_leave");
    expect(leaveCategory("Medical appointment")).toBe("sick");
  });

  it("handles holidays, today, the future and before joining", () => {
    expect(day({ holiday: "Bank holiday" })).toBe("holiday");
    expect(day({ date: "2026-10-21" })).toBe("today");
    expect(day({ date: "2026-10-28" })).toBe("future");
    expect(day({ date: "2026-10-28", leave: { type: "Annual leave", status: "approved" } })).toBe("annual");
    expect(day({ joined: "2026-10-20" })).toBe("not_employed");
  });
});
