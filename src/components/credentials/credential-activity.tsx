import { Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import type { CredentialEvent } from "@/server/services/credentials";

const VERB: Record<string, string> = { created: "added", updated: "changed", password_changed: "changed the password of", revealed: "looked at the password of", removed: "removed" };

/** Who added, changed, looked at or removed which login, newest first. */
export function CredentialActivity({ events, timeZone }: { events: CredentialEvent[]; timeZone: string }) {
  if (!events.length) return null;
  return (
    <Panel>
      <PanelHeader title="Activity" description="Every add, change, password shown and removal is recorded. Only people who manage logins see this." />
      <ul className="divide-y divide-line text-sm">
        {events.map((e, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-2">
            <span><span className="font-medium">{e.who}</span> {VERB[e.action] ?? e.action} <span className="font-medium">{e.name}</span></span>
            <span className="text-xs text-ink-muted">{formatDateTime(e.at, timeZone)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
