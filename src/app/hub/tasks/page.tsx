import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/auth/session";
import { getHub } from "@/server/services/hub";
import { teamTasks } from "@/server/services/tasks";
import { TeamTasks } from "@/components/projects/team-tasks";
import { PageHeader } from "@/components/ui/misc";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Tasks" };

export default async function HubTasksPage({ searchParams }: { searchParams: Promise<{ person?: string; status?: string; q?: string; source?: string; outcome?: string; company?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireActiveProfile();
  const hub = await getHub();
  if (!hub) redirect("/");
  const status = ["todo", "in_progress", "review", "done", "all"].includes(sp.status ?? "") ? sp.status! : "";
  const outcome = ["completed", "not_completed", "none"].includes(sp.outcome ?? "") ? sp.outcome! : "";
  const { tasks, people } = await teamTasks(hub.companies.map((c) => c.id), { status: status === "all" ? "" : status, includeDone: status === "all" || Boolean(outcome), outcome });
  return (
    <div className="space-y-4">
      <PageHeader title="Tasks" description="Every employee's tasks in every company — their own and those set by management. Click a task to open it in its company." />
      <TeamTasks tasks={tasks} people={people} companies={hub.companies} today={todayIn(profile.timezone)}
        filters={{ person: sp.person ?? "", status, company: hub.companies.some((c) => c.id === sp.company) ? sp.company! : "", q: sp.q ?? "", source: sp.source === "own" || sp.source === "set" ? sp.source : "", outcome }} />
    </div>
  );
}
