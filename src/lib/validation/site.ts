import { z } from "zod";

/** Text columns that can be typed into straight from the schedules. */
export const CABLE_FIELDS = ["deck", "room", "location", "label", "cable_type", "system", "device_name", "switch_port", "notes"] as const;
export const DEVICE_FIELDS = ["name", "manufacturer", "model", "type", "system", "deck", "room", "location", "ip", "mac", "serial", "hostname", "firmware", "switch_port", "notes"] as const;
export const PORT_FIELDS = ["port", "vlan", "patch_port", "end_location", "end_device", "end_ip", "notes"] as const;
export const EQUIPMENT_FIELDS = ["sheet", "title", "hostname", "model", "mac", "serial", "firmware", "location", "ip"] as const;
const FIELD_MAX: Record<string, number> = { notes: 4000, end_device: 200, end_location: 120, sheet: 80, title: 200, port: 40, name: 200, device_name: 200, location: 120, label: 120, model: 120 };
const fieldValue = (k: string) => z.string().trim().max(FIELD_MAX[k] ?? 80).nullable().transform((v) => v || null);

/** Any subset of the allowed columns; blank text becomes empty (null). */
export const fieldsSchema = <K extends string>(keys: readonly K[]) =>
  z.partialRecord(z.enum(keys as unknown as [K, ...K[]]), z.string().nullable()).optional()
    .superRefine((v, ctx) => { for (const [k, x] of Object.entries(v ?? {})) { if (!fieldValue(k).safeParse(x).success) ctx.addIssue({ code: "custom", message: `That ${k.replace("_", " ")} is too long.` }); } })
    .transform((v) => v && (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fieldValue(k).parse(x)])) as Partial<Record<K, string | null>>));
