import Link from "@/components/ui/link";
import { LanguagePicker } from "@/components/layout/language-picker";
import { uiLang } from "@/lib/i18n/server";
import { retryDueSyncSoon } from "@/server/services/outlook";
import { HideMenuButton, ShowMenuButton } from "@/components/layout/menu-toggle";
import { LogOut } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { getMyOrganizations } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n";
import { signAvatarPaths } from "@/server/services/avatars";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav, SidebarNav } from "@/components/layout/nav";
import { buildNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { Bell } from "lucide-react";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Notice } from "@/components/ui/misc";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInvitation } from "@/server/actions/onboarding";
import { logoVersion } from "@/server/services/branding";
import { getHub } from "@/server/services/hub";
import { BackBar } from "@/components/layout/back-bar";
import { LayoutGrid } from "lucide-react";
import { BRAND } from "@/lib/brand";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  retryDueSyncSoon();
  const t = getTranslator(ctx.profile.locale);
  const lang = await uiLang();
  const base = `/o/${ctx.org.slug}`;

  // Everything below only depends on the org context, so fetch it in one round trip.
  const supabase = await createClient();
  const [orgs, avatars, { data: inbox }, { count: unreadNotifications }, { data: approvalCounts }, { data: expenseApprovals }, { data: pendingInvites }, logoV, hub] = await Promise.all([
    getMyOrganizations(),
    signAvatarPaths([ctx.profile.avatar_thumb_path]),
    supabase.rpc("my_conversations", { p_org: ctx.org.id }),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).is("read_at", null),
    supabase.rpc("my_approval_counts", { p_org: ctx.org.id }),
    supabase.rpc("my_expense_approval_count", { p_org: ctx.org.id }),
    supabase.rpc("list_my_pending_invitations"),
    logoVersion(ctx.org.id),
    getHub(),
  ]);
  // Travel coordinators see open requests as a badge on "Travel".
  const { data: handlesTravel } = await supabase.rpc("can_handle_travel", { p_org: ctx.org.id });
  const { count: openTravel } = handlesTravel === true
    ? await supabase.from("travel_requests").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).in("status", ["requested", "in_progress"])
    : { count: null };
  const logoSrc = logoV ? `${base}/logo?v=${logoV}` : null;
  const invites = (pendingInvites ?? []) as { invitation_id: string; organization_name: string; organization_slug: string; role_name: string | null }[];
  const ac = ((approvalCounts as { timesheets: number; leave: number; corrections: number }[] | null) ?? [])[0];
  const approvals = (ac ? Number(ac.timesheets) + Number(ac.leave) + Number(ac.corrections) : 0) + Number(expenseApprovals ?? 0);
  const unreadMessages = ((inbox as { unread_count: number; muted: boolean }[] | null) ?? []).reduce((n, c) => n + (c.muted ? 0 : Number(c.unread_count)), 0);
  const { groups, mobile } = buildNav(ctx, t, { unreadMessages, unreadNotifications: unreadNotifications ?? 0, approvals, travel: handlesTravel === true ? openTravel ?? 0 : null });

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr] lg:[.menu-hidden_&]:grid-cols-1">
      <ShowMenuButton />
      <LiveRefresh table="notifications" channel={`notif-${ctx.userId}`} filter={`user_id=eq.${ctx.userId}`} />
      <aside className="hidden lg:[.menu-hidden_&]:hidden bg-hull text-hull-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-6 lg:px-3 lg:py-5">
        <div className="space-y-1">
          {logoSrc ? (
            <div className="mx-3 mb-2 flex h-14 items-center justify-center rounded-md bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={`${ctx.org.name} logo`} className="max-h-full max-w-full object-contain" />
            </div>
          ) : null}
          {hub ? (
            <>
              <Link href="/hub" className="mx-0 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-white/5">
                <LayoutGrid className="size-4" aria-hidden /> {BRAND.hub}
              </Link>
              <p className="px-3 text-xs text-hull-muted">{ctx.org.name}</p>
            </>
          ) : (
            <>
              <p className="px-3 text-xs text-hull-muted">{BRAND.product}</p>
              <OrgSwitcher current={ctx.org} orgs={orgs} label={t("nav.switchOrg")} />
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pl-3">
          <SidebarNav groups={groups} />
        </div>
        <div className="space-y-1 border-t border-white/10 pt-4">
          <HideMenuButton className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-hull-muted hover:bg-white/5 hover:text-hull-ink" />
          <Link href={`${base}/profile`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5">
            <Avatar id={ctx.userId} name={ctx.profile.display_name} src={ctx.profile.avatar_thumb_path ? avatars.get(ctx.profile.avatar_thumb_path) : null} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{ctx.profile.display_name}</span>
              <span className="block truncate text-xs text-hull-muted">{ctx.membership.job_title ?? ctx.profile.email_display}</span>
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
            <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-white p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={`${ctx.org.name} logo`} className="max-h-full max-w-full object-contain" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {hub ? (
              <Link href="/hub" className="block truncate text-sm"><span className="font-semibold">{BRAND.hub}</span> <span className="text-hull-muted">· {ctx.org.name}</span></Link>
            ) : (
              <OrgSwitcher current={ctx.org} orgs={orgs} label={t("nav.switchOrg")} />
            )}
          </div>
          <Link href={`${base}/notifications`} aria-label={`Notifications${unreadNotifications ? ` (${unreadNotifications} unread)` : ""}`} className="relative p-1">
            <Bell className="size-5" aria-hidden />
            {unreadNotifications ? <span className="absolute right-0 top-0 size-2 rounded-full bg-brass" aria-hidden /> : null}
          </Link>
          <LanguagePicker current={lang} compact className="text-hull-ink [&_select]:border-white/20" />
          <SignOutButton iconOnly label={t("nav.signOut")} className="border-white/20 px-2 text-hull-ink hover:bg-white/10" />
          <Link href={`${base}/profile`} aria-label={t("nav.profile")}>
            <Avatar id={ctx.userId} name={ctx.profile.display_name} src={ctx.profile.avatar_thumb_path ? avatars.get(ctx.profile.avatar_thumb_path) : null} size="sm" />
          </Link>
        </header>
        <div className="sticky top-0 z-20 hidden items-center justify-end gap-3 border-b border-line bg-bg/90 px-10 py-2 backdrop-blur lg:flex">
          <LanguagePicker current={lang} className="text-ink-muted" />
        </div>
        <main id="main" className="safe-bottom mx-auto w-full max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10 lg:[.menu-hidden_&]:pt-16">
          <BackBar home={base} hubHome={Boolean(hub)} />
          {ctx.mfaStepUpNeeded ? (
            <div className="mb-6">
              <Notice tone="warn" title="Two-step verification needed for admin tasks">
                This organization protects admin and finance permissions with two-step verification.{" "}
                <Link className="font-medium underline" href={`/auth/mfa?next=${encodeURIComponent(base)}`}>
                  Verify now
                </Link>{" "}
                or{" "}
                <Link className="font-medium underline" href={`${base}/profile#security`}>
                  set up an authenticator
                </Link>
                .
              </Notice>
            </div>
          ) : null}
          {invites.length ? (
            <div className="mb-6 space-y-2">
              {invites.map((i) => (
                <Notice key={i.invitation_id} tone="ok" title={`You've been added to ${i.organization_name}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{i.role_name ? `Role: ${i.role_name}. ` : ""}Join to see its timesheets, leave and expenses.</span>
                    <ActionForm action={acceptInvitation}>
                      <input type="hidden" name="invitation_id" value={i.invitation_id} />
                      <input type="hidden" name="organization_slug" value={i.organization_slug} />
                      <SubmitButton size="sm" pendingLabel="Joining…">Join {i.organization_name}</SubmitButton>
                    </ActionForm>
                  </div>
                </Notice>
              ))}
            </div>
          ) : null}
          {children}
        </main>
      </div>
      <BottomNav items={mobile} />
    </div>
  );
}
