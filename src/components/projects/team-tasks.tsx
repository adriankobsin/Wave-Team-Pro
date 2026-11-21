import Link from "@/components/ui/link";
import { Badge, EmptyState, Panel } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { STATUS_LABEL } from "@/components/projects/task-card";
import type { TeamTask, TeamTaskPerson } from "@/server/services/tasks";
import { cn } from "@/lib/utils";

type Company = { id: string; name: string; slug: string };

function outcomeBadge(t: TeamTask) {
  if (t.outcome === "completed") return <Badge tone="ok">Completed</Badge>;
  if (t.outcome === "not_completed") return <Badge tone="danger">Not completed</Badge>;
  if (t.status === "in_progress") return <Badge tone="warn">In progress</Badge>;
  if (t.status === "done") return <Badge tone="ok">Done</Badge>;
  return <Badge>{STATUS_LABEL[t.status] ?? t.status}</Badge>;
}

/**
 * Every employee's tasks, one block per person: tasks they added themselves and tasks management set them.
 * Filters are plain GET parameters (person, status, company, q).
 */
export function TeamTasks({ tasks, people, companies, today, filters }: {
  tasks: TeamTask[]; people: Map<string, TeamTaskPerson>; companies: Company[]; today: string;
  filters: { person: string; status: string; company: string; q: string; source: string; outcome: string };
}) {
  const companyOf = new Map(companies.map((c) => [c.id, c]));
  const text = filters.q.trim().toLowerCase();
  const shown = tasks.filter((t) =>
    (!filters.company || t.orgId === filters.company)
    && (!filters.person || t.assignees.includes(filters.person) || (filters.person === "none" && !t.assignees.length))
    && (!filters.source || (filters.source === "own" ? t.own : !t.own))
    && (!text || `${t.title} ${t.project ?? ""}`.toLowerCase().includes(text)));

  // Group by assignee; a task with two people shows under both.
  const groups = new Map<string, TeamTask[]>();
  for (const t of shown) {
    const who = t.assignees.length ? t.assignees : ["none"];
    for (const u of who) {
      if (filters.person && filters.person !== u) continue;
      groups.set(u, [...(groups.get(u) ?? []), t]);
    }
  }
  const nameOf = (u: string) => (u === "none" ? "Not assigned yet" : people.get(u)?.name ?? "Someone");
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : nameOf(a).localeCompare(nameOf(b))));
  const everyone = [...new Set(tasks.flatMap((t) => t.assignees))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const open = (list: TeamTask[]) => list.filter((t) => t.status !== "done").length;
  const overdue = (list: TeamTask[]) => list.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Search
          <input name="q" defaultValue={filters.q} placeholder="Task or project" className="mt-1 block h-9 w-44 rounded-md border border-line bg-panel px-2" />
        </label>
        <label className="text-sm">Person
          <select name="person" defaultValue={filters.person} className="mt-1 block h-9 max-w-52 rounded-md border border-line bg-panel px-2">
            <option value="">Everyone</option>
            {everyone.map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}
            <option value="none">Not assigned yet</option>
          </select>
        </label>
        <label className="text-sm">Status
          <select name="status" defaultValue={filters.status} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">Open + done in last 14 days</option>
            <option value="all">Everything, including old completed</option>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="review">Review</option>
            <option value="done">Done (all time)</option>
          </select>
        </label>
        <label className="text-sm">Report
          <select name="outcome" defaultValue={filters.outcome} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">Any</option>
            <option value="completed">Reported completed</option>
            <option value="not_completed">Reported not completed</option>
            <option value="none">Not reported yet</option>
          </select>
        </label>
        <label className="text-sm">Added by
          <select name="source" defaultValue={filters.source} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
            <option value="">Anyone</option>
            <option value="own">The employee (own tasks)</option>
            <option value="set">Management</option>
          </select>
        </label>
        {companies.length > 1 ? (
          <label className="text-sm">Company
            <select name="company" defaultValue={filters.company} className="mt-1 block h-9 rounded-md border border-line bg-panel px-2">
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" className={buttonClass("secondary")}>Show</button>
      </form>

      {ordered.length ? ordered.map(([u, list]) => (
        <Panel key={u} className="overflow-x-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
            <h2 className="font-medium">{nameOf(u)}</h2>
            <p className="text-xs text-ink-muted">{open(list)} open{overdue(list) ? <span className="font-semibold text-danger"> · {overdue(list)} overdue</span> : null} · {list.length} shown</p>
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {list.map((t) => {
                const c = companyOf.get(t.orgId);
                const late = t.status !== "done" && t.due_date && t.due_date < today;
                return (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/o/${c?.slug}/tasks/${t.id}`} className={cn("font-medium hover:underline", t.status === "done" && "text-ink-muted line-through")}>{t.title}</Link>
                      <p className="text-xs text-ink-muted">
                        {t.project ?? "Personal"}{companies.length > 1 && c ? ` · ${c.name}` : ""}
                        {" · "}{t.own ? "added by themselves" : `set by ${people.get(t.createdBy)?.name ?? "management"}`}
                        {t.assignees.length > 1 ? ` · with ${t.assignees.filter((a) => a !== u).map((a) => nameOf(a)).join(", ")}` : ""}
                      </p>
                      {t.outcome ? (
                        <p className="mt-1 text-xs">
                          <span className="font-medium">{t.outcome === "completed" ? "Completed" : "Not completed"}</span>
                          {t.outcomeBy ? ` · reported by ${nameOf(t.outcomeBy)}` : ""}
                          {t.completedAt ? ` · ${t.completedAt.slice(0, 10)}` : ""}
                          {t.outcomeNote ? <span className="block text-ink-muted">“{t.outcomeNote.length > 220 ? `${t.outcomeNote.slice(0, 220)}…` : t.outcomeNote}”</span> : null}
                        </p>
                      ) : t.status === "done" && t.completedAt ? <p className="mt-1 text-xs text-ink-muted">Done {t.completedAt.slice(0, 10)}</p> : null}
                    </td>
                    <td className={cn("tabular w-28 px-2 py-2 text-xs", late ? "font-semibold text-danger" : "text-ink-muted")}>{t.due_date ? `Due ${t.due_date}` : "No due date"}</td>
                    <td className="w-32 px-4 py-2 text-right">{outcomeBadge(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )) : <Panel><EmptyState title="No tasks match">Change the filters, or check back once people add tasks.</EmptyState></Panel>}
    </div>
  );
}
