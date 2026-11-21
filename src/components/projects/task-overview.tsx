import Link from "@/components/ui/link";
import { Badge, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type OverviewTask = {
  id: string; title: string; status: string; priority: string; due_date: string | null;
  assignees: string[]; outcome: string | null; outcome_by: string | null; outcome_at: string | null; outcome_note: string | null;
  notes: number; photos: number; lastNote: { author: string; body: string; at: string } | null;
};

const PRIORITY: Record<string, { label: string; tone: "danger" | "warn" | "neutral"; rank: number }> = {
  urgent: { label: "Urgent", tone: "danger", rank: 0 }, high: { label: "High", tone: "warn", rank: 1 },
  normal: { label: "Normal", tone: "neutral", rank: 2 }, low: { label: "Low", tone: "neutral", rank: 3 },
};

function state(t: OverviewTask) {
  if (t.outcome === "completed") return { label: "Completed", tone: "ok" as const };
  if (t.outcome === "not_completed") return { label: "Not completed", tone: "danger" as const };
  if (t.status === "done") return { label: "Done", tone: "ok" as const };
  if (t.status === "in_progress") return { label: "In progress", tone: "warn" as const };
  if (t.status === "review") return { label: "Review", tone: "warn" as const };
  return { label: "To do", tone: "neutral" as const };
}

/** Every task on the project at a glance: priority, people, status, who owns or completed it, notes. */
export function TaskOverview({ tasks, nameOf, href, today, tz }: {
  tasks: OverviewTask[]; nameOf: (u: string) => string; href: (id: string) => string; today: string; tz: string;
}) {
  const open = tasks.filter((t) => t.status !== "done")
    .sort((a, b) => (PRIORITY[a.priority]?.rank ?? 9) - (PRIORITY[b.priority]?.rank ?? 9) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => (b.outcome_at ?? "").localeCompare(a.outcome_at ?? ""));
  const rows = [...open, ...done];
  const owner = (t: OverviewTask) => {
    if (!t.outcome_by) return t.status === "todo" ? "Not started" : "—";
    const verb = t.outcome === "completed" ? "Completed by" : t.outcome === "not_completed" ? "Reported by" : "Taken by";
    return `${verb} ${nameOf(t.outcome_by)}`;
  };
  const late = (t: OverviewTask) => t.status !== "done" && t.due_date !== null && t.due_date < today;
  const urgent = open.filter((t) => t.priority === "urgent" || t.priority === "high").length;

  return (
    <Panel>
      <PanelHeader
        title={`All tasks (${tasks.length})`}
        description={`${open.length} open · ${done.length} done${urgent ? ` · ${urgent} high or urgent` : ""}${open.filter(late).length ? ` · ${open.filter(late).length} overdue` : ""}`}
      />
      {rows.length ? (
        <>
          {/* Phone: one card per task */}
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((t) => {
              const s = state(t);
              return (
                <li key={t.id} className={cn("px-4 py-3", t.status === "done" && "opacity-75")}>
                  <Link href={href(t.id)} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{t.title}</p>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      <Badge tone={PRIORITY[t.priority]?.tone ?? "neutral"}>{PRIORITY[t.priority]?.label ?? t.priority}</Badge>
                      <span>{t.assignees.length ? t.assignees.map(nameOf).join(", ") : "Unassigned"}</span>
                      {t.due_date ? <span className={cn(late(t) && "font-semibold text-danger")}>· due {t.due_date}{late(t) ? " (overdue)" : ""}</span> : null}
                    </p>
                    <p className="mt-1 text-xs">{owner(t)}{t.outcome_at && t.outcome_by ? ` · ${formatDateTime(t.outcome_at, tz)}` : ""}</p>
                    {t.lastNote ? <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{t.lastNote.author}: {t.lastNote.body}</p> : null}
                    {t.notes || t.photos ? <p className="mt-0.5 text-xs text-ink-muted">{t.notes} notes · {t.photos} photos</p> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Computer: a table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-2 py-2 font-medium">Priority</th>
                  <th className="px-2 py-2 font-medium">Assigned to</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Ownership / completion</th>
                  <th className="px-2 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const s = state(t);
                  return (
                    <tr key={t.id} className={cn("border-b border-line align-top last:border-0", t.status === "done" && "text-ink-muted")}>
                      <td className="max-w-72 px-4 py-2.5">
                        <Link href={href(t.id)} className="font-medium text-ink hover:underline">{t.title}</Link>
                        {t.lastNote ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{t.lastNote.author}: {t.lastNote.body}</p> : null}
                      </td>
                      <td className="px-2 py-2.5"><Badge tone={PRIORITY[t.priority]?.tone ?? "neutral"}>{PRIORITY[t.priority]?.label ?? t.priority}</Badge></td>
                      <td className="px-2 py-2.5">{t.assignees.length ? t.assignees.map(nameOf).join(", ") : <span className="text-ink-muted">Unassigned</span>}</td>
                      <td className="px-2 py-2.5"><Badge tone={s.tone}>{s.label}</Badge></td>
                      <td className="px-2 py-2.5">
                        {owner(t)}
                        {t.outcome_at && t.outcome_by ? <span className="block text-xs text-ink-muted">{formatDateTime(t.outcome_at, tz)}</span> : null}
                        {t.outcome_note && t.outcome ? <span className="block max-w-56 truncate text-xs text-ink-muted" title={t.outcome_note}>“{t.outcome_note}”</span> : null}
                      </td>
                      <td className={cn("tabular px-2 py-2.5", late(t) && "font-semibold text-danger")}>{t.due_date ?? "—"}{late(t) ? <span className="block text-xs">overdue</span> : null}</td>
                      <td className="tabular px-4 py-2.5 text-xs text-ink-muted">{t.notes || t.photos ? `${t.notes} notes · ${t.photos} photos` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="p-6 text-center text-sm text-ink-muted">No tasks on this project yet.</p>}
    </Panel>
  );
}
