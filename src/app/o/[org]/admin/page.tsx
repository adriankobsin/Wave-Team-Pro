import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { ChevronRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { AccessDenied, PageHeader, Panel } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Admin" };

const ENTRIES: { path: string; label: MessageKey; desc: string; any: PermissionKey[] }[] = [
  { path: "members", label: "nav.members", desc: "Employment details, roles and access", any: ["users.edit", "users.deactivate", "roles.manage"] },
  { path: "invitations", label: "nav.invitations", desc: "Invite people and track pending invitations", any: ["users.invite"] },
  { path: "roles", label: "nav.roles", desc: "Build roles from granular permissions", any: ["roles.manage"] },
  { path: "structure", label: "nav.structure", desc: "Organise people into departments and teams", any: ["org.structure.manage"] },
  { path: "audit", label: "nav.audit", desc: "Who changed what, and when", any: ["audit.view"] },
  { path: "settings", label: "nav.settings", desc: "Entity details and security policy", any: ["org.settings.manage"] },
];

export default async function AdminIndex({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  const visible = ENTRIES.filter((e) => e.any.some((p) => ctx.perms.has(p)));
  if (!visible.length) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("nav.admin")} />
      <Panel>
        <ul className="divide-y divide-line">
          {visible.map((e) => (
            <li key={e.path}>
              <Link href={`/o/${ctx.org.slug}/admin/${e.path}`} className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-panel-sunk sm:px-5">
                <span>
                  <span className="block font-medium">{t(e.label)}</span>
                  <span className="block text-sm text-ink-muted">{e.desc}</span>
                </span>
                <ChevronRight className="size-4 text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
