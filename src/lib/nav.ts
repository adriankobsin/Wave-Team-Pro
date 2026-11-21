import type { NavGroup, NavItem } from "@/components/layout/nav";
import type { OrgContext } from "@/lib/auth/org";
import type { Translator } from "@/lib/i18n";
import { microsoftConfigured } from "@/lib/integrations";

/** Modules that are live. Extend as phases ship. */
const LIVE = new Set(["chat", "announcements", "documents", "notifications", "projects", "tasks", "schedule", "attendance", "timesheets", "leave", "approvals", "expenses", "reports"]);

/** travel: open travel requests when the person handles travel for this company (null otherwise). */
export type NavCounts = { unreadMessages: number; unreadNotifications: number; approvals: number; travel?: number | null };

export function buildNav(ctx: OrgContext, t: Translator, counts: NavCounts) {
  const base = `/o/${ctx.org.slug}`;
  const p = ctx.perms;
  const live = (k: string) => LIVE.has(k);

  const work: NavItem[] = [
    { href: base, label: t("nav.home"), icon: "home", exact: true },
    ...(live("chat") ? [{ href: `${base}/chat`, label: "Chat", icon: "chat" as const, badge: counts.unreadMessages }] : []),
    ...(live("announcements") ? [{ href: `${base}/announcements`, label: "Announcements", icon: "announcements" as const }] : []),
    ...(live("projects") ? [{ href: `${base}/projects`, label: "Projects", icon: "projects" as const }] : []),
    ...(live("tasks") ? [{ href: `${base}/tasks`, label: "My tasks", icon: "tasks" as const }] : []),
    ...(live("tasks") && p.has("tasks.view.all") ? [{ href: `${base}/tasks/team`, label: "Team tasks", icon: "people" as const }] : []),
    ...(p.has("staffing.view") || p.has("staffing.assign") || p.has("travel.manage") || counts.travel != null ? [{ href: `${base}/staffing`, label: "Staff calendar", icon: "staffing" as const }] : []),
    ...(p.has("staffing.view") || p.has("staffing.assign") || p.has("travel.manage") || counts.travel != null ? [{ href: `${base}/travel`, label: "Travel", icon: "travel" as const, badge: counts.travel ?? 0 }] : []),
    ...(live("documents") ? [{ href: `${base}/documents`, label: "Documents", icon: "documents" as const }] : []),
    // Staff receive communications in Outlook and as notifications; the page is for senders.
    ...(p.has("invites.send") ? [{ href: `${base}/invites`, label: "Company Communications", icon: "calendar" as const }] : []),
  ];
  const time: NavItem[] = [
    ...(live("schedule") ? [{ href: `${base}/schedule`, label: "Schedule", icon: "schedule" as const }] : []),
    ...(live("attendance") && p.hasAnyScope("attendance.view.self") ? [{ href: `${base}/attendance`, label: "Attendance", icon: "attendance" as const }] : []),
    ...(live("timesheets") && (p.hasAnyScope("timesheets.submit") || p.hasAnyScope("timesheets.approve")) ? [{ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets" as const }] : []),
    ...(live("leave") && (p.hasAnyScope("leave.request") || p.hasAnyScope("leave.approve")) ? [{ href: `${base}/leave`, label: "Leave", icon: "leave" as const }] : []),
    ...(live("expenses") && (p.hasAnyScope("expenses.create") || p.hasAnyScope("expenses.view.all") || p.hasAnyScope("expenses.view.team") || p.hasAnyScope("expenses.approve") || p.has("reimbursements.manage")) ? [{ href: `${base}/expenses`, label: "Expenses", icon: "expenses" as const }] : []),
    ...((p.has("attendance.view.all") || p.hasAnyScope("attendance.view.team") || p.hasAnyScope("timesheets.approve")) ? [{ href: `${base}/reports/weekly`, label: "Weekly timesheets", icon: "timesheets" as const }] : []),
    ...(live("approvals") && (counts.approvals > 0 || p.hasAnyScope("timesheets.approve") || p.hasAnyScope("leave.approve") || p.hasAnyScope("expenses.approve") || p.hasAnyScope("attendance.view.team") || p.has("attendance.view.all")) ? [{ href: `${base}/approvals`, label: "Approvals", icon: "tasks" as const, badge: counts.approvals }] : []),
  ];
  const company: NavItem[] = [
    ...(p.has("users.view") ? [{ href: `${base}/people`, label: t("nav.people"), icon: "people" as const }] : []),
    ...(live("reports") && p.hasAnyScope("reports.view") ? [{ href: `${base}/reports`, label: "Reports", icon: "reports" as const }] : []),
    { href: `${base}/notifications`, label: "Notifications", icon: "notifications", badge: counts.unreadNotifications },
    { href: `${base}/profile`, label: t("nav.profile"), icon: "profile" },
  ];
  const admin: NavItem[] = [];
  // Staff administration is for people who manage staff; everyone else has the People directory.
  if (p.has("users.edit") || p.has("roles.manage")) admin.push({ href: `${base}/admin/staff`, label: "All staff", icon: "people" });
  if (p.has("users.edit") || p.has("users.deactivate") || p.has("roles.manage")) admin.push({ href: `${base}/admin/members`, label: t("nav.members"), icon: "members" });
  if (p.has("users.invite")) admin.push({ href: `${base}/admin/invitations`, label: t("nav.invitations"), icon: "invitations" });
  if (p.has("roles.manage")) admin.push({ href: `${base}/admin/roles`, label: t("nav.roles"), icon: "roles" });
  if (p.has("org.structure.manage")) admin.push({ href: `${base}/admin/structure`, label: t("nav.structure"), icon: "structure" });
  if (p.has("audit.view")) admin.push({ href: `${base}/admin/audit`, label: t("nav.audit"), icon: "audit" });
  if (p.has("org.settings.manage")) admin.push({ href: `${base}/admin/settings`, label: t("nav.settings"), icon: "settings" });
  // Microsoft 365 pages appear once the deployment has its Microsoft keys (see docs/deploy/microsoft-365.md).
  if (p.has("org.settings.manage") && microsoftConfigured()) admin.push({ href: `${base}/admin/sharepoint`, label: "SharePoint filing", icon: "cloud" });
  if (p.has("org.settings.manage") && microsoftConfigured()) admin.push({ href: `${base}/admin/m365`, label: "Microsoft 365 projects", icon: "cloud" });

  const groups: NavGroup[] = [
    { items: work },
    ...(time.length ? [{ label: "Time & money", items: time }] : []),
    { label: "Company", items: company },
    ...(admin.length ? [{ label: t("nav.admin"), items: admin }] : []),
  ];

  const mobile: NavItem[] = [
    { href: base, label: t("nav.home"), icon: "home", exact: true },
    ...(live("chat") ? [{ href: `${base}/chat`, label: "Chat", icon: "chat" as const, badge: counts.unreadMessages }] : []),
    ...(live("attendance") ? [{ href: `${base}/attendance`, label: "Clock", icon: "attendance" as const }] : []),
    ...(live("expenses") ? [{ href: `${base}/expenses`, label: "Expenses", icon: "expenses" as const }] : []),
    { href: `${base}/more`, label: "More", icon: "more", badge: counts.unreadNotifications + counts.approvals },
  ];
  return { groups, mobile, admin };
}
