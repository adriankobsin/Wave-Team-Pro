import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { getTranslator } from "@/lib/i18n";
import { getPermissionCatalog, listRoles } from "@/server/services/admin";
import { deleteRole, saveRole } from "@/server/actions/roles";
import { MODULE_LABELS, isPermissionKey } from "@/lib/permissions/catalog";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Role" };

export default async function RoleEditorPage({ params }: { params: Promise<{ org: string; roleId: string }> }) {
  const { org: slug, roleId } = await params;
  const ctx = await getOrgContext(slug);
  const t = getTranslator(ctx.profile.locale);
  if (!ctx.perms.has("roles.manage")) return <AccessDenied message={t("common.noAccess")} hint={t("common.noAccessHint")} />;

  const [roles, catalog] = await Promise.all([listRoles(ctx.org.id), getPermissionCatalog()]);
  const isNew = roleId === "new";
  const role = isNew ? null : roles.find((r) => r.id === roleId);
  if (!isNew && !role) notFound();

  const mine = ctx.membership.id;
  const supabase = await createClient();
  const { data: myAssignments } = await supabase.from("membership_role_assignments").select("role_id").eq("membership_id", mine);
  const assignedToMe = Boolean(role && (myAssignments ?? []).some((a) => a.role_id === role.id));
  const locked = Boolean(role?.is_protected) || assignedToMe;
  const held = (key: string) => isPermissionKey(key) && ctx.perms.has(key);

  const modules = [...new Set(catalog.map((c) => c.module))];
  const selected = new Set(role?.permissions ?? []);
  const base = `/o/${ctx.org.slug}/admin/roles`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={base} className="text-sm text-ink-muted underline-offset-4 hover:underline">Roles & permissions</Link>
      <PageHeader title={isNew ? "New role" : role!.name} description={role?.description ?? undefined} />
      {role?.is_protected ? <Notice>Super Admin always has every permission and can’t be edited.</Notice> : null}
      {assignedToMe && !role?.is_protected ? <Notice>This role is assigned to you, so another administrator has to edit it.</Notice> : null}

      <ActionForm action={saveRole} className="space-y-6">
        <input type="hidden" name="organization_id" value={ctx.org.id} />
        <input type="hidden" name="org_slug" value={ctx.org.slug} />
        {role ? <input type="hidden" name="role_id" value={role.id} /> : null}
        <Panel>
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <TextField label="Name" name="name" defaultValue={role?.name ?? ""} required minLength={2} maxLength={60} disabled={locked} />
            <TextField label="Description" name="description" defaultValue={role?.description ?? ""} optional maxLength={300} disabled={locked} />
          </div>
        </Panel>

        {modules.map((mod) => (
          <Panel key={mod}>
            <PanelHeader title={MODULE_LABELS[mod] ?? mod} />
            <fieldset disabled={locked} className="divide-y divide-line">
              <legend className="sr-only">{MODULE_LABELS[mod] ?? mod} permissions</legend>
              {catalog.filter((c) => c.module === mod).map((c) => {
                const canGrant = held(c.key);
                const keepHidden = !canGrant && selected.has(c.key);
                return (
                  <label key={c.key} className="flex cursor-pointer items-start gap-3 px-4 py-3 has-[:disabled]:cursor-not-allowed sm:px-5">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={c.key}
                      defaultChecked={selected.has(c.key)}
                      disabled={!canGrant}
                      className="mt-1 size-4 accent-[var(--hull)] dark:accent-[var(--brass)]"
                    />
                    {/* Permissions you don't hold stay as they are: you can neither add nor remove them. */}
                    {keepHidden ? <input type="hidden" name="permissions" value={c.key} /> : null}
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{c.description}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5">
                        {c.is_sensitive ? <Badge tone="warn">Protected</Badge> : null}
                        {c.allowed_scopes.includes("self") ? <Badge>Own records</Badge> : null}
                        {!canGrant ? <Badge tone="danger">You don&apos;t hold this</Badge> : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </Panel>
        ))}
        {!locked ? <SubmitButton pendingLabel="Saving…">{isNew ? "Create role" : "Save role"}</SubmitButton> : null}
      </ActionForm>

      {role && !locked ? (
        <Panel>
          <PanelHeader title="Delete role" description={role.memberCount ? `Assigned to ${role.memberCount} ${role.memberCount === 1 ? "person" : "people"}. Remove it from them first.` : "Nobody has this role."} />
          <div className="p-4 sm:p-5">
            <InlineActionForm action={deleteRole} confirm={`Delete the role "${role.name}"?`}>
              <input type="hidden" name="organization_id" value={ctx.org.id} />
              <input type="hidden" name="role_id" value={role.id} />
              <SubmitButton variant="danger" pendingLabel="Deleting…" disabled={role.memberCount > 0}>Delete role</SubmitButton>
            </InlineActionForm>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
