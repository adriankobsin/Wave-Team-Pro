import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub } from "@/server/services/hub";
import { staffingCompanies } from "@/server/services/staffing";
import { StaffCalendar } from "@/components/staffing/staff-calendar";

export const metadata: Metadata = { title: "Staff calendar" };

/** Every company's staff calendar in one month view. */
export default async function HubStaffingPage({ searchParams }: { searchParams: Promise<{ month?: string; company?: string; project?: string; person?: string; day?: string }> }) {
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const sp = await searchParams;
  const companies = await staffingCompanies(hub.companies.map((c) => ({ id: c.id, name: c.name, slug: c.slug, timezone: c.timezone })));
  return <StaffCalendar companies={companies} sp={sp} base="/hub/staffing" viewerTz={profile.timezone} showCompanyFilter />;
}
