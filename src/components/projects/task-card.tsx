import Link from "@/components/ui/link";
import { CalendarDays } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/misc";
import type { DirectoryPerson } from "@/server/services/people";
import { cn } from "@/lib/utils";

export type TaskRow = {
  id: string; title: string; status: string; priority: string; due_date: string | null; project_id: string | null;
  assignees: string[]; checklist_total: number; checklist_done: number; outcome?: string | null; completed_at?: string | null; };

export const PROJECT_STATUS = { planning: "Planning", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" } as const;
export const PROJECT_TONE = { planning: "neutral", active: "ok", on_hold: "warn", completed: "neutral", cancelled: "danger" } as const;

export const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };
export const PRIORITY_TONE = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" } as const;

export function TaskCard({ task, people, href, today }: { task: TaskRow; people: Map<string, DirectoryPerson>; href: string; today: string }) {
  const overdue = task.due_date && task.status !== "done" && task.due_date < today;
  return (
    <Link href={href} className="block rounded-md border border-line bg-panel p-3 hover:border-brass/60">
      <p className={cn("text-sm font-medium", task.status === "done" && "text-ink-muted line-through")}>{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {task.outcome === "not_completed" ? <Badge tone="danger">Not completed</Badge> : task.outcome === "completed" ? <Badge tone="ok">Completed</Badge> : task.status === "in_progress" ? <Badge tone="warn">In progress</Badge> : null}
        {task.priority !== "normal" ? <Badge tone={PRIORITY_TONE[task.priority as keyof typeof PRIORITY_TONE]}>{task.priority}</Badge> : null}
        {task.due_date ? (
          <span className={cn("inline-flex items-center gap-1", overdue ? "font-semibold text-danger" : "text-ink-muted")}>
            <CalendarDays className="size-3" aria-hidden />
            {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${task.due_date}T00:00:00Z`))}
            {overdue ? " (overdue)" : ""}
          </span>
        ) : null}
        {task.checklist_total ? <span className="text-ink-muted tabular">☑ {task.checklist_done}/{task.checklist_total}</span> : null}
        <span className="ml-auto flex -space-x-1.5">
          {task.assignees.slice(0, 4).map((u) => {
            const p = people.get(u);
            return <Avatar key={u} id={u} name={p?.name ?? "?"} src={p?.avatarUrl} size="xs" className="ring-2 ring-panel" />;
          })}
        </span>
      </div>
    </Link>
  );
}
