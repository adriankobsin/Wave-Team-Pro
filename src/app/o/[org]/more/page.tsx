import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { buildNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PageHeader, Panel } from "@/components/ui/misc";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const metadata: Metadata = { title: "More" };

/** Mobile menu: every section the person can open, grouped like the desktop sidebar. */
export default async function MorePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).is("read_at", null);
  const { groups } = buildNav(ctx, t, { unreadMessages: 0, unreadNotifications: count ?? 0, approvals: 0 });
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title={ctx.org.name} />
      {groups.map((g, i) => (
        <section key={i} aria-label={g.label ?? "Main"}>
          {g.label ? <h2 className="mb-2 text-sm font-medium text-ink-muted">{g.label}</h2> : null}
          <Panel>
            <ul className="divide-y divide-line">
              {g.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center justify-between px-4 py-3.5 hover:bg-panel-sunk">
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
        </section>
      ))}
      <Panel>
        <div className="flex items-center justify-between px-4 py-3">
          <ThemeToggle label={t("theme.toggle")} className="flex items-center gap-2 text-sm" />
          <SignOutButton />
        </div>
      </Panel>
    </div>
  );
}
