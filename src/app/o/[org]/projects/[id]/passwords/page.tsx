import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject } from "@/server/services/site";
import { Notice, PageHeader, Panel } from "@/components/ui/misc";
import { CredentialForm, CredentialList } from "@/components/credentials/credential-list";
import { CredentialActivity } from "@/components/credentials/credential-activity";
import { credentialActivity, listCredentials } from "@/server/services/credentials";

export const metadata: Metadata = { title: "Passwords" };

export default async function ProjectPasswordsPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const { ctx, project } = await getSiteProject(org, id);
  if (!ctx.perms.has("credentials.view")) notFound();
  const canManage = ctx.perms.has("credentials.manage");
  const supabase = await createClient();
  const [rows, { data: devices }, { data: all }] = await Promise.all([
    listCredentials(ctx.org.id, id),
    supabase.from("site_devices").select("id, name").eq("project_id", id).is("archived_at", null).order("name").limit(3000),
    supabase.from("credentials").select("id").eq("project_id", id).limit(2000),
  ]);
  // Activity includes logins removed since (their "removed" entry is the last one).
  const events = canManage ? await credentialActivity(ctx.org.id, (all ?? []).map((r) => r.id as string)) : [];
  const devs = (devices ?? []) as { id: string; name: string }[];
  return (
    <div className="space-y-4">
      <PageHeader title="Passwords" description={`Logins for ${project.name}: switches, firewall, processors, Wi-Fi, servers and the online portals used on this project.`} />
      <Notice tone="neutral" title="Kept encrypted">
        Passwords are only shown when you press the eye, and each time is recorded. They belong to this project only and are never included in exports, the project pack or QR pages.
      </Notice>
      {canManage ? (
        <details className="rounded-lg border border-line bg-panel">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">+ Add a login</summary>
          <div className="border-t border-line"><CredentialForm orgId={ctx.org.id} fixedProject={id} devices={devs} /></div>
        </details>
      ) : null}
      <Panel className="overflow-hidden">
        <CredentialList rows={rows} orgId={ctx.org.id} canManage={canManage} devices={devs} fixedProject={id} showProject={false} />
      </Panel>
      <CredentialActivity events={events} timeZone={ctx.org.timezone} />
    </div>
  );
}
