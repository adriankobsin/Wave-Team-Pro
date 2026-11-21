import Link from "@/components/ui/link";
import { Badge, EmptyState } from "@/components/ui/misc";
import { CATEGORY_LABEL, whenLabel, type BroadcastRow } from "@/server/services/invites";

const OUTLOOK: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  synced: { label: "In Outlook", tone: "ok" },
  pending: { label: "Waiting for Outlook", tone: "neutral" },
  failed: { label: "Outlook failed", tone: "danger" },
  skipped: { label: "Not sent to Outlook", tone: "neutral" },
};

/** Invites and updates, newest first. `hrefFor` links each one to its page. */
export function BroadcastList({ rows, tz, hrefFor, showOutlook, companyName }: {
  rows: BroadcastRow[]; tz: string; hrefFor: (b: BroadcastRow) => string; showOutlook?: boolean; companyName?: (id: string) => string | undefined;
}) {
  if (!rows.length) return <EmptyState title="Nothing yet" />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((b) => (
        <li key={b.id} className="px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={hrefFor(b)} className="min-w-0 font-medium hover:underline">{b.title}</Link>
            <span className="flex flex-wrap gap-1.5">
              <Badge>{b.kind === "invite" ? "Invite" : "Update"} · {CATEGORY_LABEL[b.category] ?? b.category}</Badge>
              {showOutlook && b.outlook ? <Badge tone={OUTLOOK[b.outlook.status]?.tone ?? "neutral"}>{OUTLOOK[b.outlook.status]?.label ?? b.outlook.status}</Badge> : null}
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            {[whenLabel(b, tz), b.location, b.attachments?.length ? `📎 ${b.attachments.length}` : null, companyName?.(b.organization_id), showOutlook ? `${b.attendee_user_ids.length} people` : null].filter(Boolean).join(" · ")}
          </p>
          {showOutlook && b.outlook?.status === "failed" && b.outlook.last_error ? <p className="mt-1 text-xs text-danger">{b.outlook.last_error}</p> : null}
        </li>
      ))}
    </ul>
  );
}
