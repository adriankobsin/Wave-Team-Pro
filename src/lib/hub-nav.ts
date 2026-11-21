import type { NavItem } from "@/components/layout/nav";
import { microsoftConfigured } from "@/lib/integrations";

/** Group Hub's sections, shared by the sidebar and the mobile "More" page. */
export function hubNavItems(isAdmin: boolean, unread: number): NavItem[] {
  return [
    { href: "/hub", label: "Overview", icon: "home", exact: true },
    { href: "/hub/attendance", label: "Attendance", icon: "attendance" },
    { href: "/hub/updates", label: "Updates", icon: "notifications", badge: unread },
    { href: "/hub/staff", label: "All staff", icon: "people" },
    { href: "/hub/staffing", label: "Staff calendar", icon: "staffing" },
    { href: "/hub/projects", label: "Projects", icon: "projects" },
    { href: "/hub/tasks", label: "Tasks", icon: "tasks" },
    { href: "/hub/timesheets", label: "Timesheets", icon: "timesheets" },
    { href: "/hub/expenses", label: "Expenses", icon: "expenses" },
    { href: "/hub/invites", label: "Company Communications", icon: "calendar" },
    ...(isAdmin && microsoftConfigured() ? [{ href: "/hub/outlook", label: "Outlook", icon: "cloud" as const }] : []),
    ...(isAdmin ? [{ href: "/hub/settings", label: "Settings", icon: "settings" as const }] : []),
  ];
}
