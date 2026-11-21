/** Day classification for the attendance calendar. Pure so it can be unit-tested. */

export type DayKind = "worked" | "absent" | "sick" | "annual" | "other_leave" | "pending_leave" | "holiday" | "day_off" | "today" | "future" | "not_employed";

export const DAY_STYLE: Record<DayKind, { label: string; className: string; swatch: string }> = {
  worked: { label: "Worked", className: "bg-[#2f7d4f] text-white", swatch: "#2f7d4f" },
  absent: { label: "Not working (no attendance)", className: "bg-[#c0392b] text-white", swatch: "#c0392b" },
  sick: { label: "Sick leave", className: "bg-[#e67e22] text-white", swatch: "#e67e22" },
  annual: { label: "Annual leave", className: "bg-[#2e6fb7] text-white", swatch: "#2e6fb7" },
  other_leave: { label: "Other leave (unpaid, etc.)", className: "bg-[#7d4fb0] text-white", swatch: "#7d4fb0" },
  pending_leave: { label: "Leave requested (not yet approved)", className: "border-2 border-dashed border-[#2e6fb7] bg-panel text-ink", swatch: "transparent" },
  holiday: { label: "Public holiday", className: "bg-[#5d7f8c] text-white", swatch: "#5d7f8c" },
  day_off: { label: "Weekend / day off", className: "bg-panel-sunk text-ink-muted", swatch: "var(--panel-sunk, #e5e9e8)" },
  today: { label: "Today (in progress)", className: "border-2 border-ink bg-panel text-ink", swatch: "transparent" },
  future: { label: "Upcoming", className: "border border-line bg-panel text-ink-muted", swatch: "transparent" },
  not_employed: { label: "Before joining", className: "bg-panel text-ink-muted/50", swatch: "transparent" },
};

export type LeaveOnDay = { type: string; status: "approved" | "pending" };

export function leaveCategory(typeName: string): "sick" | "annual" | "other_leave" {
  if (/sick|illness|medical/i.test(typeName)) return "sick";
  if (/annual|holiday|vacation|paid time off|pto/i.test(typeName)) return "annual";
  return "other_leave";
}

export type DayInput = {
  date: string; // YYYY-MM-DD
  today: string;
  joined: string | null;
  workedMinutes: number; // from clock in/out
  loggedHours: number; // from timesheet entries
  leave: LeaveOnDay | null;
  holiday: string | null;
  scheduled: boolean; // a shift was planned
};

/** Decides one day's colour. Working days are Mon–Fri, or any day with a planned shift. */
export function classifyDay(d: DayInput): DayKind {
  if (d.joined && d.date < d.joined) return "not_employed";
  const worked = d.workedMinutes > 0 || d.loggedHours > 0;
  if (worked) return "worked";
  if (d.leave?.status === "approved") return leaveCategory(d.leave.type);
  if (d.holiday) return "holiday";
  if (d.leave?.status === "pending") return "pending_leave";
  const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
  const workingDay = d.scheduled || (weekday >= 1 && weekday <= 5);
  if (d.date > d.today) return workingDay ? "future" : "day_off";
  if (d.date === d.today) return workingDay ? "today" : "day_off";
  return workingDay ? "absent" : "day_off";
}
