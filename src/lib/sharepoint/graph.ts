import "server-only";
import { siteLookupPath } from "@/lib/sharepoint/paths";

// Microsoft Graph, app-only (client credentials). The app registration should hold the
// "Sites.Selected" application permission and be granted write access to the chosen site only.

const GRAPH = "https://graph.microsoft.com/v1.0";
const SIMPLE_LIMIT = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10; // multiple of 320 KiB, as Graph requires

export class GraphError extends Error {
  constructor(message: string, public status: number, public code: string | null, public retryable: boolean) {
    super(message);
  }
}

export function graphConfigured() {
  return Boolean(process.env.MS_TENANT_ID?.trim() && process.env.MS_CLIENT_ID?.trim() && process.env.MS_CLIENT_SECRET?.trim());
}

let cached: { token: string; expires: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  if (!graphConfigured()) throw new GraphError("Microsoft 365 isn't connected yet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).", 0, "not_configured", false);
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MS_TENANT_ID!.trim())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!.trim(),
      client_secret: process.env.MS_CLIENT_SECRET!.trim(),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const why = body.error === "invalid_client" ? "The client secret is wrong or expired." : body.error === "unauthorized_client" || body.error === "invalid_request" ? "The tenant or client ID is wrong." : (body.error ?? `HTTP ${res.status}`);
    throw new GraphError(`Microsoft sign-in failed: ${why}`, res.status, body.error ?? null, res.status >= 500);
  }
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Authenticated Microsoft Graph request (app-only). Shared with the Outlook calendar code. */
export async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) },
  });
  return res;
}

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = body.error?.code ?? null;
  const hint =
    res.status === 403 ? " The app doesn't have write access to this site yet (Sites.Selected grant)." :
    res.status === 404 ? " Not found — check the site address and library name." :
    res.status === 401 ? " Microsoft rejected the app's sign-in." : "";
  throw new GraphError(`${what} failed (${res.status}${code ? ` ${code}` : ""}).${hint}`, res.status, code, res.status === 429 || res.status >= 500);
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Finds the site and its document library. */
export async function resolveDrive(siteUrl: string, library: string): Promise<{ siteId: string; driveId: string; siteName: string }> {
  const lookup = siteLookupPath(siteUrl);
  if (!lookup) throw new GraphError("That isn't a SharePoint site address (https://<company>.sharepoint.com/sites/<site>).", 400, "bad_site", false);
  const s = await graph(`/sites/${lookup}?$select=id,displayName`);
  if (!s.ok) await fail(s, "Finding the SharePoint site");
  const site = (await s.json()) as { id: string; displayName: string };
  const d = await graph(`/sites/${site.id}/drives?$select=id,name`);
  if (!d.ok) await fail(d, "Listing the site's document libraries");
  const drives = ((await d.json()) as { value: { id: string; name: string }[] }).value;
  const want = library.trim().toLowerCase();
  const drive = drives.find((x) => x.name.toLowerCase() === want) ?? (want === "documents" ? drives.find((x) => /^(documents|shared documents)$/i.test(x.name)) : undefined);
  if (!drive) throw new GraphError(`No document library called “${library}” on that site. Libraries found: ${drives.map((x) => x.name).join(", ") || "none"}.`, 404, "no_library", false);
  return { siteId: site.id, driveId: drive.id, siteName: site.displayName };
}

/** Creates each folder of a path if it doesn't exist yet. */
export async function ensureFolder(driveId: string, folderPath: string): Promise<void> {
  let parent = "";
  for (const name of folderPath.split("/").filter(Boolean)) {
    const here = parent ? `${parent}/${name}` : name;
    const check = await graph(`/drives/${driveId}/root:/${encodePath(here)}?$select=id,folder`);
    if (check.status === 404) {
      const url = parent ? `/drives/${driveId}/root:/${encodePath(parent)}:/children` : `/drives/${driveId}/root/children`;
      const res = await graph(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (!res.ok && res.status !== 409) await fail(res, `Creating folder “${here}”`);
    } else if (!check.ok) {
      await fail(check, `Checking folder “${here}”`);
    }
    parent = here;
  }
}

export type Uploaded = { path: string; webUrl: string; size: number };

/**
 * Uploads a new file. Never replaces an existing one: if the name is taken, "(v2)", "(v3)"…
 * is added. Missing folders are created.
 */
export async function uploadNew(driveId: string, path: string, content: Buffer, versionedName: (n: number) => string): Promise<Uploaded> {
  const slash = path.lastIndexOf("/");
  if (slash > 0) await ensureFolder(driveId, path.slice(0, slash));
  for (let n = 1; n <= 30; n++) {
    const target = versionedName(n);
    const res = content.length <= SIMPLE_LIMIT ? await putSmall(driveId, target, content) : await putLarge(driveId, target, content);
    if (res === "exists") continue;
    return { path: target, webUrl: res.webUrl, size: content.length };
  }
  throw new GraphError("Too many versions of this file already exist.", 409, "too_many_versions", false);
}

async function putSmall(driveId: string, path: string, content: Buffer): Promise<{ webUrl: string } | "exists"> {
  const res = await graph(`/drives/${driveId}/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=fail`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(content),
  });
  if (res.status === 409) return "exists";
  if (!res.ok) await fail(res, "Uploading the file");
  return { webUrl: ((await res.json()) as { webUrl: string }).webUrl };
}

async function putLarge(driveId: string, path: string, content: Buffer): Promise<{ webUrl: string } | "exists"> {
  const s = await graph(`/drives/${driveId}/root:/${encodePath(path)}:/createUploadSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
  });
  if (s.status === 409) return "exists";
  if (!s.ok) await fail(s, "Starting the upload");
  const { uploadUrl } = (await s.json()) as { uploadUrl: string };
  for (let start = 0; start < content.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, content.length);
    // The upload URL is pre-authorised; it must not carry the bearer token.
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-length": String(end - start), "content-range": `bytes ${start}-${end - 1}/${content.length}` },
      body: new Uint8Array(content.subarray(start, end)),
    });
    if (res.status === 409) return "exists";
    if (end === content.length) {
      if (!res.ok) await fail(res, "Finishing the upload");
      return { webUrl: ((await res.json()) as { webUrl: string }).webUrl };
    }
    if (res.status !== 202 && !res.ok) await fail(res, "Uploading part of the file");
  }
  throw new GraphError("Upload ended unexpectedly.", 500, null, true);
}
