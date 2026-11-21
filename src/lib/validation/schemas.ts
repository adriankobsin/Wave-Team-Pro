import { z } from "zod";
import { country, currency, displayName, email, optionalText, optionalUuid, slug, timeZone, uuid } from "./common";
import { PERMISSIONS } from "@/lib/permissions/catalog";

export const profileUpdateSchema = z.object({
  display_name: displayName,
  locale: z.enum(["en", "ro"]),
  timezone: timeZone,
  phone: z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\+?[0-9 ()-]{6,24}$/.test(v), "Use digits, spaces and an optional leading +"),
});

export const inviteSchema = z.object({
  organization_id: uuid,
  email,
  display_name: optionalText(80),
  role_id: uuid,
  department_id: optionalUuid,
  team_id: optionalUuid,
  manager_membership_id: optionalUuid,
  job_title: optionalText(120),
  employee_number: optionalText(40),
  start_date: z
    .union([z.literal(""), z.iso.date()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const membershipUpdateSchema = z.object({
  organization_id: uuid,
  membership_id: uuid,
  job_title: optionalText(120),
  employee_number: optionalText(40),
  department_id: optionalUuid,
  manager_membership_id: optionalUuid,
  start_date: z
    .union([z.literal(""), z.iso.date()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const roleSchema = z.object({
  organization_id: uuid,
  role_id: optionalUuid,
  name: z.string().trim().min(2, "Use at least 2 characters").max(60),
  description: optionalText(300),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export const assignmentSchema = z
  .object({
    organization_id: uuid,
    membership_id: uuid,
    role_id: uuid,
    scope_type: z.enum(["organization", "team"]),
    scope_id: optionalUuid,
  })
  .refine((v) => (v.scope_type === "organization") === (v.scope_id === null), {
    message: "Choose a team for team-scoped roles",
    path: ["scope_id"],
  });

export const overrideSchema = z
  .object({
    organization_id: uuid,
    membership_id: uuid,
    permission_key: z.enum(PERMISSIONS),
    effect: z.enum(["grant", "deny"]),
    scope_type: z.enum(["organization", "team"]),
    scope_id: optionalUuid,
    reason: z.string().trim().min(3, "Explain why (at least 3 characters)").max(300),
    expires_at: z
      .union([z.literal(""), z.iso.date()])
      .optional()
      .transform((v) => (v ? new Date(`${v}T23:59:59Z`).toISOString() : null)),
  })
  .refine((v) => (v.scope_type === "organization") === (v.scope_id === null), {
    message: "Choose a team for team-scoped overrides",
    path: ["scope_id"],
  });

export const departmentSchema = z.object({
  organization_id: uuid,
  name: z.string().trim().min(1, "Enter a name").max(80),
  code: optionalText(32),
});

export const teamSchema = z.object({
  organization_id: uuid,
  name: z.string().trim().min(1, "Enter a name").max(80),
  department_id: optionalUuid,
  description: optionalText(500),
});

export const orgSettingsSchema = z.object({
  organization_id: uuid,
  name: z.string().trim().min(2).max(120),
  legal_entity_code: optionalText(64),
  base_currency: currency,
  timezone: timeZone,
  country,
  mfa_required_for_sensitive: z.literal("on").optional().transform((v) => v === "on"),
  directory_show_email: z.literal("on").optional().transform((v) => v === "on"),
  invitation_expiry_days: z.coerce.number().int().min(1).max(30),
  site_toolkit_enabled: z.literal("on").optional().transform((v) => v === "on"),
});

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  base_currency: currency,
  timezone: timeZone,
  country,
  legal_entity_code: optionalText(64),
  admin_email: email,
  admin_name: optionalText(80),
});
