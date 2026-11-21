import ExcelJS from "exceljs";

/**
 * The standard IT network spreadsheet layout (e.g. Project_Network_Spreadsheet_V6.xlsx):
 * Data / Device List, Patch Panels, one sheet per switch / router / firewall / PBX / WLAN,
 * IP Scheme (VLAN blocks) and rack elevations. Sheets are recognised by their header rows,
 * so renamed or extra sheets still import. Usernames and passwords are never read.
 */

export type NetDevice = {
  deck: string | null; room: string | null; location: string | null; system: string | null; type: string | null;
  name: string; port: string | null; poeW: number | null; mac: string | null; serial: string | null; ip: string | null;
  notes: string | null; typeCode: string | null; cableLabel: string | null; patchPanel: string | null; patchPort: number | null;
  hostname?: string | null; model?: string | null; firmware?: string | null; switchPort?: string | null;
};
export type NetCable = {
  label: string | null; rack: string | null; patchPanel: string; port: number; cableType: string | null; system: string | null;
  deck: string | null; room: string | null; location: string | null; switchPort: string | null; deviceName: string | null;
  lengthM: number | null; lengthText: string | null; notes: string | null; installed: boolean;
};
export type NetEquipment = { sheet: string; title: string | null; hostname: string | null; model: string | null; mac: string | null; serial: string | null; firmware: string | null; location: string | null; ip: string | null; poeTotalW: number | null };
export type NetPort = { equipment: string; port: string; vlan: string | null; patchPort: string | null; endLocation: string | null; endDevice: string | null; poeW: number | null; endIp: string | null; notes: string | null; position: number };
export type NetVlan = { vlanId: number; name: string; ipRange: string | null; subnetMask: string | null; gateway: string | null; dns: string | null; dhcpScope: string | null; notes: string | null };
export type NetIp = { vlanId: number; address: string; deviceName: string };
export type NetRackUnit = { rack: string; unit: number; item: string };
/** A row of a cable schedule (From / To layout): one cable from a device to its patch panel or switch. */
export type ScheduleCable = {
  label: string; cableType: string | null; system: string | null; description: string | null;
  from: { deck: string | null; room: string | null; location: string | null; equipment: string | null; port: string | null; length: string | null };
  to: { deck: string | null; room: string | null; equipment: string | null; port: string | null };
  tail: string | null; length: string | null; terminated: string | null; tested: string | null; engineer: string | null;
};
export type NetworkImport = { devices: NetDevice[]; cables: NetCable[]; equipment: NetEquipment[]; ports: NetPort[]; vlans: NetVlan[]; ips: NetIp[]; racks: NetRackUnit[]; schedule: ScheduleCable[]; sheets: { name: string; kind: string; rows: number }[] };

const SECRET = /user ?name|password/i;
const JUNK = new Set(["not found", "#value!", "#n/a", "#ref!", "none", "null", "-", "?"]);

export function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v) return cellText((v as { result: ExcelJS.CellValue }).result);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: string }).text);
    if ("error" in v) return null;
    return null;
  }
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || JUNK.has(s.toLowerCase())) return null;
  return s;
}
const clean = (v: ExcelJS.CellValue) => {
  const s = cellText(v);
  return s === "0" ? null : s; // the template fills unknown cells with 0
};
const num = (v: ExcelJS.CellValue) => {
  const s = cellText(v);
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

type Grid = { name: string; rows: ExcelJS.CellValue[][] };
function grid(ws: ExcelJS.Worksheet): Grid {
  const rows: ExcelJS.CellValue[][] = [];
  const maxCol = Math.min(Math.max(ws.actualColumnCount, ws.columnCount), 60);
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const r: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= maxCol; c++) r.push(row.getCell(c).value);
    rows[n - 1] = r;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return { name: ws.name, rows };
}
const texts = (r: ExcelJS.CellValue[]) => r.map((v) => (cellText(v) ?? "").toLowerCase());
const headerIndex = (r: ExcelJS.CellValue[]) => {
  const t = texts(r);
  return (...names: string[]) => {
    for (const n of names) {
      const i = t.findIndex((x) => x === n.toLowerCase());
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = t.findIndex((x) => x.startsWith(n.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };
};
const at = (r: ExcelJS.CellValue[], i: number) => (i >= 0 ? r[i] : null);

function devicesFrom(g: Grid): NetDevice[] | null {
  const h = g.rows.slice(0, 8).findIndex((r) => { const t = texts(r); return t.includes("end device") && t.includes("type") && t.includes("system"); });
  if (h < 0) return null;
  const col = headerIndex(g.rows[h]);
  const c = {
    deck: col("Floor", "Deck"), room: col("Room"), location: col("Location"), system: col("System"), type: col("Type"), name: col("End Device"),
    port: col("End Device Port"), poe: col("PoE (W)", "PoE"), mac: col("MAC"), serial: col("Serial #", "Serial"), notes: col("Notes"), ip: col("End Device IP", "IP"),
    code: col("DeviceTypeID"), cable: col("Cable No", "Cable No."), pp: col("Patch Panel"), ppPort: col("Port"),
  };
  const out: NetDevice[] = [];
  for (const r of g.rows.slice(h + 1)) {
    const name = clean(at(r, c.name));
    if (!name) continue;
    out.push({
      deck: clean(at(r, c.deck)), room: clean(at(r, c.room)), location: clean(at(r, c.location)), system: clean(at(r, c.system)), type: clean(at(r, c.type)), name,
      port: clean(at(r, c.port)), poeW: num(at(r, c.poe)) || null, mac: clean(at(r, c.mac)), serial: clean(at(r, c.serial)), notes: clean(at(r, c.notes)),
      ip: clean(at(r, c.ip)), typeCode: clean(at(r, c.code)), cableLabel: clean(at(r, c.cable)), patchPanel: clean(at(r, c.pp)),
      patchPort: c.ppPort >= 0 && c.pp >= 0 ? num(at(r, c.ppPort)) : null,
    });
  }
  return out;
}

function cablesFrom(g: Grid): NetCable[] | null {
  const h = g.rows.slice(0, 5).findIndex((r) => { const t = texts(r); return t.includes("patch panel") && t.includes("port") && t.some((x) => x.startsWith("cable no")); });
  if (h < 0) return null;
  const col = headerIndex(g.rows[h]);
  const c = { rack: col("Rack"), pp: col("Patch Panel"), port: col("Port"), label: col("Cable No.", "Cable No"), type: col("Type"), system: col("System"), deck: col("Floor", "Deck"), room: col("Room"), location: col("Location"), sw: col("End Device SW"), device: col("Device"), tested: col("Tested\\Length", "Tested"), notes: col("Notes") };
  const seen = new Map<string, NetCable>();
  for (const r of g.rows.slice(h + 1)) {
    const pp = cellText(at(r, c.pp));
    const port = num(at(r, c.port));
    if (!pp || port === null) continue;
    const lengthText = clean(at(r, c.tested));
    const notes = clean(at(r, c.notes));
    let type = clean(at(r, c.type));
    // Some rows carry the device type in the cable-type column; keep only real cable types there.
    if (type && !/^(cat|fib|om\d|os\d|coax|rg)/i.test(type)) type = null;
    const cable: NetCable = {
      label: clean(at(r, c.label)), rack: clean(at(r, c.rack)), patchPanel: pp, port, cableType: type, system: clean(at(r, c.system)),
      deck: clean(at(r, c.deck)), room: clean(at(r, c.room)), location: clean(at(r, c.location)), switchPort: clean(at(r, c.sw)), deviceName: clean(at(r, c.device)),
      lengthM: lengthText ? num(lengthText) : null, lengthText, notes: notes && /^installed$/i.test(notes) ? null : notes, installed: Boolean(notes && /installed/i.test(notes)),
    };
    const key = `${pp}#${port}`;
    const prev = seen.get(key);
    const filled = (x: NetCable) => Object.values(x).filter((v) => v !== null && v !== false && v !== "").length;
    if (!prev || filled(cable) > filled(prev)) seen.set(key, cable);
  }
  return [...seen.values()];
}

function portsFrom(g: Grid): { equipment: NetEquipment; ports: NetPort[] } | null {
  const ph = g.rows.findIndex((r) => texts(r)[0] === "port number");
  if (ph < 0) return null;
  const eh = g.rows.slice(0, ph).findLastIndex((r) => { const t = texts(r); return t.includes("location") && (t.includes("model no") || t.some((x) => x.startsWith("model"))); });
  const title = cellText(g.rows[1]?.[0]) ?? null;
  let equipment: NetEquipment = { sheet: g.name, title, hostname: null, model: null, mac: null, serial: null, firmware: null, location: null, ip: null, poeTotalW: null };
  if (eh >= 0) {
    const col = headerIndex(g.rows[eh]);
    const v = g.rows[eh + 1] ?? [];
    equipment = {
      sheet: g.name, title, hostname: clean(at(v, col("Hostname"))), model: clean(at(v, col("Model No", "Model"))), mac: clean(at(v, col("MAC Address", "Base MAC Address", "MAC"))),
      serial: clean(at(v, col("Serial Number", "Serial"))), firmware: clean(at(v, col("Firmware Version", "Firmware"))), location: clean(at(v, col("Location"))),
      ip: clean(at(v, col("Management IP"))), poeTotalW: num(at(v, col("PoE Total (W)", "PoE Total"))),
    };
  }
  const col = headerIndex(g.rows[ph]);
  const c = { port: 0, vlan: col("VLAN"), pp: col("Patch Panel Port"), loc: col("End Device Location", "Location"), dev: col("End Device"), poe: col("PoE (W)", "PoE"), notes: col("Notes"), ip: col("End Device IP") };
  const name = g.name; // one sheet per switch / router / PBX (stacked switches share a hostname)
  const ports: NetPort[] = [];
  let pos = 0;
  for (const r of g.rows.slice(ph + 1)) {
    const port = cellText(at(r, 0));
    if (!port) continue;
    if (/^(port channel|stackwise|switch|uplink)/i.test(port) && texts(r).filter(Boolean).length > 1 && !cellText(at(r, c.dev))) break;
    ports.push({
      equipment: name, port, vlan: clean(at(r, c.vlan)), patchPort: clean(at(r, c.pp)), endLocation: clean(at(r, c.loc)), endDevice: clean(at(r, c.dev)),
      poeW: num(at(r, c.poe)) || null, endIp: clean(at(r, c.ip)), notes: clean(at(r, c.notes)), position: pos++,
    });
  }
  return { equipment, ports };
}

function wlanFrom(g: Grid): Partial<NetDevice>[] | null {
  const h = g.rows.findIndex((r) => texts(r)[0] === "device hostname");
  if (h < 0) return null;
  const col = headerIndex(g.rows[h]);
  const out: Partial<NetDevice>[] = [];
  for (const r of g.rows.slice(h + 1)) {
    const hostname = cellText(at(r, col("Device Hostname")));
    if (!hostname) continue;
    out.push({ hostname, mac: clean(at(r, col("Device MAC"))), deck: clean(at(r, col("Deck"))), location: clean(at(r, col("Location"))), switchPort: clean(at(r, col("Switchport"))), model: clean(at(r, col("Model No"))), ip: clean(at(r, col("IP Address"))), serial: clean(at(r, col("Serial Number"))), notes: clean(at(r, col("Notes"))) });
  }
  return out;
}

function vlansFrom(g: Grid): { vlans: NetVlan[]; ips: NetIp[] } | null {
  const h = g.rows.findIndex((r) => texts(r).some((t) => /vlan \(\d+\)/.test(t)));
  if (h < 0) return null;
  const head = g.rows[h];
  const vlans: NetVlan[] = [];
  const ips: NetIp[] = [];
  const label = (r: number, c: number) => (cellText(g.rows[r]?.[c]) ?? "").toLowerCase();
  head.forEach((v, c) => {
    const t = cellText(v);
    const m = t ? /^(.*?)\s*\((\d+)\)\s*$/.exec(t) : null;
    if (!m) return;
    const vlanId = Number(m[2]);
    const field = (name: string) => {
      for (let r = h + 1; r < Math.min(h + 12, g.rows.length); r++) if (label(r, c).startsWith(name)) return cellText(g.rows[r][c + 1]);
      return null;
    };
    vlans.push({ vlanId, name: m[1].replace(/\s*VLAN$/i, "").trim() || `VLAN ${vlanId}`, ipRange: field("ip range"), subnetMask: field("subnet"), gateway: field("default gateway"), dns: field("dns"), dhcpScope: field("dhcp"), notes: field("notes") });
    const used = g.rows.findIndex((r, i) => i > h && (cellText(r[c]) ?? "").toLowerCase() === "address used");
    if (used < 0) return;
    for (const r of g.rows.slice(used + 1)) {
      const address = cellText(r[c]);
      const deviceName = cellText(r[c + 1]);
      if (address && deviceName && !/^dhcp$/i.test(deviceName)) ips.push({ vlanId, address, deviceName });
    }
  });
  return vlans.length ? { vlans, ips } : null;
}

/**
 * Patch panels stacked on one sheet: a title row "Patch Panel MEC-R2-1", then a "Port | Cable No. | …"
 * header and one row per port, then the next panel. (Soar Ocean Club layout.)
 */
function stackedPanelsFrom(g: Grid): NetCable[] | null {
  const heads = g.rows.map((r, i) => ({ i, t: texts(r) })).filter(({ t }) => t[0] === "port" && t.some((x) => x.startsWith("cable no")));
  if (!heads.length || heads.some(({ t }) => t.includes("patch panel"))) return null;
  const out: NetCable[] = [];
  heads.forEach(({ i }, n) => {
    // A merged title cell repeats its text across the merged columns: one distinct text = a title row.
    const titleRow = g.rows.slice(0, i).findLastIndex((r) => /^patch ?panel\b/i.test(cellText(r[0]) ?? "") && new Set(texts(r).filter(Boolean)).size === 1);
    const title = titleRow >= 0 ? cellText(g.rows[titleRow][0])! : `Patch Panel ${n + 1}`;
    const panel = title.replace(/^patch ?panel\s*/i, "").trim() || title;
    const col = headerIndex(g.rows[i]);
    const c = { port: 0, label: col("Cable No.", "Cable No"), type: col("Type"), system: col("System"), deck: col("Floor", "Deck"), room: col("Room"), location: col("Location"), device: col("End Device"), devPort: col("End Device Port\\Int", "End Device Port"), tested: col("Tested\\Length", "Tested", "Length"), notes: col("Notes") };
    const end = n + 1 < heads.length ? heads[n + 1].i : g.rows.length;
    for (const r of g.rows.slice(i + 1, end)) {
      const port = num(at(r, c.port));
      if (port === null || !/^\s*\d+\s*$/.test(cellText(at(r, c.port)) ?? "")) continue;
      const lengthText = clean(at(r, c.tested));
      const notes = clean(at(r, c.notes));
      let type = clean(at(r, c.type));
      if (type && !/^(cat|fib|om\d|os\d|coax|rg)/i.test(type)) type = null;
      const label = clean(at(r, c.label));
      const device = clean(at(r, c.device));
      if (!label && !device && !lengthText && !notes) continue;
      out.push({
        label, rack: null, patchPanel: panel, port, cableType: type, system: clean(at(r, c.system)), deck: clean(at(r, c.deck)), room: clean(at(r, c.room)), location: clean(at(r, c.location)),
        switchPort: clean(at(r, c.devPort)), deviceName: device, lengthM: lengthText ? num(lengthText) : null, lengthText,
        notes: notes && /^installed$/i.test(notes) ? null : notes, installed: Boolean(notes && /installed/i.test(notes)),
      });
    }
  });
  return out.length ? out : null;
}

/** Wireless list whose rows start with the AP's MAC and carry its cable number (Soar layout). */
function wlanByCableFrom(g: Grid): Partial<NetDevice>[] | null {
  const h = g.rows.findIndex((r) => { const t = texts(r); return t[0] === "device mac" && t.some((x) => x.startsWith("cable")); });
  if (h < 0) return null;
  const col = headerIndex(g.rows[h]);
  const out: Partial<NetDevice>[] = [];
  for (const r of g.rows.slice(h + 1)) {
    const cable = clean(at(r, col("Cable")));
    const serial = clean(at(r, col("Serial Number")));
    const mac = clean(at(r, col("Device MAC")));
    if (!cable && !serial && !mac) continue;
    out.push({ cableLabel: cable, hostname: clean(at(r, col("Device Name"))), mac, location: clean(at(r, col("Location"))), switchPort: clean(at(r, col("Switchport"))), model: clean(at(r, col("Model No"))), ip: clean(at(r, col("IP Address"))), serial, notes: clean(at(r, col("Notes"))) });
  }
  return out.length ? out : null;
}

/** CCTV list: one row per camera with its cable, deck, patch panel port, serial and MAC. */
function camerasFrom(g: Grid): NetDevice[] | null {
  const h = g.rows.findIndex((r) => { const t = texts(r); return t.includes("camera") && t.includes("cable") && t.includes("model"); });
  if (h < 0) return null;
  const col = headerIndex(g.rows[h]);
  const out: NetDevice[] = [];
  for (const r of g.rows.slice(h + 1)) {
    const camera = clean(at(r, col("Camera")));
    const model = clean(at(r, col("Model")));
    if (!camera && !model) continue;
    const pp = clean(at(r, col("Patch Panel")));
    const m = pp ? /patch ?panel\s*([\w-]+)\s*[:,-]?\s*port\s*(\d+)/i.exec(pp) : null;
    out.push({
      deck: clean(at(r, col("Deck", "Floor"))), room: clean(at(r, col("Location"))), location: null, system: "CCTV", type: null, name: model ?? camera!, port: null, poeW: null,
      mac: clean(at(r, col("MAC Address", "MAC"))), serial: clean(at(r, col("Serial Number", "Serial"))), ip: clean(at(r, col("End Device IP", "IP"))), notes: null, typeCode: null,
      cableLabel: clean(at(r, col("Cable"))), patchPanel: m ? `Patch Panel ${m[1]}` : null, patchPort: m ? Number(m[2]) : null, hostname: camera, model, switchPort: clean(at(r, col("Switchport"))),
    });
  }
  return out.length ? out : null;
}

/**
 * IP scheme with named VLAN blocks side by side ("CCTV VLAN", "POS VLAN"…) and no VLAN numbers:
 * the number is taken from the third part of the block's address range (192.168.90.x → 90).
 */
function namedVlansFrom(g: Grid): { vlans: NetVlan[]; ips: NetIp[] } | null {
  const h = g.rows.findIndex((r) => texts(r).filter((t) => /\bvlan$/.test(t)).length >= 2);
  if (h < 0) return null;
  const head = g.rows[h];
  const vlans: NetVlan[] = [];
  const ips: NetIp[] = [];
  const used = new Set<number>();
  const label = (r: number, c: number) => (cellText(g.rows[r]?.[c]) ?? "").toLowerCase();
  head.forEach((v, c) => {
    const t = cellText(v);
    if (!t || !/\bvlan$/i.test(t)) return;
    const field = (name: string) => {
      for (let r = h + 1; r < Math.min(h + 12, g.rows.length); r++) if (label(r, c).startsWith(name)) return cellText(g.rows[r][c + 1]);
      return null;
    };
    const range = field("ip range");
    const gw = field("default gateway");
    const third = /^\d+\.\d+\.(\d+)\./.exec(range ?? gw ?? "");
    let vlanId = third ? Number(third[1]) : 4000 + vlans.length;
    while (used.has(vlanId)) vlanId++;
    used.add(vlanId);
    vlans.push({ vlanId, name: t.replace(/\s*VLAN$/i, "").trim() || t, ipRange: range, subnetMask: field("subnet"), gateway: gw, dns: field("dns"), dhcpScope: field("dhcp"), notes: field("notes") });
    const start = g.rows.findIndex((r, i) => i > h && (cellText(r[c]) ?? "").toLowerCase() === "address used");
    if (start < 0) return;
    for (const r of g.rows.slice(start + 1)) {
      const address = cellText(r[c]);
      const deviceName = cellText(r[c + 1]);
      if (address && deviceName && !/^dhcp$/i.test(deviceName)) ips.push({ vlanId, address, deviceName });
    }
  });
  return vlans.length ? { vlans, ips } : null;
}

/** Cable schedule with a "FROM … TO …" header above "CABLE NO. | CABLE TYPE | SYSTEM | …". */
function scheduleFrom(g: Grid): ScheduleCable[] | null {
  const h = g.rows.slice(0, 10).findIndex((r) => { const t = texts(r); return t.some((x) => x.startsWith("cable no")) && t.includes("cable type") && t.includes("equipment"); });
  if (h < 0) return null;
  const head = texts(g.rows[h]);
  const band = texts(g.rows[h - 1] ?? []);
  const fromAt = band.indexOf("from");
  const toAt = band.indexOf("to");
  const split = toAt > 0 ? toAt : head.indexOf("equipment") + 3;
  const find = (name: string, side: "from" | "to" | "any") => {
    const lo = side === "to" ? split : side === "from" ? Math.max(0, fromAt) : 0;
    const hi = side === "from" ? split : head.length;
    for (let i = lo; i < hi; i++) if (head[i] === name || head[i].startsWith(name)) return i;
    return -1;
  };
  // The last "length" on the "to" side is the full run; one on the "from" side is the device leg.
  const lastIndex = (name: string) => head.lastIndexOf(name);
  const c = {
    label: find("cable no", "any"), type: find("cable type", "any"), system: find("system", "any"), desc: find("description", "any"),
    fDeck: find("deck", "from") >= 0 ? find("deck", "from") : find("floor", "from"), fRoom: find("room", "from"), fLoc: find("location", "from"), fEq: find("equipment", "from"), fPort: find("port", "from"), fLen: find("length", "from"),
    tDeck: find("floor", "to") >= 0 ? find("floor", "to") : find("deck", "to"), tRoom: find("room", "to"), tEq: find("equipment", "to"), tPort: find("port", "to"),
    tail: find("tail", "any"), len: lastIndex("length") > split ? lastIndex("length") : -1, term: find("terminated", "any"), tested: find("tested", "any"), eng: find("engineer", "any") >= 0 ? find("engineer", "any") : find("engeneer", "any"),
  };
  const out: ScheduleCable[] = [];
  for (const r of g.rows.slice(h + 1)) {
    const label = clean(at(r, c.label));
    if (!label) continue;
    out.push({
      label, cableType: clean(at(r, c.type)), system: clean(at(r, c.system)), description: clean(at(r, c.desc)),
      from: { deck: clean(at(r, c.fDeck)), room: clean(at(r, c.fRoom)), location: clean(at(r, c.fLoc)), equipment: clean(at(r, c.fEq)), port: clean(at(r, c.fPort)), length: clean(at(r, c.fLen)) },
      to: { deck: clean(at(r, c.tDeck)), room: clean(at(r, c.tRoom)), equipment: clean(at(r, c.tEq)), port: clean(at(r, c.tPort)) },
      tail: clean(at(r, c.tail)), length: clean(at(r, c.len)), terminated: clean(at(r, c.term)), tested: clean(at(r, c.tested)), engineer: clean(at(r, c.eng)),
    });
  }
  return out.length ? out : null;
}

/** "PATCH PANEL 1 PORT 18", "PP1/P18", "MEC-R2-1 : 18" → panel and port. */
export function panelPort(text: string | null): { panel: string; port: number } | null {
  if (!text) return null;
  let m = /patch ?panel\s*([\w-]+)\s*[:,/-]?\s*(?:port|p)\s*(\d+)/i.exec(text);
  if (m) return { panel: `Patch Panel ${m[1]}`, port: Number(m[2]) };
  m = /^pp\s*([\w-]+?)\s*[/:-]\s*p?\s*(\d+)$/i.exec(text.trim());
  if (m) return { panel: `Patch Panel ${m[1]}`, port: Number(m[2]) };
  return null;
}

function racksFrom(g: Grid): NetRackUnit[] | null {
  // Blocks: a title like "552-R1 - COMMS RACK" above a column of U numbers with the item to their right.
  const out: NetRackUnit[] = [];
  for (let r = 0; r < Math.min(g.rows.length, 12); r++) {
    g.rows[r].forEach((v, c) => {
      const title = cellText(v);
      if (!title || !/rack/i.test(title) || !/-/.test(title)) return;
      for (let rr = r + 1; rr < g.rows.length; rr++) {
        const u = cellText(g.rows[rr]?.[c]);
        if (!u || !/^\d+$/.test(u)) { if (out.length && /max pwr|btu|device/i.test(u ?? "")) break; continue; }
        const item = cellText(g.rows[rr]?.[c + 1]);
        if (item) out.push({ rack: title, unit: Number(u), item });
      }
    });
  }
  return out.length ? out : null;
}

export async function parseNetworkSheet(bytes: ArrayBuffer | Uint8Array): Promise<NetworkImport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : bytes);
  const result: NetworkImport = { devices: [], cables: [], equipment: [], ports: [], vlans: [], ips: [], racks: [], schedule: [], sheets: [] };
  const cameras: NetDevice[] = [];
  let deviceSheetRank = -1;
  const wlan: Partial<NetDevice>[] = [];
  for (const ws of wb.worksheets) {
    const g = grid(ws);
    // Never read credentials: blank any column whose header says user name or password.
    for (const r of g.rows) r.forEach((v, i) => { if (SECRET.test(cellText(v) ?? "")) for (const rr of g.rows) rr[i] = null; });
    const sched = scheduleFrom(g);
    if (sched) { result.schedule.push(...sched); result.sheets.push({ name: g.name, kind: "cable schedule", rows: sched.length }); continue; }
    const stacked = stackedPanelsFrom(g);
    if (stacked) { result.cables.push(...stacked); result.sheets.push({ name: g.name, kind: "patch panels", rows: stacked.length }); continue; }
    const cams = camerasFrom(g);
    if (cams) { cameras.push(...cams); result.sheets.push({ name: g.name, kind: "cctv", rows: cams.length }); continue; }
    const devs = devicesFrom(g);
    if (devs) {
      // Prefer the sheet that also carries cable numbers (the "Data" sheet).
      const rank = texts(g.rows.slice(0, 8).find((r) => texts(r).includes("end device")) ?? []).includes("cable no") ? 2 : 1;
      if (rank > deviceSheetRank) { result.devices = devs; deviceSheetRank = rank; }
      result.sheets.push({ name: g.name, kind: "devices", rows: devs.length });
      continue;
    }
    const cables = cablesFrom(g);
    if (cables) { result.cables = cables; result.sheets.push({ name: g.name, kind: "patch panels", rows: cables.length }); continue; }
    const wc = wlanByCableFrom(g);
    if (wc) {
      wlan.push(...wc);
      result.sheets.push({ name: g.name, kind: "wireless", rows: wc.length });
      const eh = g.rows.findIndex((r) => texts(r).some((x) => x.startsWith("model no")) && texts(r).includes("location"));
      if (eh >= 0 && eh < g.rows.findIndex((r) => texts(r)[0] === "device mac")) {
        const col = headerIndex(g.rows[eh]); const v = g.rows[eh + 1] ?? [];
        result.equipment.push({ sheet: g.name, title: cellText(g.rows[1]?.[0]), hostname: clean(at(v, col("Controller Name", "Hostname"))), model: clean(at(v, col("Model No (Controller)", "Model No"))), mac: clean(at(v, col("Base MAC Address", "MAC Address"))), serial: clean(at(v, col("Serial Number"))), firmware: clean(at(v, col("Version", "Firmware"))), location: clean(at(v, col("Location"))), ip: clean(at(v, col("Mgmt IP", "Management IP"))), poeTotalW: null });
      }
      continue;
    }
    const w = wlanFrom(g);
    if (w) {
      wlan.push(...w);
      const p = portsFrom(g);
      result.sheets.push({ name: g.name, kind: "wireless", rows: w.length });
      if (p) { result.equipment.push(p.equipment); }
      else {
        const eh = g.rows.findIndex((r) => texts(r).includes("hostname"));
        if (eh >= 0) {
          const col = headerIndex(g.rows[eh]); const v = g.rows[eh + 1] ?? [];
          result.equipment.push({ sheet: g.name, title: cellText(g.rows[1]?.[0]), hostname: clean(at(v, col("Hostname"))), model: clean(at(v, col("Model No (Controller)", "Model No"))), mac: clean(at(v, col("MAC Address"))), serial: clean(at(v, col("Serial Number"))), firmware: clean(at(v, col("Firmware"))), location: clean(at(v, col("Location"))), ip: clean(at(v, col("Management IP"))), poeTotalW: null });
        }
      }
      continue;
    }
    const p = portsFrom(g);
    if (p) { result.equipment.push(p.equipment); result.ports.push(...p.ports); result.sheets.push({ name: g.name, kind: "ports", rows: p.ports.length }); continue; }
    const v = vlansFrom(g) ?? namedVlansFrom(g);
    if (v) { result.vlans = v.vlans; result.ips = v.ips; result.sheets.push({ name: g.name, kind: "ip scheme", rows: v.vlans.length }); continue; }
    const racks = racksFrom(g);
    if (racks) { result.racks.push(...racks); result.sheets.push({ name: g.name, kind: "racks", rows: racks.length }); continue; }
    result.sheets.push({ name: g.name, kind: "skipped", rows: 0 });
  }
  // Enrich devices with the wireless list (hostname, model, serial, switch port, cable) by IP, then MAC
  // (a serial number that is the MAC without colons counts as the MAC).
  const hex = (v: string | null | undefined) => (v ? v.replace(/[^0-9a-f]/gi, "").toLowerCase() : "");
  const sameHw = (a: Partial<NetDevice>, b: Partial<NetDevice>) => {
    const ids = [hex(a.mac), hex(a.serial)].filter((x) => x.length >= 8);
    return ids.length > 0 && [hex(b.mac), hex(b.serial)].some((x) => x.length >= 8 && ids.includes(x));
  };
  for (const w of wlan) {
    const d = result.devices.find((x) => (w.ip && x.ip === w.ip) || sameHw(w, x));
    if (d) Object.assign(d, { hostname: w.hostname ?? d.hostname ?? null, model: w.model ?? d.model ?? null, serial: d.serial ?? w.serial ?? null, switchPort: w.switchPort ?? d.switchPort ?? null, mac: d.mac ?? w.mac ?? null, cableLabel: d.cableLabel ?? w.cableLabel ?? null });
  }
  // Cameras: fill the device list's matching camera, or add it when the list doesn't have it.
  const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const camTaken = new Set<NetDevice>();
  for (const cam of cameras) {
    // By MAC/serial, else the same model in the same room that no other camera has claimed.
    const d = result.devices.find((x) => sameHw(cam, x)) ??
      result.devices.find((x) => !camTaken.has(x) && !x.mac && !x.cableLabel && norm(x.name) === norm(cam.name) && norm(x.room) && norm(x.room) === norm(cam.room));
    if (d) camTaken.add(d);
    if (d) Object.assign(d, { hostname: d.hostname ?? cam.hostname, model: d.model ?? cam.model, serial: d.serial ?? cam.serial, mac: d.mac ?? cam.mac, ip: d.ip ?? cam.ip, cableLabel: d.cableLabel ?? cam.cableLabel, patchPanel: d.patchPanel ?? cam.patchPanel, patchPort: d.patchPort ?? cam.patchPort, deck: d.deck ?? cam.deck, room: d.room ?? cam.room, system: d.system ?? "CCTV" });
    else result.devices.push({ ...cam, notes: "From the CCTV sheet (no matching row in the device list)" });
  }
  // Devices without a cable number: take it from the patch panel row for the same device in the same room.
  const taken = new Set(result.devices.map((d) => d.cableLabel).filter(Boolean));
  for (const d of result.devices) {
    if (d.cableLabel) continue;
    const c = result.cables.find((x) => x.label && !taken.has(x.label) && norm(x.deviceName) === norm(d.name) && norm(x.room) && norm(x.room) === norm(d.room));
    if (c) { d.cableLabel = c.label; taken.add(c.label); }
  }
  // Equipment headers (switches, router, firewall, PBX, WLC) fill model/firmware/serial on matching devices.
  for (const e of result.equipment) {
    const d = result.devices.find((x) => e.ip && x.ip === e.ip);
    if (d) Object.assign(d, { hostname: d.hostname ?? e.hostname, model: d.model ?? e.model, firmware: e.firmware, serial: d.serial ?? e.serial, mac: d.mac ?? e.mac });
  }
  return result;
}
