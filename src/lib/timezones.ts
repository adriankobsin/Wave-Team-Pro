// Time zones grouped the way people look for them, with their current UTC offset.

const SOUTHEAST_ASIA = new Set([
  "Asia/Bangkok", "Asia/Singapore", "Asia/Phnom_Penh", "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Jakarta", "Asia/Pontianak",
  "Asia/Makassar", "Asia/Jayapura", "Asia/Ho_Chi_Minh", "Asia/Manila", "Asia/Yangon", "Asia/Vientiane", "Asia/Brunei", "Asia/Dili",
]);
const MIDDLE_EAST = new Set([
  "Asia/Dubai", "Asia/Qatar", "Asia/Riyadh", "Asia/Bahrain", "Asia/Kuwait", "Asia/Muscat", "Asia/Tehran", "Asia/Baghdad",
  "Asia/Jerusalem", "Asia/Amman", "Asia/Beirut", "Asia/Damascus", "Asia/Nicosia", "Asia/Aden", "Asia/Gaza", "Asia/Hebron", "Asia/Famagusta",
]);

export const ZONE_GROUPS = ["Europe", "Southeast Asia", "Asia", "Middle East", "Americas", "Australia & Pacific", "Africa", "Other"] as const;

function groupOf(tz: string): (typeof ZONE_GROUPS)[number] {
  if (SOUTHEAST_ASIA.has(tz)) return "Southeast Asia";
  if (MIDDLE_EAST.has(tz)) return "Middle East";
  const area = tz.split("/")[0];
  if (area === "Europe") return "Europe";
  if (area === "Asia") return "Asia";
  if (area === "America") return "Americas";
  if (area === "Australia" || area === "Pacific") return "Australia & Pacific";
  if (area === "Africa") return "Africa";
  return "Other";
}

/** "+07:00" style offset of a zone right now (or at `at`). */
export function offsetOf(tz: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return part === "GMT" ? "+00:00" : part.replace("GMT", "");
  } catch {
    return "+00:00";
  }
}

const minutes = (off: string) => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(off);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};

export const cityOf = (tz: string) => tz.split("/").slice(1).join(" / ").replace(/_/g, " ") || tz;
export const zoneLabel = (tz: string) => `(UTC${offsetOf(tz)}) ${cityOf(tz)}`;

export type ZoneOption = { value: string; label: string };

/** Every IANA time zone, grouped and sorted by offset, then city. */
export function groupedZones(): { group: string; zones: ZoneOption[] }[] {
  let all: string[];
  try {
    all = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    all = ["Europe/London", "Europe/Amsterdam", "Asia/Singapore", "Asia/Bangkok", "Asia/Phnom_Penh", "America/New_York", "UTC"];
  }
  if (!all.includes("UTC")) all = [...all, "UTC"];
  const now = new Date();
  return ZONE_GROUPS.map((group) => ({
    group,
    zones: all
      .filter((tz) => groupOf(tz) === group)
      .map((tz) => ({ tz, off: offsetOf(tz, now) }))
      .sort((a, b) => minutes(a.off) - minutes(b.off) || cityOf(a.tz).localeCompare(cityOf(b.tz)))
      .map(({ tz, off }) => ({ value: tz, label: tz === "UTC" ? "(UTC+00:00) UTC" : `(UTC${off}) ${cityOf(tz)}` })),
  })).filter((g) => g.zones.length);
}
