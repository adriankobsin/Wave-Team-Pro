import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const { filterPeople } = await import("@/server/services/people");

const base = {
  userId: "u",
  email: null,
  employeeNumber: null,
  status: "active" as const,
  managerMembershipId: null,
  managerName: null,
  roles: [],
  timezone: "UTC",
  startDate: null,
  avatarUrl: null,
  avatarFullUrl: null,
};
const people = [
  { ...base, membershipId: "1", name: "Ana Popescu", jobTitle: "Bookkeeper", departmentId: "fin", departmentName: "Finance", teams: [] },
  { ...base, membershipId: "2", name: "Bob Tanaka", jobTitle: "AV Engineer", departmentId: "eng", departmentName: "Engineering", teams: [{ id: "t1", name: "Refit crew", isLead: false }] },
];

describe("filterPeople", () => {
  it("matches name, title and team case-insensitively", () => {
    expect(filterPeople(people, { text: "refit" }).map((p) => p.name)).toEqual(["Bob Tanaka"]);
    expect(filterPeople(people, { text: "BOOK" }).map((p) => p.name)).toEqual(["Ana Popescu"]);
  });
  it("filters by department and team", () => {
    expect(filterPeople(people, { department: "eng" })).toHaveLength(1);
    expect(filterPeople(people, { team: "t1" })[0].name).toBe("Bob Tanaka");
    expect(filterPeople(people, { team: "none" })).toHaveLength(0);
  });
});
