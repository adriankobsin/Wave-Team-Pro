import { describe, expect, it } from "vitest";
import { groupedZones, offsetOf, zoneLabel } from "@/lib/timezones";

describe("time zone picker", () => {
  it("groups zones by region with UTC offsets", () => {
    const g = Object.fromEntries(groupedZones().map((x) => [x.group, x.zones.map((z) => z.value)]));
    expect(g["Europe"]).toContain("Europe/London");
    expect(g["Europe"]).toContain("Europe/Amsterdam");
    expect(g["Southeast Asia"]).toEqual(expect.arrayContaining(["Asia/Bangkok", "Asia/Singapore", "Asia/Phnom_Penh"]));
    expect(g["Asia"]).toContain("Asia/Tokyo");
    expect(g["Asia"]).not.toContain("Asia/Bangkok");
    expect(g["Middle East"]).toContain("Asia/Dubai");
    expect(g["Americas"]).toEqual(expect.arrayContaining(["America/New_York", "America/Los_Angeles"]));
  });
  it("labels with the offset", () => {
    expect(offsetOf("Asia/Bangkok")).toBe("+07:00");
    expect(zoneLabel("Asia/Singapore")).toBe("(UTC+08:00) Singapore");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("(UTC-03:00) Argentina / Buenos Aires");
  });
});
