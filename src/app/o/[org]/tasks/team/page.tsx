import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";
import { teamTasks } from "@/server/services/tasks";
import { TeamTasks } from "@/components/projects/team-tasks";
import { PageHeader } from "@/components/ui/misc";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Team tasks" };

export default async function TeamTasksPage({ params, searchParams }: {
  params: Promise<{ org: string }>; searchParams: Promise<{ person?: string; status?: string; q?: string; source?: string; outcome?: string }>;
}) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("tasks.view.all")) notFound();
  const status = ["todo", "in_progress", "review", "done", "all"].includes(sp.status ?? "") ? sp.status! : "";
  const outcome = ["completed", "not_completed", "none"].includes(sp.outcome ?? "") ? sp.outcome! : "";
  const { tasks, people } = await teamTasks([ctx.org.id], { status: status === "all" ? "" : status, includeDone: status === "all" || Boolean(outcome), outcome });
  return (
    <div className="space-y-4">
      <PageHeader title="Team tasks" description={`Every task in ${ctx.org.name}, per employee — what they added themselves and what management set them.`} />
      <TeamTasks tasks={tasks} people={people} companies={[{ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug }]} today={todayIn(ctx.profile.timezone)}
        filters={{ person: sp.person ?? "", status, company: "", q: sp.q ?? "", source: sp.source === "own" || sp.source === "set" ? sp.source : "", outcome }} />
    </div>
  );
}
