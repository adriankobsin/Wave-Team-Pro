import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { getTranslator } from "@/lib/i18n";
import { listRoles } from "@/server/services/admin";
import { AccessDenied, Badge, PageHeader, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("roles.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;
  const roles = await listRoles(ctx.org.id);
  const base = `/o/${ctx.org.slug}/admin/roles`;
  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="A role is a bundle of permissions. Assign roles to people on their member page; add one-off exceptions there too."
        actions={<Link href={`${base}/new`} className={buttonClass()}>New role</Link>}
      />
      <Panel>
        <ul className="divide-y divide-line">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`${base}/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 hover:bg-panel-sunk sm:px-5">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {r.is_protected ? <Badge tone="warn">Locked</Badge> : r.is_system ? <Badge>Template</Badge> : <Badge tone="ok">Custom</Badge>}
                  </span>
                  {r.description ? <span className="block text-sm text-ink-muted">{r.description}</span> : null}
                </span>
                <span className="tabular text-sm text-ink-muted">
                  {r.permissions.length} permissions, {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
