import { notFound } from "next/navigation";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { ProjectSideNav } from "@/components/site/project-nav";

/** Every project page: the section list on the left (a strip on phones), the page on the right. */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: project }, { data: passwords }] = await Promise.all([
    supabase.from("projects").select("id, name, organization_id").eq("id", id).maybeSingle(),
    supabase.rpc("has_permission", { p_org: ctx.org.id, p_permission: "credentials.view" }),
  ]);
  if (!project || project.organization_id !== ctx.org.id) notFound();
  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
      <ProjectSideNav base={`/o/${ctx.org.slug}/projects/${id}`} name={project.name} passwords={Boolean(passwords)} toolkit={ctx.settings.site_toolkit_enabled} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
