/**
 * Date helpers that work on plain "YYYY-MM-DD" strings (calendar dates) and on instants,
 * always interpreting calendar dates in an explicit IANA time zone. No local-time
 * assumptions, so DST changes and overnight shifts are handled consistently.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Today's calendar date in a time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Offset (minutes) of a time zone at a given instant, e.g. +60 for London in summer. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock date + "HH:MM" in a time zone to a UTC instant (ISO string). */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m));
  let offset = tzOffsetMinutes(tz, guess);
  let utc = new Date(guess.getTime() - offset * 60000);
  // Re-evaluate once near DST transitions.
  const offset2 = tzOffsetMinutes(tz, utc);
  if (offset2 !== offset) {
    offset = offset2;
    utc = new Date(guess.getTime() - offset * 60000);
  }
  return utc.toISOString();
}

/** Calendar date of an instant in a time zone. */
export function dateOf(iso: string, tz: string): string {
  return todayIn(tz, new Date(iso));
}

export function timeOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
}

export type Punch = { kind: "clock_in" | "clock_out" | "break_start" | "break_end"; occurred_at: string };

export type WorkSession = { start: string; end: string | null; breakMinutes: number; workedMinutes: number };

/**
 * Folds an ordered list of punches into work sessions. An open session (no clock-out yet)
 * is measured up to `now`. Unmatched or out-of-order punches are ignored rather than
 * producing negative time.
 */
export function sessionsFrom(punches: Punch[], now: Date = new Date()): WorkSession[] {
  const sorted = [...punches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const out: WorkSession[] = [];
  let cur: { start: number; breakMs: number; breakStart: number | null } | null = null;
  for (const p of sorted) {
    const t = Date.parse(p.occurred_at);
    if (p.kind === "clock_in") {
      if (!cur) cur = { start: t, breakMs: 0, breakStart: null };
    } else if (!cur) {
      continue;
    } else if (p.kind === "break_start") {
      if (cur.breakStart === null) cur.breakStart = t;
    } else if (p.kind === "break_end") {
      if (cur.breakStart !== null) {
        cur.breakMs += Math.max(0, t - cur.breakStart);
        cur.breakStart = null;
      }
    } else if (p.kind === "clock_out") {
      if (cur.breakStart !== null) cur.breakMs += Math.max(0, t - cur.breakStart);
      const total = Math.max(0, t - cur.start);
      out.push({
        start: new Date(cur.start).toISOString(),
        end: new Date(t).toISOString(),
        breakMinutes: Math.round(cur.breakMs / 60000),
        workedMinutes: Math.max(0, Math.round((total - cur.breakMs) / 60000)),
      });
      cur = null;
    }
  }
  if (cur) {
    const n = now.getTime();
    const openBreak = cur.breakStart !== null ? Math.max(0, n - cur.breakStart) : 0;
    const total = Math.max(0, n - cur.start);
    out.push({
      start: new Date(cur.start).toISOString(),
      end: null,
      breakMinutes: Math.round((cur.breakMs + openBreak) / 60000),
      workedMinutes: Math.max(0, Math.round((total - cur.breakMs - openBreak) / 60000)),
    });
  }
  return out;
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} m` : `${m} m`;
}

/** Sum of worked minutes per calendar day (session attributed to the day it started). */
export function minutesByDay(sessions: WorkSession[], tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    const d = dateOf(s.start, tz);
    out[d] = (out[d] ?? 0) + s.workedMinutes;
  }
  return out;
}

export type ProjectPunch = Punch & { project_id?: string | null };
export type ProjectSession = WorkSession & { projectId: string | null };

/** Like sessionsFrom, keeping the project chosen at each clock-in. */
export function projectSessionsFrom(punches: ProjectPunch[], now: Date = new Date()): ProjectSession[] {
  const sorted = [...punches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const out: ProjectSession[] = [];
  let open: { projectId: string | null; punches: Punch[] } | null = null;
  for (const p of sorted) {
    if (p.kind === "clock_in" && !open) open = { projectId: p.project_id ?? null, punches: [p] };
    else if (open) {
      open.punches.push(p);
      if (p.kind === "clock_out") {
        out.push(...sessionsFrom(open.punches, now).map((s) => ({ ...s, projectId: open!.projectId })));
        open = null;
      }
    }
  }
  if (open) out.push(...sessionsFrom(open.punches, now).map((s) => ({ ...s, projectId: open!.projectId })));
  return out;
}

/**
 * Time zones follow the project being worked on: a clock-in on a Thailand project is Bangkok time,
 * Singapore is Singapore time, a French yard is Paris time. `zones` maps project id → zone; anything
 * without a project (or a project without a zone) uses `fallback`.
 */
export type ProjectZones = ReadonlyMap<string, string>;

export const zoneOfProject = (projectId: string | null | undefined, zones: ProjectZones | undefined, fallback: string): string =>
  (projectId ? zones?.get(projectId) : undefined) ?? fallback;

/** Worked minutes per day (the day a session started, in tz) and project. Key: `${date}|${projectId ?? ""}`. */
export function minutesByDayProject(sessions: ProjectSession[], tz: string, zones?: ProjectZones): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    const k = `${dateOf(s.start, zoneOfProject(s.projectId, zones, tz))}|${s.projectId ?? ""}`;
    out.set(k, (out.get(k) ?? 0) + s.workedMinutes);
  }
  return out;
}

/** The zone of every punch (same order as given): a punch belongs to the project of its clock-in. */
export function punchZones(punches: ProjectPunch[], zones: ProjectZones | undefined, fallback: string): string[] {
  const order = punches.map((p, i) => ({ p, i })).sort((a, b) => Date.parse(a.p.occurred_at) - Date.parse(b.p.occurred_at) || a.i - b.i);
  const out: string[] = new Array(punches.length).fill(fallback);
  let current = fallback;
  for (const { p, i } of order) {
    if (p.kind === "clock_in") current = zoneOfProject(p.project_id, zones, fallback);
    out[i] = current;
    if (p.kind === "clock_out") current = fallback;
  }
  return out;
}

/** Worked minutes per calendar day, each session counted on its start day in its own project's zone. */
export function minutesByDayZoned(sessions: ProjectSession[], zones: ProjectZones | undefined, fallback: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    const d = dateOf(s.start, zoneOfProject(s.projectId, zones, fallback));
    out[d] = (out[d] ?? 0) + s.workedMinutes;
  }
  return out;
}

/** Short place name for a zone: "Asia/Bangkok" → "Bangkok". */
export const zoneCity = (tz: string): string => tz.split("/").slice(1).join(" / ").replace(/_/g, " ") || tz;
