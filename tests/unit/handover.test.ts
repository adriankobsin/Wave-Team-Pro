import { vi } from "vitest";

vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { buildHandover, functionFor, type HandoverDevice } from "@/lib/handover/build";

// A sample project (Harbour View Club): [deck, room, location, system, type, name, model, serial, status]
type R = [string | null, string, string | null, string, string | null, string, string | null, string | null, string];
const rows: R[] = [
  ["LD", "DRESSING ROOM", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-XG", "U7-Pro-XG", "CC21D7D46042", "commissioned"],
  ["LD", "ENGINE ROOM", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE4832407", "planned"],
  ["LD", "FOOD LIFT", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE9915975", "planned"],
  ["LD", "FREEZER ROOM", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE0461570", "planned"],
  ["LD", "KITCHEN", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE5058320", "planned"],
  ["LD", "KITCHEN", "WALL SOCKET", "LAN", "CAT6A (BLACK)", "LAN SOCKET", null, null, "planned"],
  ["LD", "KITCHEN", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-XG", "U7-Pro-XG", "CC18D3D56321", "planned"],
  ["LD", "MAN'S TOILET", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-XG", "U7-Pro-XG", "7632B0B53003", "planned"],
  ["LD", "MEC - IT RACK", null, "WAN", null, "Max BR1 Pro 5G", null, null, "planned"],
  ["LD", "MEC - IT RACK", null, "LAN", null, "Pro XG 48 PoE", null, null, "planned"],
  ["LD", "MEC - IT RACK", null, "LAN", null, "Pro XG 48 PoE", null, null, "planned"],
  ["LD", "MEC - IT RACK", null, "LAN", null, "UDM-Pro-Max", null, null, "planned"],
  ["LD", "OFFICE", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE4705646", "planned"],
  ["LD", "OFFICE", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-XG", "U7-Pro-XG", "3621B3B27F00", "planned"],
  ["LD", "RACK", null, "CCTV", null, "DHI-NVR5232-EI2", "DHI-NVR5232-EI2", "CA0F59CPAJ1C105", "planned"],
  ["MD", "AFT PORT SITTING/JACUZZY", null, "CCTV", "CAT6A (BLACK)", "DH-IPC-HDBW5442EP-ZE", "DH-IPC-HDBW5442EP-ZE", "CC0070EPAG85095", "planned"],
  ["MD", "AFT PORT SITTING/JACUZZI", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "1C0B8B0EE02B", "planned"],
  ["MD", "AFT STBD SITTING/JACUZZI", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "942A6FEC1B7E", "planned"],
  ["MD", "DANCE FLOOR MID/AFT", null, "CCTV", "CAT6A (BLACK)", "DH-IPC-HDBW5442EP-ZE", "DH-IPC-HDBW5442EP-ZE", "CC0070EPAG639BA", "planned"],
  ["MD", "FWD PORT BAR", null, "CCTV", null, "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE7751059", "planned"],
  ["MD", "FWD PORT BAR", "WALL SOCKET", "LAN", "CAT6A (BLACK)", "LAN SOCKET", null, null, "planned"],
  ["MD", "MID DANCE FLOOR", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "1C0B8B0EEB32", "planned"],
  ["MD", "MID STBD BAR", null, "CCTV", "CAT6A (BLACK)", "IPC-EBW5641-AS", "IPC-EBW5641-AS", "GE4266531", "planned"],
  ["MD", "POOL", null, "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "942A6FEC19BD", "planned"],
  ["MD", "POOL/STAGE", null, "CCTV", null, "DH-IPC-HDBW5442EP-ZE", "DH-IPC-HDBW5442EP-ZE", "CC0070EPAG7AD3F", "planned"],
  ["UD", "DJ BOOTH", null, "CCTV", "CAT6A (BLACK)", "DH-IPC-HDBW5442EP-ZE", "DH-IPC-HDBW5442EP-ZE", "CC0070EPAG57C66", "planned"],
  ["UD", "DJ BOOTH", "WALL SOCKET", "LAN", "CAT6A (BLACK)", "LAN SOCKET", null, null, "planned"],
  ["UD", "FWD PORT BAR", "ABOVE FWD PORT BAR", "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "942A6FEC1BE7", "planned"],
  ["UD", "STBD PANTRY", "WALL ENCLOSURE", "WAN", "CAT6A (BLACK)", "PEPLINK BR1 PRO - 1", null, null, "planned"],
  ["UD", "STBD PANTRY", "WALL ENCLOSURE", "WAN", "CAT6A (BLACK)", "PEPLINK BR1 PRO - 2", null, null, "planned"],
  ["UD", "VIP LOUNGE", "ABOVE THE BAR", "WI-FI", "CAT6A (BLACK)", "U7-Pro-Outdoor", "U7-Pro-Outdoor", "311A1FEC7788", "planned"],
  ["UD", "VIP LOUNGE FORWARD", null, "CCTV", null, "DH-IPC-HDBW5442EP-ZE", "DH-IPC-HDBW5442EP-ZE", "CC0070EPAG1D1DD", "planned"],
];
const devices: HandoverDevice[] = rows.map(([deck, room, location, system, type, name, model, serial, status]) => ({ deck, room, location, system, type, name, model, serial, status }));
const input = { company: "Acme Systems Thailand", project: "Harbour View Club", client: "Harbour View Club", site: "Coastal City / Thailand", manager: "John", generated: "2026-11-18 04:20", devices };

describe("handover document", () => {
  it("builds a PDF per system and per area", async () => {
    const a = await buildHandover({ ...input, preTick: true }, null);
    const b = await buildHandover({ ...input, signBy: "area" }, null);
    expect(a.subarray(0, 4).toString()).toBe("%PDF");
    expect(b.length).toBeGreaterThan(a.length / 2);
    if (process.env.HANDOVER_DEMO) { writeFileSync(`${process.env.HANDOVER_DEMO}/handover-by-system.pdf`, a); writeFileSync(`${process.env.HANDOVER_DEMO}/handover-by-area.pdf`, b); }
  });
  it("prints only the chosen parts and scope", async () => {
    const full = await buildHandover({ ...input }, null);
    const lean = await buildHandover({ ...input, scope: ["commissioning", "programming", "support"], parts: { equipment: false, function: false, checks: false, remarks: false, final: false } }, null);
    expect(lean.length).toBeGreaterThan(1000);
    expect(lean.length).toBeLessThan(full.length);
    const one = await buildHandover({ ...input, devices: devices.filter((d) => d.system === devices[0].system), scope: ["check"] }, null);
    expect(one.length).toBeLessThan(full.length);
  });
  it("knows what the common systems do and falls back for unknown ones", () => {
    expect(functionFor("CCTV").description).toMatch(/cameras/i);
    expect(functionFor("Dance lights").name).toBe("Dance lights");
    expect(functionFor("CCTV", { CCTV: { description: "Custom" } }).description).toBe("Custom");
  });
});
