import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import Link from "@/components/ui/link";
import { requireActiveProfile } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getHub } from "@/server/services/hub";
import { hubNavItems } from "@/lib/hub-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { PageHeader, Panel } from "@/components/ui/misc";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "More" };

/** Mobile menu for Group Hub: every hub section, then each company. */
export default async function HubMorePage() {
  const { user, profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const t = getTranslator(profile.locale);
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null);
  const items = hubNavItems(hub.isPlatform || hub.companies.some((c) => c.can.settings), count ?? 0);
  const row = "flex items-center justify-between px-4 py-3.5 hover:bg-panel-sunk";
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title={BRAND.hub} description="Everything for all companies." />
      <Panel>
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={row}>
                <span>{item.label}</span>
                <span className="flex items-center gap-2">
                  {item.badge ? <span className="rounded-full bg-brass px-1.5 text-xs font-semibold text-[#1c140a]">{item.badge}</span> : null}
                  <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <section aria-label="Companies">
        <h2 className="mb-2 text-sm font-medium text-ink-muted">Companies (their own settings, roles and approvals)</h2>
        <Panel>
          <ul className="divide-y divide-line">
            {hub.companies.map((c) => (
              <li key={c.id}>
                <Link href={`/o/${c.slug}`} className={row}>
                  <span>{c.name}<span className="block text-xs text-ink-muted">{c.location}</span></span>
                  <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
      <Panel>
        <div className="flex items-center justify-between px-4 py-3">
          <ThemeToggle label={t("theme.toggle")} className="flex items-center gap-2 text-sm" />
          <SignOutButton />
        </div>
      </Panel>
    </div>
  );
}
