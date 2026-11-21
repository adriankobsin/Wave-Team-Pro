import { saveManagementAlert } from "@/server/actions/alerts";
import { ActionForm } from "@/components/ui/action-form";
import { CheckboxField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel, PanelHeader } from "@/components/ui/misc";

export const ALERT_LABELS: Record<string, { title: string; hint: string }> = {
  member_joined: { title: "New employee registered", hint: "When someone finishes setting up their account from an invitation." },
  upload: { title: "Uploads", hint: "Documents, receipts, task and announcement files (never private chat attachments)." },
  timesheet_submitted: { title: "Timesheet submitted", hint: "When an employee submits their weekly timesheet." },
  clock: { title: "Clock in / clock out", hint: "Every clock in and clock out, with the time." },
  weekly_timesheets: { title: "Weekly timesheet of all employees", hint: "Every Monday: last week’s hours for everyone, with an Excel file." },
};

type Setting = { event: string; enabled: boolean; email: boolean; custom_recipients: boolean };

export function AlertSettings({ orgId, people, settings, recipients, current, emailReady }: {
  orgId: string;
  people: { membershipId: string; name: string }[];
  settings: Setting[];
  recipients: { event: string; membership_id: string }[];
  current: Record<string, string[]>;
  emailReady: boolean;
}) {
  return (
    <Panel className="mt-8">
      <PanelHeader title="Management notifications" description="By default Super Admins, HR Managers, Admins/VAs and Directors are notified. Choose different people per event if you prefer." />
      <div className="divide-y divide-line">
        {Object.entries(ALERT_LABELS).map(([event, label]) => {
          const s = settings.find((x) => x.event === event) ?? { event, enabled: true, email: false, custom_recipients: false };
          const chosen = new Set(recipients.filter((r) => r.event === event).map((r) => r.membership_id));
          return (
            <details key={event} className="px-4 py-3 sm:px-5">
              <summary className="cursor-pointer">
                <span className="font-medium">{label.title}</span>
                <span className="block text-xs text-ink-muted">
                  {s.enabled ? `Goes to: ${current[event]?.length ? current[event].join(", ") : "nobody yet"}${s.email ? " · also by email" : ""}` : "Switched off"}
                </span>
              </summary>
              <ActionForm action={saveManagementAlert} className="mt-3 space-y-3">
                <input type="hidden" name="organization_id" value={orgId} />
                <input type="hidden" name="event" value={event} />
                <p className="text-sm text-ink-muted">{label.hint}</p>
                <CheckboxField name="enabled" defaultChecked={s.enabled} label="Send this notification" />
                <CheckboxField name="email" defaultChecked={s.email} label="Also send by email" hint={emailReady ? undefined : "Needs an email provider to be connected first."} />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Who receives it</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="default" defaultChecked={!s.custom_recipients} /> Default: Super Admins, HR, Admins and Directors</label>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="custom" defaultChecked={s.custom_recipients} /> Only these people:</label>
                  <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                    {people.map((p) => (
                      <label key={p.membershipId} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="recipients" value={p.membershipId} defaultChecked={chosen.has(p.membershipId)} className="size-4" /> {p.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
              </ActionForm>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
