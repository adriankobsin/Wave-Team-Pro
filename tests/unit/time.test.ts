import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateOf, daysInMonth, isoWeekday, minutesByDay, sessionsFrom, weekStart, zonedToUtc } from "@/lib/time";

describe("calendar helpers", () => {
  it("computes ISO weeks", () => {
    expect(isoWeekday("2026-10-25")).toBe(7);
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
  it("adds days and months across boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(daysInMonth("2028-02-10")).toBe(29);
  });
});

describe("time zones", () => {
  it("converts wall-clock time to UTC including DST", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "Europe/London")).toBe("2026-12-01T09:00:00.000Z");
    expect(zonedToUtc("2026-10-21", "08:00", "Asia/Bangkok")).toBe("2026-10-21T01:00:00.000Z");
    // Day of the autumn clock change in London (25 Oct 2026).
    expect(zonedToUtc("2026-10-25", "12:00", "Europe/London")).toBe("2026-10-25T12:00:00.000Z");
  });
  it("finds the local calendar date of an instant", () => {
    expect(dateOf("2026-10-20T20:00:00Z", "Asia/Bangkok")).toBe("2026-10-21");
    expect(dateOf("2026-10-20T20:00:00Z", "Europe/London")).toBe("2026-10-20");
  });
});

describe("attendance sessions", () => {
  it("subtracts breaks and handles overnight shifts", () => {
    const s = sessionsFrom([
      { kind: "clock_in", occurred_at: "2026-10-20T22:00:00Z" },
      { kind: "break_start", occurred_at: "2026-10-21T01:00:00Z" },
      { kind: "break_end", occurred_at: "2026-10-21T01:30:00Z" },
      { kind: "clock_out", occurred_at: "2026-10-21T06:00:00Z" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].workedMinutes).toBe(7.5 * 60);
    expect(s[0].breakMinutes).toBe(30);
    expect(minutesByDay(s, "Europe/London")).toEqual({ "2026-10-20": 450 });
  });
  it("measures an open session to now and ignores stray punches", () => {
    const s = sessionsFrom(
      [
        { kind: "clock_out", occurred_at: "2026-10-21T07:00:00Z" },
        { kind: "clock_in", occurred_at: "2026-10-21T08:00:00Z" },
        { kind: "break_start", occurred_at: "2026-10-21T10:00:00Z" },
      ],
      new Date("2026-10-21T10:15:00Z"),
    );
    expect(s).toEqual([{ start: "2026-10-21T08:00:00.000Z", end: null, breakMinutes: 15, workedMinutes: 120 }]);
  });
});
