import { SelectField } from "@/components/ui/field";
import { groupedZones } from "@/lib/timezones";

/** Time zone picker (every zone, grouped). Used for a project's local time. */
export function ZoneSelect({ label = "Time zone", name = "timezone", defaultValue, hint }: { label?: string; name?: string; defaultValue?: string | null; hint?: string }) {
  const groups = groupedZones();
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""} hint={hint}>
      <option value="">Same as the company</option>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </optgroup>
      ))}
    </SelectField>
  );
}
