import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 text-[0.9375rem] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const tones = {
  neutral: "bg-panel-sunk text-ink-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-brass-soft text-[#7a5a22] dark:text-brass border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "ok" | "danger" | "warn"; title?: string; children: ReactNode }) {
  const toneClass = {
    neutral: "border-line bg-panel-sunk",
    ok: "border-ok/30 bg-ok-soft",
    danger: "border-danger/30 bg-danger-soft",
    warn: "border-brass/40 bg-brass-soft",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-4 py-3 text-sm", toneClass)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn(title && "mt-0.5")}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center sm:px-8">
      <p className="font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function AccessDenied({ message, hint }: { message: string; hint: string }) {
  return (
    <Panel className="mx-auto mt-8 max-w-lg">
      <EmptyState title={message}>{hint}</EmptyState>
    </Panel>
  );
}
