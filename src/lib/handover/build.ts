import "server-only";
import { PdfReport } from "@/lib/export/pdf";
import { DECKS } from "@/lib/site-constants";

/** One installed item, as recorded on the Devices page. */
export type HandoverDevice = {
  deck: string | null; room: string | null; location: string | null; system: string | null; type: string | null;
  name: string | null; model: string | null; serial: string | null; status: string | null;
};

export type HandoverInput = {
  company: string; project: string; client: string | null; site: string | null; manager: string | null; generated: string;
  devices: HandoverDevice[];
  /** Per-system wording written for this project: system code → what it does and what to check. */
  systems?: Record<string, { name?: string; description?: string; checks?: string[] }>;
  /** One acceptance block per system (default) or per area (deck + room). */
  signBy?: "system" | "area";
  /** Tick the boxes from the recorded status (installed / commissioned / tested). Off = blank boxes to tick on site. */
  preTick?: boolean;
  /** What the document covers (ticked on the About page). Decides the tick columns. Default: installation. */
  scope?: ScopeKey[];
  /** Which parts to print. Anything missing is printed. */
  parts?: Partial<Record<PartKey, boolean>>;
};

export const SCOPES = {
  installation: { label: "Installation", col: "Installed", verb: "installed" },
  check: { label: "System check", col: "Checked", verb: "checked" },
  commissioning: { label: "Commissioning", col: "Commissioned", verb: "commissioned" },
  programming: { label: "Programming", col: "Programmed", verb: "programmed" },
  support: { label: "Technical support", col: "", verb: "" },
} as const;
export type ScopeKey = keyof typeof SCOPES;
export const PARTS = ["equipment", "function", "tick", "checks", "remarks", "sign", "final"] as const;
export type PartKey = (typeof PARTS)[number];

type Fn = { name: string; description: string; checks: string[] };

/** Standard wording, matched on the system code (anything unknown gets a generic text the project can overwrite). */
const DEFAULTS: [RegExp, Fn][] = [
  [/^(wi-?fi|wifi|wlan)$/i, { name: "Wi-Fi", description: "Wireless network coverage: access points are powered and managed by the network controller, and give secure Wi-Fi to guests, crew and devices throughout the areas listed below.", checks: ["Every access point is online in the controller", "Wi-Fi reaches every listed area and devices connect", "Roaming between access points works without dropping the connection"] }],
  [/^(it|network|lan|data)$/i, { name: "Network (LAN)", description: "The wired network: switches, firewall, controller and the wall network sockets that connect devices to it.", checks: ["Switch uplinks and PoE power are working", "Each network socket gives a link and an IP address", "Internet is reachable through the firewall"] }],
  [/^wan(\s*-.*)?$/i, { name: "Internet connections (WAN)", description: "The internet links into the network (cellular, satellite or shore connection), with automatic failover between them.", checks: ["Each WAN link is up and shows its signal / status", "Failover to the second link works when the first is unplugged", "Speed test meets the agreed level"] }],
  [/^(ant|sat|vsat)$/i, { name: "Antennas / satellite", description: "Satellite and cellular antennas that bring internet to the vessel, feeding the internet connections of the network.", checks: ["Each antenna is online and tracking", "Internet through each link tested", "Remote monitoring shows every unit"] }],
  [/^(cctv|sec|security|camera)$/i, { name: "CCTV", description: "IP cameras recorded to the video recorder, with live viewing and playback from the monitoring station and approved devices.", checks: ["Every camera shows a live picture", "Recording is running and playback works", "Remote / app viewing works for the authorised users"] }],
  [/^(av|audio|video)$/i, { name: "Audio & video", description: "Audio and video distribution: sources, amplifiers, speakers, displays and the touch panels that control them in each area.", checks: ["Every display and speaker in the area gives picture and sound", "Each source can be selected from the touch panel / keypad", "Volume and mute work in every area"] }],
  [/^(lut|lighting|lighting control)$/i, { name: "Lutron lighting control", description: "Lutron processors, keypads and lighting zones: scenes, dimming and keypad control for each area.", checks: ["Every zone turns on, off and dims", "Keypad buttons recall the engraved scenes", "Scenes and schedules are saved and run as agreed"] }],
  [/^hvac$/i, { name: "HVAC integration", description: "Air-conditioning integrated with the control system: temperature display and set-point control from keypads and touch panels.", checks: ["Temperature is shown in each area", "Set-point changes reach the air-conditioning unit", "Alarms / faults are reported"] }],
  [/^(tel|phone|telephony|pbx)$/i, { name: "Telephony & intercom", description: "Fixed and wireless phones, intercom and the telephone exchange for calls between cabins, crew areas and the bridge.", checks: ["Every handset registers and rings", "Calls between areas and to the bridge connect with clear sound", "Intercom stations call and are answered"] }],
];
const GENERIC = (name: string): Fn => ({ name, description: `${name}: the equipment listed below, installed and set up as agreed for this project.`, checks: ["All equipment is powered and communicating", "The system works as agreed in the specification"] });

export function functionFor(code: string, custom?: HandoverInput["systems"]): Fn {
  const base = DEFAULTS.find(([re]) => re.test(code.trim()))?.[1] ?? GENERIC(code);
  const c = custom?.[code];
  return { name: c?.name ?? base.name, description: c?.description ?? base.description, checks: c?.checks?.length ? c.checks : base.checks };
}

const deckName = (d: string | null) => (d ? DECKS[d] ?? d : "");
const areaOf = (d: HandoverDevice) => [deckName(d.deck), d.room, d.location].filter(Boolean).join(" · ") || "Not located";
const installedStatus = new Set(["installed", "commissioned", "tested"]);
const workingStatus = new Set(["commissioned", "tested"]);
const clean = (list: HandoverDevice[]) => list.filter((d) => d.name && !(d.name === "End Device" && d.system === "System"));
const label = (d: HandoverDevice) => d.name ?? d.type ?? "Item";

export async function buildHandover(input: HandoverInput, logo: { png: Buffer } | null) {
  const devices = clean(input.devices);
  const pre = Boolean(input.preTick);
  const by = input.signBy ?? "system";
  const scope: ScopeKey[] = input.scope?.length ? input.scope : ["installation"];
  const on = (k: PartKey) => input.parts?.[k] !== false;
  const cols = scope.filter((k) => SCOPES[k].col);
  const verbs = cols.map((k) => SCOPES[k].verb);
  const doneText = verbs.length ? verbs.length > 1 ? `${verbs.slice(0, -1).join(", ")} and ${verbs[verbs.length - 1]}` : verbs[0] : "handed over";
  const colStatus = (k: ScopeKey, st: string) => k === "installation" ? installedStatus.has(st) : k === "programming" ? false : workingStatus.has(st);
  const client = input.client || "the client";
  const pdf = await PdfReport.create(`${input.company} · ${input.project} · Handover document · ${input.generated.slice(0, 10)}`, logo, { numbersAtEnd: true, noFirstPage: true });
  pdf.cover({
    company: input.company, kind: "Handover document", title: input.project, subtitle: input.site ?? undefined,
    details: [["Client", input.client ?? ""], ["Contractor", input.company], ["Site", input.site ?? ""], ["Project manager", input.manager ?? ""], ["Items handed over", String(devices.length)], ["Date of handover", ""]],
    generated: input.generated,
  });
  const contentsPage = pdf.reserveContents();
  const contents: { title: string; page: number; sub?: boolean }[] = [];
  const start = (title: string, sub?: string, isSub?: boolean) => { const n = pdf.pageBreak(); pdf.title(title, sub); contents.push({ title, page: n, sub: isSub }); };

  // 1. How to use this document
  start("About this document");
  pdf.paragraph(`This document hands the systems over to ${client}.${on("equipment") ? " It lists the equipment." : ""}${on("function") ? " It describes what each system does." : ""}${on("tick") && cols.length ? ` Each item has a tick box to confirm it is ${doneText}.` : ""}${on("sign") ? ` Each ${by === "system" ? "system" : "area"} ends with an acceptance block for ${client} to sign and date.` : ""}`);
  pdf.heading("Scope of this handover");
  pdf.checks((Object.keys(SCOPES) as ScopeKey[]).map((k) => ({ label: SCOPES[k].label, ticked: scope.includes(k) })));
  if (on("tick") && cols.length) pdf.paragraph(`How to complete it: walk each area with the client and tick ${cols.map((k) => SCOPES[k].col).join(", ")} for each item once it is done and does what is described.${on("remarks") ? " Note anything outstanding in the Remarks line." : ""}${on("sign") ? " Then sign and date the acceptance block." : ""}`, { muted: true });
  const systems = [...new Set(devices.map((d) => d.system || "Other equipment"))].sort();
  pdf.heading("Systems in this handover");
  pdf.table([{ label: "System", width: 30 }, { label: "What it does", width: 85 }, { label: "Items", width: 8, align: "right" }],
    systems.map((sys) => [functionFor(sys, input.systems).name, functionFor(sys, input.systems).description.slice(0, 170), devices.filter((d) => (d.system || "Other equipment") === sys).length]));

  // 2. Complete equipment list
  if (on("equipment")) start("Equipment list", `${devices.length} items · grouped by system and type`);
  for (const sys of on("equipment") ? systems : []) {
    const inSys = devices.filter((d) => (d.system || "Other equipment") === sys);
    pdf.heading(functionFor(sys, input.systems).name, `${inSys.length} items`);
    const types = new Map<string, HandoverDevice[]>();
    for (const d of inSys) types.set(d.type || "Equipment", [...(types.get(d.type || "Equipment") ?? []), d]);
    const grouped = new Map<string, { n: number; model: string }>();
    for (const d of inSys) { const k = `${label(d)}|${d.model ?? ""}`; grouped.set(k, { n: (grouped.get(k)?.n ?? 0) + 1, model: d.model ?? "" }); }
    pdf.table([{ label: "Item", width: 50 }, { label: "Model", width: 36 }, { label: "Qty", width: 8, align: "right" }, { label: "Serial numbers", width: 70 }],
      [...grouped.entries()].map(([k, g]) => {
        const name = k.split("|")[0];
        const serials = inSys.filter((d) => label(d) === name && (d.model ?? "") === g.model).map((d) => d.serial).filter(Boolean).join(", ");
        return [name, g.model, String(g.n), serials];
      }));
  }

  // 3. Per system or per area: function, tick boxes, acceptance
  const groups: { key: string; title: string; sub: string; list: HandoverDevice[]; fn: Fn | null; area: boolean }[] = by === "system"
    ? systems.map((sys) => ({ key: sys, title: functionFor(sys, input.systems).name, sub: "", list: devices.filter((d) => (d.system || "Other equipment") === sys), fn: functionFor(sys, input.systems), area: false }))
    : [...new Set(devices.map(areaOf))].sort().map((a) => ({ key: a, title: a, sub: "", list: devices.filter((d) => areaOf(d) === a), fn: null, area: true }));
  contents.push({ title: by === "system" ? "System acceptance" : "Area acceptance", page: pdf.pageCount + 1 });
  for (const g of groups) {
    start(`${g.title}`, `${g.list.length} items`, true);
    if (g.fn && on("function")) {
      pdf.heading("What this system does");
      pdf.paragraph(g.fn.description);
    } else if (!g.fn) {
      const names = [...new Set(g.list.map((d) => functionFor(d.system || "Other equipment", input.systems).name))].join(", ");
      pdf.paragraph(`Systems in this area: ${names}.`, { muted: true });
    }
    if (on("tick") || on("equipment")) {
      const showTick = on("tick") && cols.length > 0;
      pdf.heading(showTick ? `Equipment: ${doneText}` : "Equipment");
      const order = [...g.list].sort((a, b) => (g.area ? (a.system ?? "").localeCompare(b.system ?? "") : areaOf(a).localeCompare(areaOf(b))) || label(a).localeCompare(label(b)));
      const boxW = showTick ? Math.max(9, Math.floor(46 / cols.length)) : 0;
      pdf.table([
        { label: g.area ? "System" : "Area", width: g.area ? 26 : 44 }, { label: "Item", width: 44 }, { label: "Model", width: 30 }, { label: "Serial number", width: 30 },
        ...(showTick ? cols.map((k) => ({ label: SCOPES[k].col, width: boxW, align: "center" as const })) : []),
      ], order.map((d) => [g.area ? functionFor(d.system || "Other equipment", input.systems).name : areaOf(d), label(d), d.model ?? "", d.serial ?? "",
        ...(showTick ? cols.map((k) => ({ box: pre && colStatus(k, d.status ?? "") })) : [])]));
    }
    if (g.fn && on("checks")) {
      pdf.heading("Functional checks");
      pdf.checks(g.fn.checks.map((label2) => ({ label: label2, ticked: pre && g.list.length > 0 && g.list.every((d) => workingStatus.has(d.status ?? "")) })));
    }
    if (on("remarks")) {
      pdf.heading("Remarks / outstanding items");
      pdf.paragraph("______________________________________________________________________________________________________________________________", { muted: true });
      pdf.paragraph("______________________________________________________________________________________________________________________________", { muted: true });
    }
    if (on("sign")) pdf.signoff({
      title: `Acceptance: ${g.title}`, client, company: input.company,
      statement: `We confirm the ${g.title} work listed above is ${doneText}, and we accept it.`,
    });
  }

  // 4. Final acceptance
  if (on("final")) {
    start("Final acceptance of the whole project");
    pdf.paragraph(`${client} accepts the systems listed in this document as ${doneText}${on("remarks") ? ", except for the outstanding items written in the Remarks lines" : ""}. Handover date and signatures below.`);
    pdf.signoff({ title: `Final acceptance: ${input.project}`, client, company: input.company, statement: "Handover of all systems completed. Operating instructions and documents received." });
  }

  pdf.fillContents(contentsPage, contents);
  return pdf.bytes();
}
