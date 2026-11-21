import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { getHub } from "@/server/services/hub";
import { staffingCompanies } from "@/server/services/staffing";
import { StaffCalendar } from "@/components/staffing/staff-calendar";
import { AccessDenied } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Staff calendar" };

/**
 * A company's staff calendar. People who run the group (super admins and Group Hub users) see every
 * company here too, with a Company filter; everyone else sees this company only.
 */
export default async function StaffingPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ month?: string; company?: string; project?: string; person?: string; day?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const hub = await getHub();
  const list = hub?.companies.length ? hub.companies : [{ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, timezone: ctx.org.timezone || "UTC" }];
  const companies = (await staffingCompanies(list.map((c) => ({ id: c.id, name: c.name, slug: c.slug, timezone: c.timezone })))).filter((c) => c.canView || c.id === ctx.org.id);
  const here = companies.find((c) => c.id === ctx.org.id);
  const group = companies.filter((c) => c.canView).length > 1;
  if (!here?.canView && !group) return <AccessDenied message="You can't see the staff calendar." hint="Ask a super admin for the “See the staff calendar” permission." />;
  if (!group) return <StaffCalendar companies={[here!]} sp={{ ...sp, company: undefined }} base={`/o/${ctx.org.slug}/staffing`} viewerTz={ctx.profile.timezone} showCompanyFilter={false} />;
  return <StaffCalendar companies={companies} sp={sp} base={`/o/${ctx.org.slug}/staffing`} viewerTz={ctx.profile.timezone} showCompanyFilter />;
}
