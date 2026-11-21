import { z } from "zod";

export const uuid = z.uuid({ message: "Invalid identifier" });

const trimmed = (max: number) => z.string().trim().max(max);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const optionalUuid = z
  .union([z.literal(""), uuid])
  .optional()
  .transform((v) => (v ? v : null));

export const displayName = trimmed(80).min(1, "Enter a name");

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address" }));

export const timeZone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Choose a valid time zone" },
);

export const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code");
export const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code");
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens");

export const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128)
  .refine((p) => /[a-z]/i.test(p) && /[0-9]/.test(p), "Include letters and at least one number");

/** Converts a ZodError into per-field messages for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function formObject(formData: FormData) {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") obj[k] = v;
  return obj;
}

/** Expands a combined "organization" | "team:<uuid>" select value into scope_type/scope_id. */
export function withScope(obj: Record<string, string>): Record<string, string> {
  const combo = obj.scope_combo;
  if (combo === undefined) return obj;
  const { scope_combo: _ignored, ...rest } = obj;
  void _ignored;
  if (combo.startsWith("team:")) return { ...rest, scope_type: "team", scope_id: combo.slice(5) };
  return { ...rest, scope_type: "organization", scope_id: "" };
}
