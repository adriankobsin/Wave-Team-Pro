"use client";

import Link from "@/components/ui/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  PlaneTakeoff,
  CloudUpload,
  BarChart3,
  Bell,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ClipboardList,
  Clock,
  FolderKanban,
  FolderOpen,
  House,
  KeyRound,
  Layers,
  LayoutGrid,
  MailPlus,
  Megaphone,
  MessagesSquare,
  Plane,
  Receipt,
  ScrollText,
  Settings,
  Timer,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean; badge?: number };
export type NavGroup = { label?: string; items: NavItem[] };

const ICONS = {
  home: House,
  people: Users,
  profile: UserRound,
  members: ClipboardList,
  invitations: MailPlus,
  roles: KeyRound,
  structure: Layers,
  audit: ScrollText,
  settings: Settings,
  chat: MessagesSquare,
  announcements: Megaphone,
  documents: FolderOpen,
  notifications: Bell,
  projects: FolderKanban,
  tasks: CheckSquare,
  schedule: CalendarRange,
  attendance: Clock,
  timesheets: Timer,
  leave: Plane,
  expenses: Receipt,
  reports: BarChart3,
  more: LayoutGrid,
  calendar: CalendarDays,
  cloud: CloudUpload,
  key: KeyRound,
  staffing: CalendarClock,
  travel: PlaneTakeoff,
} satisfies Record<string, LucideIcon>;

function matches(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Active unless a more specific sibling (e.g. /tasks/team under /tasks) also matches. */
function isActive(pathname: string, item: NavItem, siblings: NavItem[] = []) {
  return matches(pathname, item) && !siblings.some((o) => o.href.length > item.href.length && o.href.startsWith(`${item.href}/`) && matches(pathname, o));
}

/** Desktop sidebar navigation. The active entry carries a brass depth-marker on its edge. */
export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label ? <p className="mb-1.5 px-3 text-xs font-medium text-hull-muted">{g.label}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item, g.items);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.9375rem] transition-colors",
                      active ? "bg-white/8 text-hull-ink" : "text-hull-muted hover:bg-white/5 hover:text-hull-ink",
                    )}
                  >
                    {active ? <span aria-hidden className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r bg-brass" /> : null}
                    <Icon className="size-[1.05rem] shrink-0" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-brass px-1.5 text-xs font-semibold text-[#1c140a] tabular" aria-label={`${item.badge} unread`}>
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Mobile bottom bar: at most four destinations, labels always visible. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item, items);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                {active ? <span aria-hidden className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-brass" /> : null}
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {item.badge ? <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-brass px-1 text-[0.625rem] font-semibold leading-4 text-[#1c140a]" aria-label={`${item.badge} unread`}>{item.badge > 9 ? "9+" : item.badge}</span> : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
