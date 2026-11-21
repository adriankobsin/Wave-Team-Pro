import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));
vi.mock("@/server/services/branding", () => ({ getProjectLogo: async () => null }));
vi.mock("@/server/services/project-pack", () => ({ buildProjectPack: vi.fn(async () => ({ bytes: Buffer.from("%PDF-pack"), name: "pack.pdf" })) }));

const RACK = "11111111-1111-4111-8111-111111111111", DRAW = "22222222-2222-4222-8222-222222222222", NEWER = "33333333-3333-4333-8333-333333333333";
const tables: Record<string, Record<string, unknown>[]> = {};
/** A stand-in for the Supabase query builder: filters on eq / in / ilike, ignores the rest. */
function from(table: string) {
  let rows = [...(tables[table] ?? [])];
  const q: Record<string, unknown> = {};
  const pass = () => q;
  Object.assign(q, {
    select: pass, is: pass, order: pass, limit: pass, or: pass, range: pass,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return q; },
    ilike: (k: string, v: string) => { const needle = v.replace(/%/g, "").toLowerCase(); rows = rows.filter((r) => String(r[k]).toLowerCase().includes(needle)); return q; },
    maybeSingle: async () => ({ data: rows[0] ?? null }),
    then: (ok: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(ok),
  });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

import { buildQrDoc } from "@/server/services/qr-doc";
import { buildProjectPack } from "@/server/services/project-pack";

const P = "p1", LIVE = "https://hub.example/o/x/projects/p1";
const pages = async (doc: Awaited<ReturnType<typeof buildQrDoc>>) => {
  expect(doc?.kind).toBe("pdf");
  if (doc?.kind !== "pdf") throw new Error("no pdf");
  return { n: (await PDFDocument.load(doc.bytes)).getPageCount(), name: doc.name };
};

describe("what a QR sticker opens", () => {
  beforeEach(() => {
    tables.projects = [{ id: P, name: "MY Seabreeze", organizations: { name: "Acme Systems SG" } }];
    tables.site_racks = [{ id: RACK, project_id: P, name: "552-R2 - NETWORK RACK", units: 42, location: "Comms room" }];
    tables.site_rack_items = [{ rack_id: RACK, u_bottom: 40, u_size: 1, kind: "patch_panel", label: "MEC552-R2-PP1" }, { rack_id: RACK, u_bottom: 38, u_size: 2, kind: "switch", label: "MEC 552 Core Sw1" }];
    tables.site_cables = Array.from({ length: 24 }, (_, i) => ({ project_id: P, patch_panel: "MEC552-R2-PP1", port: String(i + 1), label: i < 20 ? `C-${i + 1}` : null, cable_type: "CAT6A", system: "IT", deck: "LD", room: "Cabin", location: "", device_name: `AP ${i}`, switch_port: `Sw1/${i}`, test_result: i % 2 ? "passed" : "not_tested", length_m: 12.5, tested_on: "2026-11-01", tested_by: null, tested_by_ids: null, tested_by_name: "Jyri" }));
    tables.site_equipment = [{ project_id: P, sheet: "MEC 552 Core Sw1", title: "Core switch", model: "C9300", location: "552" }];
    tables.site_ports = Array.from({ length: 48 }, (_, i) => ({ project_id: P, equipment: "MEC 552 Core Sw1", port: `Gi1/0/${i + 1}`, position: i, vlan: "10", patch_port: `PP1-${i + 1}`, end_location: "Cabin", end_device: i < 30 ? `AP ${i}` : null, poe_w: 15, end_ip: "10.0.10.5" }));
    tables.lighting_loads = Array.from({ length: 60 }, (_, i) => ({ project_id: P, panel: "TANK DECK\\LCC 02A", area: "Tank deck", zone_number: i, zone_name: `Zone ${i}`, zone_href: `/zone/${i}`, load_number: 1, fixture: "DL1", quantity: 4, load_type: "DALI", module: `Module ${i % 3}`, output: String(i), wattage: 12, dali_address: "A1", status: "installed" }));
    tables.project_drawings = [{ id: NEWER, project_id: P, supersedes: DRAW }];
    tables.profiles = [];
  });

  it("a rack: contents, its patch panels, the switches in the room and the elevation", async () => {
    const r = await pages(await buildQrDoc(P, `/site/racks/${RACK}`, LIVE, "UTC"));
    expect(r.n).toBeGreaterThanOrEqual(3);
    expect(r.name).toBe("MY Seabreeze - Rack 552-R2.pdf");
    if (process.env.QR_OUT) { const d = await buildQrDoc(P, `/site/racks/${RACK}`, LIVE, "UTC"); if (d?.kind === "pdf") (await import("node:fs")).writeFileSync(process.env.QR_OUT, d.bytes); }
  });

  it("a patch panel, a switch and a lighting panel each get their own schedule", async () => {
    expect((await pages(await buildQrDoc(P, "/site/cables?panel=MEC552-R2-PP1&all=1", LIVE, "UTC"))).name).toBe("MY Seabreeze - Patch panel MEC552-R2-PP1.pdf");
    expect((await pages(await buildQrDoc(P, `/site/switches?eq=${encodeURIComponent("MEC 552 Core Sw1")}`, LIVE, "UTC"))).n).toBeGreaterThanOrEqual(2);
    expect((await pages(await buildQrDoc(P, `/site/lighting?panel=${encodeURIComponent("TANK DECK\\LCC 02A")}`, LIVE, "UTC"))).name).toBe("MY Seabreeze - Lighting panel LCC 02A.pdf");
  });

  it("a drawing sticker opens the newest revision", async () => {
    expect(await buildQrDoc(P, `/drawings/${DRAW}`, LIVE, "UTC")).toEqual({ kind: "drawing", id: NEWER });
  });

  it("the project sticker opens the schedules without money or drawings", async () => {
    const doc = await buildQrDoc(P, "", LIVE, "UTC");
    expect(doc?.kind).toBe("pdf");
    const sections = [...(vi.mocked(buildProjectPack).mock.calls.at(-1)![1] as Set<string>)];
    expect(sections).not.toContain("money");
    expect(sections).not.toContain("summary");
    expect(sections).not.toContain("drawings");
    expect(sections).toContain("cables");
  });

  it("an unknown or empty target opens nothing", async () => {
    expect(await buildQrDoc(P, "/site/cables?panel=NOPE", LIVE, "UTC")).toBeNull();
    expect(await buildQrDoc(P, "/passwords", LIVE, "UTC")).toBeNull();
  });
});
