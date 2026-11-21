import { COUNTRIES, CURRENCIES } from "@/lib/regions";
import { SelectField } from "./field";

type Common = { label: string; name: string; defaultValue?: string | null; optional?: boolean; required?: boolean; hint?: string };

/** Currency picker with the group's currencies first; keeps any other stored code selectable. */
export function CurrencySelect({ label, name, defaultValue, optional, required, hint, anyLabel }: Common & { anyLabel?: string }) {
  const known = CURRENCIES.some((c) => c.code === defaultValue);
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""} optional={optional} required={required} hint={hint}>
      {anyLabel !== undefined ? <option value="">{anyLabel}</option> : null}
      {defaultValue && !known ? <option value={defaultValue}>{defaultValue}</option> : null}
      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
    </SelectField>
  );
}

export function CountrySelect({ label, name, defaultValue, required, optional, hint }: Common) {
  const known = COUNTRIES.some((c) => c.code === defaultValue);
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""} required={required} optional={optional} hint={hint}>
      {optional ? <option value="">—</option> : !defaultValue ? <option value="" disabled>Choose</option> : null}
      {defaultValue && !known ? <option value={defaultValue}>{defaultValue}</option> : null}
      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </SelectField>
  );
}
