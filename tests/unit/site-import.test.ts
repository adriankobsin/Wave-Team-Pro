import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { joinWrapped, parseIntegrationReport, parseLoadSchedule } from "@/lib/import/lutron";
import { panelPort, parseNetworkSheet } from "@/lib/import/network-sheet";
import type { PdfItem } from "@/lib/import/pdf-text";

const it_ = (page: number, x: number, y: number, str: string): PdfItem => ({ page, x, y, str });

describe("Lutron integration report", () => {
  const header = (p: number) => [it_(p, 40, 560, "Device name"), it_(p, 150, 560, "Model"), it_(p, 230, 560, "href"), it_(p, 300, 560, "Component"), it_(p, 370, 560, "Component href"), it_(p, 460, 560, "Component Name")];
  const items: PdfItem[] = [
    ...header(1),
    it_(1, 40, 540, "TANK DECK\\HAIRDRESSER"), it_(1, 150, 540, "HQWT-S-P4W-SN"), it_(1, 230, 540, "/device/7384"), it_(1, 300, 540, "Button 1"), it_(1, 370, 540, "/button/7394"),
    it_(1, 40, 530, "112\\ENTRANCE\\Device 1"),
    it_(1, 300, 520, "Button 2"), it_(1, 370, 520, "/button/7398"),
    it_(1, 36, 24, "File Name:"), it_(1, 80, 24, "SG-78Y-PHY"),
    ...header(2),
    it_(2, 40, 540, "TANK DECK\\HAIRDRESSER"), it_(2, 150, 540, "HQWT-S-P4W-SN"), it_(2, 230, 540, "/device/7384"), it_(2, 300, 540, "Led 1"), it_(2, 370, 540, "/led/7389"),
    it_(2, 40, 530, "112\\ENTRANCE\\Device 1"),
    it_(3, 40, 560, "Zone Name"), it_(3, 300, 560, "href"),
    it_(3, 40, 540, "TANK DECK\\HAIRDRESSER 112\\DOWNLIGHTS"), it_(3, 300, 540, "/zone/5647"),
    it_(3, 40, 520, "Area Name"), it_(3, 300, 520, "href"),
    it_(3, 40, 500, "TANK DECK\\HAIRDRESSER 112"), it_(3, 300, 500, "/area/523"),
  ];
  const out = parseIntegrationReport(items);

  it("reads devices with wrapped names, their buttons and LEDs across pages, zones and areas", () => {
    const dev = out.find((i) => i.kind === "device")!;
    expect(dev).toMatchObject({ path: "TANK DECK\\HAIRDRESSER 112\\ENTRANCE\\Device 1", integrationId: 7384, model: "HQWT-S-P4W-SN" });
    expect(out.filter((i) => i.deviceHref === "/device/7384").map((i) => i.component)).toEqual(["Button 1", "Button 2", "Led 1"]);
    expect(out.find((i) => i.kind === "zone")).toMatchObject({ path: "TANK DECK\\HAIRDRESSER 112\\DOWNLIGHTS", integrationId: 5647 });
    expect(out.find((i) => i.kind === "area")?.integrationId).toBe(523);
    expect(out.some((i) => i.path.includes("SG-78Y"))).toBe(false); // page footer ignored
  });

  it("re-joins words split mid-way when a known name says so", () => {
    expect(joinWrapped(["HEARDRESSE", "R", "DOWNLIGHTS"], new Set(["HEARDRESSER DOWNLIGHTS"]))).toBe("HEARDRESSER DOWNLIGHTS");
    expect(joinWrapped(["HALL", "DOWNLIGHTS"])).toBe("HALL DOWNLIGHTS");
  });
});

describe("Lutron load schedule", () => {
  const head = (y: number) => [it_(1, 39, y, "Zone #"), it_(1, 77, y, "Zone Name"), it_(1, 144, y, "Zone"), it_(1, 212, y, "Load #"), it_(1, 249, y, "Feed"), it_(1, 297, y, "Fixture (Qty)"), it_(1, 437, y, "Load Type"), it_(1, 576, y, "Assigned To"), it_(1, 716, y, "Total")];
  const items = [
    it_(1, 40, 538, "TANK DECK\\HAIRDRESSER 112"), ...head(517),
    it_(1, 39, 490, "2"), it_(1, 76, 490, "HEARDRESSE"), it_(1, 144, 490, "HAIRDRESSE"), it_(1, 211, 490, "5"), it_(1, 297, 490, "TYPE A (1)"), it_(1, 436, 490, "LED DALI"), it_(1, 576, 490, "TANK DECK\\LCC 02A\\LCC 02A"), it_(1, 715, 490, "11"),
    it_(1, 76, 480, "R"), it_(1, 144, 480, "R 112"), it_(1, 576, 480, "DALI-MODULE\\Loop 2"),
    it_(1, 76, 470, "DOWNLIGHTS"),
    it_(1, 39, 450, "3"), it_(1, 76, 450, "STAR LIGHT"), it_(1, 211, 450, "6"), it_(1, 297, 450, "DMX (1)"), it_(1, 436, 450, "DMX 3-Channel Lighting"), it_(1, 576, 450, "TANK DECK\\LCC 02A\\LCC02A"), it_(1, 715, 450, "Unspecifi"),
    it_(1, 576, 440, "DMX 001\\Output 2"), it_(1, 715, 440, "ed"),
  ];
  it("reads each load with panel, module and loop, matching zone names to the integration report", () => {
    const loads = parseLoadSchedule(items, new Set(["TANK DECK\\HAIRDRESSER 112\\HEARDRESSER DOWNLIGHTS"]));
    expect(loads).toHaveLength(2);
    expect(loads[0]).toMatchObject({ area: "TANK DECK\\HAIRDRESSER 112", zoneNumber: 2, zoneName: "HEARDRESSER DOWNLIGHTS", loadNumber: 5, fixture: "TYPE A", quantity: 1, loadType: "LED DALI", panel: "TANK DECK\\LCC 02A", module: "LCC 02A DALI-MODULE", output: "Loop 2", wattage: 11 });
    expect(loads[1]).toMatchObject({ zoneName: "STAR LIGHT", module: "LCC02A DMX 001", output: "Output 2", wattage: null });
  });
});

describe("Network spreadsheet", () => {
  it("reads devices, patch panels, switch ports, VLANs and racks — never usernames or passwords", async () => {
    const wb = new ExcelJS.Workbook();
    const d = wb.addWorksheet("Data");
    d.addRow([]); d.addRow([]);
    d.addRow([null, "Floor", "Room", "Location", "System", "Type", "End Device", "End Device Port", "PoE (W)", "MAC", "Serial #", "Username", "Password", "Notes", "End Device IP", "DeviceTypeID", "Cable No", "Patch Panel", "Port"]);
    d.addRow([null, "BD", 501, "GYM", "AV", "Touch Panel", "Crestron TSW - 501", 0, 30, "C4:42:68:81:CF:59", "2540JBH19965", "AdminCrestron", "S3cret!", "None", "192.168.15.100", "TP", "AV-MEC552-R2-PP1-P5-BD501-TP1", "MEC552-R2-PP1", 5]);
    const pp = wb.addWorksheet("Patch Panels");
    pp.addRow(["RACK", "Patch Panel", "Port", "Cable No.", "Type", "System", "Floor", "Room", "Location", "End Device SW", "Device", "Tested\\Length", "Notes"]);
    pp.addRow([552, "MEC552-R2-PP1", 5, "AV-MEC552-R2-PP1-P5-BD501-TP1", "CAT6A", "AV", "BD", 501, "GYM", "Not Found", "Crestron TSW - 501", "27.4", "installed"]);
    pp.addRow([552, "MEC552-R2-PP1", 6, null, "CAT6A", "Not Found", "Not Found", "Not Found", "Not Found", "Not Found", "Not Found", null, null]);
    const sw = wb.addWorksheet("MEC 552 Core Sw1");
    sw.addRow(["M/Y Seabreeze"]); sw.addRow(["MEC Core Stack Switch"]); sw.addRow([]);
    sw.addRow(["Hostname", "MAC Address", "Firmware", "Location", "Model No", "PoE Total (W)", "Serial Number", "Management IP", "Username", "Password"]);
    sw.addRow(["SEABREEZE-552-Sw1C", "38:AA:09:93:32:80", "17.15.5", "MEC 552", "C9300L-48P-E", 1100, "FVH2923LCXJ", "192.168.10.1", "acmecorp", "S3cret!"]);
    sw.addRow(["Port Number", "VLAN", "Patch Panel Port", "End Device Location", "End Device", "PoE (W)", "Notes", "End Device IP", "End Device Username", "End Device Password"]);
    sw.addRow(["Gi1/0/05", 15, "MEC552-R2-PP1", 501, "Crestron TSW - 501", 30, "#VALUE!", "192.168.15.100", "AdminCrestron", "S3cret!"]);
    const ip = wb.addWorksheet("IP Scheme");
    ip.addRow(["M/Y Seabreeze"]); ip.addRow([]);
    ip.addRow(["Network VLAN (10)", null, null, "Voice VLAN (15)"]);
    ip.addRow(["IP Range", "192.168.10.1 – 192.168.10.254", null, "IP Range", "192.168.15.1 – 192.168.15.254"]);
    ip.addRow(["Address Used", "Device Name", null, "Address Used", "Device Name"]);
    ip.addRow(["192.168.10.1", "Core switch", null, "192.168.15.100", "Crestron TSW - 501"]);
    ip.addRow(["192.168.10.2", "DHCP", null, null, null]);
    const rk = wb.addWorksheet("MEC 552 Rack");
    rk.addRow([]); rk.addRow([null, "552-R1 - COMMS RACK"]); rk.addRow([null, 42, "PDU"]); rk.addRow([null, 41, "BLANK"]); rk.addRow([null, "MAX PWR", 1270]);
    const n = await parseNetworkSheet(await wb.xlsx.writeBuffer() as ArrayBuffer);

    expect(n.devices).toHaveLength(1);
    expect(n.devices[0]).toMatchObject({ name: "Crestron TSW - 501", deck: "BD", room: "501", ip: "192.168.15.100", poeW: 30, notes: null, patchPanel: "MEC552-R2-PP1", patchPort: 5 });
    expect(n.cables).toHaveLength(2);
    expect(n.cables[0]).toMatchObject({ label: "AV-MEC552-R2-PP1-P5-BD501-TP1", lengthM: 27.4, installed: true, switchPort: null });
    expect(n.cables[1]).toMatchObject({ label: null, system: null });
    expect(n.equipment[0]).toMatchObject({ sheet: "MEC 552 Core Sw1", hostname: "SEABREEZE-552-Sw1C", model: "C9300L-48P-E", poeTotalW: 1100, ip: "192.168.10.1" });
    expect(n.ports[0]).toMatchObject({ equipment: "MEC 552 Core Sw1", port: "Gi1/0/05", vlan: "15", endDevice: "Crestron TSW - 501", notes: null });
    expect(n.vlans.map((v) => [v.vlanId, v.name])).toEqual([[10, "Network"], [15, "Voice"]]);
    expect(n.ips).toEqual([{ vlanId: 10, address: "192.168.10.1", deviceName: "Core switch" }, { vlanId: 15, address: "192.168.15.100", deviceName: "Crestron TSW - 501" }]);
    expect(n.racks).toEqual([{ rack: "552-R1 - COMMS RACK", unit: 42, item: "PDU" }, { rack: "552-R1 - COMMS RACK", unit: 41, item: "BLANK" }]);
    expect(JSON.stringify(n)).not.toMatch(/S3cret|AdminCrestron|acmecorp/);
  });
});

describe("schedule cell edits", async () => {
  const { CABLE_FIELDS, fieldsSchema } = await import("@/lib/validation/site");
  const s = fieldsSchema(CABLE_FIELDS);
  it("accepts any single column, trims, and turns blanks into empty", () => {
    expect(s.parse({ room: "  OD-401 " })).toEqual({ room: "OD-401" });
    expect(s.parse({ deck: "" })).toEqual({ deck: null });
    expect(s.parse({ room: "A", deck: "MD" })).toEqual({ room: "A", deck: "MD" });
  });
  it("rejects unknown columns and over-long values", () => {
    expect(s.safeParse({ test_result: "passed" }).success).toBe(false);
    expect(s.safeParse({ room: "x".repeat(81) }).success).toBe(false);
  });
  it("reads stacked patch panels, WLAN and CCTV by cable, and named VLANs — never usernames or passwords (stacked layout)", async () => {
    const wb = new ExcelJS.Workbook();
    const pp = wb.addWorksheet("Patch Panel Schedule");
    pp.addRow(["CLUB"]); pp.addRow(["Patch Panel Schedule"]);
    pp.addRow(["Patch Panel MEC-R2-1", "Patch Panel MEC-R2-1"]); // merged title repeats its text
    const head = ["Port", "Cable No.", "Type", "Element", "System", "Floor", "Room", "Location", "End Device", "End Device Port\\Int", "Tested\\Length", "Notes"];
    pp.addRow(head);
    pp.addRow(["1", "AP1", "CAT6A (BLACK)", null, "WI-FI", "LD", "TOILET", null, "U7-Pro-XG", null, "31M", null]);
    pp.addRow(["2", null, null, null, null, null, null, null, null, null, null, null]);
    pp.addRow([]); pp.addRow(["Patch Panel MEC-R2-2"]); pp.addRow(head);
    pp.addRow(["1", "CCTV 1", "CAT6A (BLACK)", null, "CCTV", "LD", "CORRIDOR", null, "DH-CAM", null, null, null]);
    const dl = wb.addWorksheet("DEVICE LIST");
    dl.addRow(["Floor", "Room", "Location", "System", "Type", "End Device", "End Device Port", "PoE (W)", "MAC", "Serial #", "Username", "Password", "Notes", "Installed"]);
    dl.addRow(["LD", "MAN'S TOILET", null, null, null, "U7-Pro-XG", null, null, "90:41:B2:B8:66:88", null, "admin", "S3cret!", null, null]);
    dl.addRow(["LD", "CORRIDOR", null, null, null, "DH-CAM", null, null, null, null, null, null, null, null]);
    const w = wb.addWorksheet("WLAN");
    w.addRow(["CLUB"]); w.addRow(["Wireless LAN"]);
    w.addRow(["Base MAC Address", null, "Controller Name", "Location", "Version", "Model No (Controller)", "Mgmt IP", "Serial Number", "Username", "Password"]);
    w.addRow([null, null, "UDM-Pro-Max", null, null, null, null, null, "admin", "S3cret!"]);
    w.addRow(["Device MAC", "CABLE ", "Device Name", "Location", "Switchport", "Model No", "IP Address", "Serial Number", "Notes"]);
    w.addRow([null, "AP1", null, "MAN'S TOILET", "Gi01", "U7-Pro-XG", null, "9041B2B86688", null]);
    const cc = wb.addWorksheet("CCTV");
    cc.addRow(["CLUB"]); cc.addRow(["CCTV"]);
    cc.addRow(["CAMERA", "CABLE", "DECK", "LOCATION", "MODEL", "PATCH PANEL", "SWITCHPORT ", "End Device IP", "End Device Username", "End Device Password", "SERIAL NUMBER", "MAC ADDRESS "]);
    cc.addRow(["CAMERA 1", "CCTV 1", "LD", "CORRIDOR", "DH-CAM", "PATCH PANEL 2 : PORT 1", null, null, "admin", "S3cret!", "CC0070", "98:F9:CC:91:23:70"]);
    const ip = wb.addWorksheet("IP Scheme");
    ip.addRow(["CLUB"]); ip.addRow(["IP Scheme"]);
    ip.addRow(["Network VLAN", null, null, "CCTV VLAN"]);
    ip.addRow(["IP Range", "192.168.10.1 – 192.168.10.254", null, "IP Range", "192.168.90.1 – 192.168.90.254"]);
    ip.addRow(["Address Used", "Device Name", null, "Address Used", "Device Name"]);
    ip.addRow(["192.168.10.1", null, null, "192.168.90.20", "CAMERA 1"]);
    const lg = wb.addWorksheet("LOGIN");
    lg.addRow([null, "ACCOUNT", "IP ADDRESS", "USERNAME", "PASSWORD"]); lg.addRow([null, "GMAIL", null, "someone@example.com", "S3cret!"]);
    const n = await parseNetworkSheet(await wb.xlsx.writeBuffer() as ArrayBuffer);

    expect(n.cables.map((c) => [c.patchPanel, c.port, c.label])).toEqual([["MEC-R2-1", 1, "AP1"], ["MEC-R2-2", 1, "CCTV 1"]]);
    expect(n.cables[0]).toMatchObject({ cableType: "CAT6A (BLACK)", system: "WI-FI", room: "TOILET", deviceName: "U7-Pro-XG", lengthM: 31 });
    expect(n.devices).toHaveLength(2);
    expect(n.devices[0]).toMatchObject({ name: "U7-Pro-XG", cableLabel: "AP1", serial: "9041B2B86688", switchPort: "Gi01" });
    expect(n.devices[1]).toMatchObject({ name: "DH-CAM", cableLabel: "CCTV 1", hostname: "CAMERA 1", mac: "98:F9:CC:91:23:70", system: "CCTV" });
    expect(n.vlans.map((v) => [v.vlanId, v.name])).toEqual([[10, "Network"], [90, "CCTV"]]);
    expect(n.ips).toEqual([{ vlanId: 90, address: "192.168.90.20", deviceName: "CAMERA 1" }]);
    expect(n.sheets.find((x) => x.name === "LOGIN")?.kind).toBe("skipped");
    expect(JSON.stringify(n)).not.toMatch(/S3cret|someone@example/);
  });

  it("reads a From / To cable schedule and patch panel port texts", async () => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Cable Schedule");
    s.addRow([null, null, null, null, null, "FROM", null, null, null, null, null, "TO"]);
    s.addRow([null, "CABLE NO.", "CABLE TYPE", "SYSTEM", "DESCRIPTION", "DECK", "ROOM", "LOCATION", "EQUIPMENT", "PORT", "LENGTH", "FLOOR", "ROOM", "EQUIPMENT", "PORT", "TAIL (M)", "LENGTH", "TERMINATED", "TESTED", "ENGENEER"]);
    s.addRow([1, "AP1", "CAT6A (BLACK)", "WI-FI", "INDOOR WAP", "LD", "MENS TOILET", null, "U7-Pro-XG", "PATCH PANEL 1 PORT 18", "45M", "LD", "COMMS", "Switch 1", "Gi01", 2, "47.5", "YES", "YES", "Jyri"]);
    s.addRow([5, "AP5", "CAT6A (BLACK)", "WI-FI", null, null, "SHORE OFFICE", null, "U7-Pro-XG", null, null]);
    const n = await parseNetworkSheet(await wb.xlsx.writeBuffer() as ArrayBuffer);
    expect(n.schedule).toHaveLength(2);
    expect(n.schedule[0]).toMatchObject({
      label: "AP1", description: "INDOOR WAP", from: { deck: "LD", room: "MENS TOILET", equipment: "U7-Pro-XG", port: "PATCH PANEL 1 PORT 18", length: "45M" },
      to: { deck: "LD", room: "COMMS", equipment: "Switch 1", port: "Gi01" }, tail: "2", length: "47.5", terminated: "YES", tested: "YES", engineer: "Jyri",
    });
    expect(n.schedule[1].from.port).toBeNull();
    expect(panelPort("PATCH PANEL 1 PORT 18")).toEqual({ panel: "Patch Panel 1", port: 18 });
    expect(panelPort("PATCH PANEL 2 : PORT 1")).toEqual({ panel: "Patch Panel 2", port: 1 });
    expect(panelPort("PP1/P23")).toEqual({ panel: "Patch Panel 1", port: 23 });
    expect(panelPort("Gi01")).toBeNull();
  });
});
