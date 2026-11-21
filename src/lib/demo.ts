import { BRAND } from "@/lib/brand";

/** Demo deployments only: the shared accounts shown on the sign-in page (fictional people). */
export const DEMO_ACCOUNTS = [
  { email: "olivia@solenne.example", name: "Olivia Grant", role: "Super admin", what: "Group CEO: the whole group in one Hub — every company, live attendance, approvals, settings." },
  { email: "priya@solenne.example", name: "Priya Nair", role: "Admin / PA", what: "Runs staff, invitations, company communications and travel for all five companies." },
  { email: "marcus@solenne.example", name: "Marcus Reid", role: "Director", what: "Oversight: reports, attendance, expenses and approvals in the UK, NL and US." },
  { email: "james@solenne.example", name: "James Holloway", role: "Project manager", what: "Runs London projects: assigns tasks, follows up reports, approves timesheets." },
  { email: "tom@solenne.example", name: "Tom Fletcher", role: "Employee", what: "Field engineer: clock in on site, tasks with photos, timesheet, leave, expenses." },
  { email: "sarah@solenne.example", name: "Sarah Bennett", role: "Bookkeeper", what: "Reviews expense claims, reimbursements and exports to accounting." },
] as const;

export function demoPassword() {
  return BRAND.demo ? process.env.DEMO_PASSWORD ?? "" : "";
}

export function isDemoAccount(email: string) {
  return BRAND.demo && email.toLowerCase().endsWith("@solenne.example");
}
