import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { uploadNew, resolveDrive, GraphError } = await import("@/lib/sharepoint/graph");
const { versioned } = await import("@/lib/sharepoint/paths");

type Call = { url: string; init: RequestInit };
let calls: Call[];

function graphMock(handler: (url: string, init: RequestInit) => Response | undefined) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    return handler(url, init) ?? new Response("{}", { status: 500 });
  }));
}

beforeEach(() => {
  process.env.MS_TENANT_ID = "tenant";
  process.env.MS_CLIENT_ID = "client";
  process.env.MS_CLIENT_SECRET = "secret";
});
afterEach(() => vi.unstubAllGlobals());

describe("Microsoft Graph filing", () => {
  it("finds the site and its library", async () => {
    graphMock((url) => {
      if (url.includes("/sites/acme.sharepoint.com:/sites/Finance")) return new Response(JSON.stringify({ id: "site1", displayName: "Finance" }));
      if (url.includes("/sites/site1/drives")) return new Response(JSON.stringify({ value: [{ id: "d1", name: "Documents" }, { id: "d2", name: "Archive" }] }));
    });
    expect(await resolveDrive("https://acme.sharepoint.com/sites/Finance", "Documents")).toEqual({ siteId: "site1", driveId: "d1", siteName: "Finance" });
    await expect(resolveDrive("https://acme.sharepoint.com/sites/Finance", "Nope")).rejects.toThrow(/Libraries found: Documents, Archive/);
  });

  it("creates missing folders, never overwrites, and adds (v2) when the name is taken", async () => {
    const existing = new Set(["A", "A/B", "A/B/r.pdf"]);
    graphMock((url, init) => {
      const m = /root:\/(.+?)(:\/content.*|:\/children|\?\$select.*)?$/.exec(decodeURIComponent(url));
      if (url.includes("?$select=id,folder")) return existing.has(m![1]) ? new Response("{}") : new Response("{}", { status: 404 });
      if (url.endsWith("/root/children") || url.endsWith(":/children")) {
        const name = JSON.parse(String(init.body)).name as string;
        existing.add(m ? `${m[1]}/${name}` : name);
        return new Response("{}", { status: 201 });
      }
      if (url.includes(":/content")) {
        expect(url).toContain("conflictBehavior=fail");
        if (existing.has(m![1])) return new Response(JSON.stringify({ error: { code: "nameAlreadyExists" } }), { status: 409 });
        return new Response(JSON.stringify({ webUrl: `https://sp/${m![1]}` }), { status: 201 });
      }
    });
    const out = await uploadNew("d1", "A/B/r.pdf", Buffer.from("x"), (n) => versioned("A/B/r.pdf", n));
    expect(out.path).toBe("A/B/r (v2).pdf");
    const auth = (calls.find((c) => c.url.includes(":/content"))!.init.headers as Record<string, string>).authorization;
    expect(auth).toBe("Bearer tok");

    const fresh = await uploadNew("d1", "A/C/D/new.xlsx", Buffer.from("y"), (n) => versioned("A/C/D/new.xlsx", n));
    expect(fresh.path).toBe("A/C/D/new.xlsx");
    expect(existing.has("A/C")).toBe(true);
    expect(existing.has("A/C/D")).toBe(true);
  });

  it("uploads large files in 320 KiB-aligned chunks without sending the token to the upload URL", async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 1);
    const ranges: string[] = [];
    graphMock((url, init) => {
      if (url.includes("?$select=id,folder")) return new Response("{}");
      if (url.includes(":/createUploadSession")) return new Response(JSON.stringify({ uploadUrl: "https://upload.example/session" }));
      if (url === "https://upload.example/session") {
        const h = init.headers as Record<string, string>;
        expect(h.authorization).toBeUndefined();
        ranges.push(h["content-range"]);
        const end = Number(h["content-range"].split("-")[1].split("/")[0]);
        return end + 1 === big.length ? new Response(JSON.stringify({ webUrl: "https://sp/big" }), { status: 201 }) : new Response("{}", { status: 202 });
      }
    });
    const out = await uploadNew("d1", "F/big.zip", big, (n) => versioned("F/big.zip", n));
    expect(out.webUrl).toBe("https://sp/big");
    expect(ranges[0]).toBe(`bytes 0-3276799/${big.length}`);
    expect(ranges).toHaveLength(3);
  });

  it("explains missing site access and marks it as not retryable", async () => {
    graphMock(() => new Response(JSON.stringify({ error: { code: "accessDenied" } }), { status: 403 }));
    const err = await resolveDrive("https://acme.sharepoint.com/sites/Finance", "Documents").catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/write access/);
  });
});
