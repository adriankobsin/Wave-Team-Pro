import { describe, expect, it } from "vitest";
import { minutesByDayProject, minutesByDayZoned, projectSessionsFrom, punchZones, timeOf, zoneCity, zoneOfProject } from "@/lib/time";

const zones = new Map([["th", "Asia/Bangkok"], ["sg", "Asia/Singapore"], ["fr", "Europe/Paris"]]);
const punch = (kind: "clock_in" | "clock_out", at: string, project_id: string | null = null) => ({ kind, occurred_at: at, project_id });

describe("project time zones", () => {
  it("falls back to the company zone without a project zone", () => {
    expect(zoneOfProject("th", zones, "Europe/London")).toBe("Asia/Bangkok");
    expect(zoneOfProject("unknown", zones, "Europe/London")).toBe("Europe/London");
    expect(zoneOfProject(null, zones, "Europe/London")).toBe("Europe/London");
  });

  it("shows the same instant in each project's local time", () => {
    const at = "2026-11-17T02:00:00Z";
    expect(timeOf(at, zoneOfProject("th", zones, "Europe/London"))).toBe("09:00");
    expect(timeOf(at, zoneOfProject("sg", zones, "Europe/London"))).toBe("10:00");
    expect(timeOf(at, zoneOfProject("fr", zones, "Europe/London"))).toBe("03:00");
  });

  it("gives every punch of a session the zone of its project", () => {
    const punches = [punch("clock_in", "2026-11-17T01:00:00Z", "th"), { kind: "break_start" as const, occurred_at: "2026-11-17T05:00:00Z" }, punch("clock_out", "2026-11-17T10:00:00Z")];
    expect(punchZones(punches, zones, "Europe/London")).toEqual(["Asia/Bangkok", "Asia/Bangkok", "Asia/Bangkok"]);
  });

  it("buckets a session on the day it starts where the project is", () => {
    // 18:30 UTC on the 16th is already the 17th (01:30) in Bangkok.
    const sessions = projectSessionsFrom([punch("clock_in", "2026-11-16T18:30:00Z", "th"), punch("clock_out", "2026-11-16T20:30:00Z")]);
    expect(Object.keys(minutesByDayZoned(sessions, zones, "Europe/London"))).toEqual(["2026-11-17"]);
    expect(Object.keys(minutesByDayZoned(sessions, undefined, "Europe/London"))).toEqual(["2026-11-16"]);
    expect([...minutesByDayProject(sessions, "Europe/London", zones).keys()]).toEqual(["2026-11-17|th"]);
  });

  it("names a zone by its city", () => {
    expect(zoneCity("Asia/Phnom_Penh")).toBe("Phnom Penh");
  });
});
