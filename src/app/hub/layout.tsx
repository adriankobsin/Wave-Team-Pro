import type { Metadata } from "next";
import { LanguagePicker } from "@/components/layout/language-picker";
import { uiLang } from "@/lib/i18n/server";
import { retryDueSyncSoon } from "@/server/services/outlook";
import Link from "@/components/ui/link";
import { HideMenuButton, ShowMenuButton } from "@/components/layout/menu-toggle";
import { redirect } from "next/navigation";
import { Bell, LogOut } from "lucide-react";
import { requireActiveProfile } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getHub } from "@/server/services/hub";
import { signAvatarPaths } from "@/server/services/avatars";
import { logoVersion, platformLogoVersion } from "@/server/services/branding";
import { BackBar } from "@/components/layout/back-bar";
import { hubNavItems } from "@/lib/hub-nav";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav, SidebarNav, type NavGroup } from "@/components/layout/nav";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: { template: `%s · ${BRAND.hub}`, default: BRAND.hub } };

/** Group Hub: the whole group in one place, for people who run more than one company. */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  retryDueSyncSoon();
  const t = getTranslator(profile.locale);
  const lang = await uiLang();
  const supabase = await createClient();
  const [avatars, { count: unread }, logoV, platformV] = await Promise.all([
    signAvatarPaths([profile.avatar_thumb_path]),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    hub.home ? logoVersion(hub.home.id) : Promise.resolve(null),
    platformLogoVersion(),
  ]);
  // Group Hub's own logo (Hub → Settings); until one is uploaded, the home company's.
  const logoSrc = platformV ? `/hub/logo?v=${platformV}` : hub.home && logoV ? `/o/${hub.home.slug}/logo?v=${logoV}` : null;
  const isAdmin = hub.isPlatform || hub.companies.some((c) => c.can.settings);
  const profileHref = hub.home ? `/o/${hub.home.slug}/profile` : "/hub";
  const items = hubNavItems(isAdmin, unread ?? 0);
  const groups: NavGroup[] = [
    { items },
    { label: "Companies", items: hub.companies.map((c) => ({ href: `/o/${c.slug}`, label: c.name, icon: "structure" as const })) },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr] lg:[.menu-hidden_&]:grid-cols-1">
      <ShowMenuButton />
      <LiveRefresh table="notifications" channel={`notif-hub-${user.id}`} filter={`user_id=eq.${user.id}`} />
      <aside className="hidden lg:[.menu-hidden_&]:hidden bg-hull text-hull-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-6 lg:px-3 lg:py-5">
        <div className="space-y-1">
          {logoSrc ? (
            <div className="mx-3 mb-2 flex h-14 items-center justify-center rounded-md bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt="Group logo" className="max-h-full max-w-full object-contain" />
            </div>
          ) : null}
          <p className="px-3 text-lg font-semibold">{BRAND.hub}</p>
          <p className="px-3 text-xs text-hull-muted">{hub.companies.length} companies</p>
        </div>
        <div className="flex-1 overflow-y-auto pl-3">
          <SidebarNav groups={groups} />
        </div>
        <div className="space-y-1 border-t border-white/10 pt-4">
          <HideMenuButton className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-hull-muted hover:bg-white/5 hover:text-hull-ink" />
          <Link href={profileHref} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5">
            <Avatar id={user.id} name={profile.display_name} src={profile.avatar_thumb_path ? avatars.get(profile.avatar_thumb_path) : null} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{profile.display_name}</span>
              <span className="block truncate text-xs text-hull-muted">{hub.isPlatform ? "Super admin" : profile.email_display}</span>
            </span>
          </Link>
          <div className="flex gap-1 px-1">
            <ThemeToggle label={t("theme.toggle")} className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-hull-muted hover:bg-white/5 hover:text-hull-ink" />
            <form action="/auth/signout" method="post">
              <button type="submit" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-hull-muted hover:bg-white/5 hover:text-hull-ink">
                <LogOut className="size-4" aria-hidden />
                {t("nav.signOut")}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-hull px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-hull-ink lg:hidden">
          {logoSrc ? (
            <div className="flex h-10 w-24 shrink-0 items-center justify-center rounded bg-white p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt="Group logo" className="max-h-full max-w-full object-contain" />
            </div>
          ) : null}
          <p className="min-w-0 flex-1 truncate font-semibold">{BRAND.hub}</p>
          <Link href="/hub/updates" aria-label={`Updates${unread ? ` (${unread} unread)` : ""}`} className="relative p-1">
            <Bell className="size-5" aria-hidden />
            {unread ? <span className="absolute right-0 top-0 size-2 rounded-full bg-brass" aria-hidden /> : null}
          </Link>
          <LanguagePicker current={lang} compact className="text-hull-ink [&_select]:border-white/20" />
          <SignOutButton iconOnly label={t("nav.signOut")} className="border-white/20 px-2 text-hull-ink hover:bg-white/10" />
          <Link href={profileHref} aria-label={t("nav.profile")}>
            <Avatar id={user.id} name={profile.display_name} src={profile.avatar_thumb_path ? avatars.get(profile.avatar_thumb_path) : null} size="sm" />
          </Link>
        </header>
        <div className="sticky top-0 z-20 hidden items-center justify-end gap-3 border-b border-line bg-bg/90 px-10 py-2 backdrop-blur lg:flex">
          <LanguagePicker current={lang} className="text-ink-muted" />
        </div>
        <main id="main" className="safe-bottom mx-auto w-full max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10 lg:[.menu-hidden_&]:pt-16">
          <BackBar home="/hub" hubHome />
          {children}
        </main>
      </div>
      <BottomNav items={[
        items[0],
        { href: "/hub/attendance", label: "Clock", icon: "attendance" },
        { href: "/hub/updates", label: "Updates", icon: "notifications", badge: unread ?? 0 },
        { href: "/hub/staff", label: "Staff", icon: "people" },
        { href: "/hub/more", label: "More", icon: "more" },
      ]} />
    </div>
  );
}
