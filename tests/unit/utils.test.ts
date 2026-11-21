import { describe, expect, it } from "vitest";
import { hueFor, initials, safeNextPath } from "@/lib/utils";
import { friendlyDbError } from "@/lib/errors";

describe("initials", () => {
  it.each([
    ["Ana-Maria Popescu", "AP"],
    ["alex", "A"],
    ["  ", "?"],
    [null, "?"],
    ["Ştefan Ionescu", "ŞI"],
  ])("%s → %s", (name, expected) => expect(initials(name)).toBe(expected));
});

describe("hueFor", () => {
  it("is stable and in range", () => {
    expect(hueFor("abc")).toBe(hueFor("abc"));
    expect(hueFor("x")).toBeGreaterThanOrEqual(0);
    expect(hueFor("x")).toBeLessThan(360);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/o/acme/people", "/o/acme/people"],
    ["/o/acme?x=1#a", "/o/acme?x=1#a"],
    ["https://evil.example", "/"],
    ["//evil.example/x", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    [undefined, "/"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input as string | undefined)).toBe(expected));
});

describe("friendlyDbError", () => {
  it("passes through our guard messages", () => {
    expect(friendlyDbError({ code: "42501", message: "You cannot change your own role assignments" })).toBe(
      "You cannot change your own role assignments",
    );
  });
  it("hides RLS internals", () => {
    expect(friendlyDbError({ code: "42501", message: 'new row violates row-level security policy for table "x"' })).toBe(
      "You don't have permission to do that.",
    );
  });
  it("hides unknown errors", () => {
    expect(friendlyDbError({ code: "XX000", message: "internal detail" })).toMatch(/Something went wrong/);
  });
});
