import "server-only";
import { graph as graphOnce, GraphError } from "@/lib/sharepoint/graph";

// Calendar invites and emails sent from one shared mailbox. The app registration needs the
// Calendars.ReadWrite and Mail.Send application permissions, limited to that mailbox with an
// Exchange application access policy.

export type EventSpec = {
  subject: string;
  html: string;
  location?: string | null;
  attendees: string[];
  allDay: boolean;
  start: string; // local date-time "YYYY-MM-DDTHH:MM:SS" in timeZone
  end: string;
  timeZone: string;
  showAs?: "free" | "tentative" | "busy" | "oof";
  category?: string;
};

/**
 * Microsoft sometimes answers a burst of calls with a passing 429/500/502/503. Try again twice
 * (honouring Retry-After) before giving up, so a trip cancelled for several people goes through.
 */
async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  // A call Microsoft leaves hanging counts as a 504 after 25 s instead of stalling the whole queue.
  const once = () => graphOnce(path, { ...init, signal: AbortSignal.timeout(25_000) })
    .catch((e: unknown) => {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return new Response(JSON.stringify({ error: { code: "Timeout", message: "Microsoft didn't answer in time." } }), { status: 504 });
      throw e;
    });
  let res = await once();
  for (const wait of [1500, 4000]) {
    if (res.status !== 429 && res.status < 500) return res;
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : wait));
    res = await once();
  }
  return res;
}

/** A file to attach (Graph accepts up to 3 MB per file this way). */
export type Attachment = { name: string; contentType: string; bytes: Buffer };
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const fileAttachment = (a: Attachment) => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: a.name,
  contentType: a.contentType,
  contentBytes: a.bytes.toString("base64"),
});

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = body.error?.code ?? null;
  const hint =
    res.status === 403 || code === "ErrorAccessDenied" ? " Microsoft refused access: check the app has Calendars.ReadWrite and Mail.Send (granted) and that the access policy includes this mailbox." :
    res.status === 404 && code === "ErrorInvalidUser" ? " That mailbox doesn't exist in your Microsoft 365." :
    res.status === 401 ? " Microsoft rejected the app's sign-in." : "";
  throw new GraphError(`${what} failed (${res.status}${code ? ` ${code}` : ""}).${hint}${!hint && body.error?.message ? ` ${body.error.message}` : ""}`, res.status, code, res.status === 429 || res.status >= 500);
}

const mb = (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`;

function payload(e: EventSpec) {
  return {
    subject: e.subject,
    body: { contentType: "HTML", content: e.html },
    start: { dateTime: e.start, timeZone: e.timeZone },
    end: { dateTime: e.end, timeZone: e.timeZone },
    isAllDay: e.allDay,
    location: e.location ? { displayName: e.location } : undefined,
    attendees: e.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
    showAs: e.showAs ?? "busy",
    categories: e.category ? [e.category] : undefined,
    allowNewTimeProposals: false,
    isReminderOn: true,
  };
}

/**
 * Creates the event in the shared mailbox's calendar; Outlook emails the invitations. With
 * attachments, the event is created first without attendees, the files are added, and then the
 * attendees — so the invitation everyone receives already carries the files.
 */
export async function createEvent(mailbox: string, e: EventSpec, attachments: Attachment[] = []): Promise<string> {
  const body = payload(e);
  const first = attachments.length ? { ...body, attendees: [] } : body;
  const res = await graph(`${mb(mailbox)}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(first) });
  if (!res.ok) await fail(res, "Creating the calendar invite");
  const id = ((await res.json()) as { id: string }).id;
  if (attachments.length) {
    for (const a of attachments) {
      const r = await graph(`${mb(mailbox)}/events/${encodeURIComponent(id)}/attachments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fileAttachment(a)) });
      if (!r.ok) await fail(r, `Attaching ${a.name}`);
    }
    const p = await graph(`${mb(mailbox)}/events/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendees: body.attendees }) });
    if (!p.ok) await fail(p, "Sending the calendar invite");
  }
  return id;
}

/** Updates the event; Outlook sends the update to attendees. Returns false when it no longer exists. */
export async function updateEvent(mailbox: string, id: string, e: EventSpec): Promise<boolean> {
  const res = await graph(`${mb(mailbox)}/events/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(e)) });
  if (res.status === 404) return false;
  if (!res.ok) await fail(res, "Updating the calendar invite");
  return true;
}

/** Cancels the event (attendees get a cancellation); falls back to deleting it. */
export async function cancelEvent(mailbox: string, id: string, comment: string) {
  const res = await graph(`${mb(mailbox)}/events/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment }) });
  if (res.ok || res.status === 404) return;
  const del = await graph(`${mb(mailbox)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!del.ok && del.status !== 404) await fail(del, "Cancelling the calendar invite");
}

/** Raw bytes that fit in one sendMail request (Graph's limit is 4 MB after base64 encoding). */
export const MAIL_INLINE_LIMIT = Math.floor(2.8 * 1024 * 1024);

/**
 * Sends an email from the shared mailbox; recipients are blind-copied so addresses stay private.
 * Attachments travel inside the same request (only Mail.Send is needed). Files that together are
 * too big for one email are left out and `skipped` lists them — they stay downloadable in the app.
 */
export async function sendMail(mailbox: string, m: { subject: string; html: string; bcc: string[]; to?: string[]; cc?: string[]; attachments?: Attachment[] }): Promise<{ skipped: string[] }> {
  const inline: Attachment[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const a of m.attachments ?? []) {
    if (total + a.bytes.length <= MAIL_INLINE_LIMIT) {
      inline.push(a);
      total += a.bytes.length;
    } else skipped.push(a.name);
  }
  const message = {
    subject: m.subject,
    body: { contentType: "HTML", content: m.html },
    // Named recipients (travel requests) are addressed openly; broadcasts stay blind-copied.
    toRecipients: (m.to?.length ? m.to : [mailbox]).map((address) => ({ emailAddress: { address } })),
    ...(m.cc?.length ? { ccRecipients: m.cc.map((address) => ({ emailAddress: { address } })) } : {}),
    ...(m.bcc.length ? { bccRecipients: m.bcc.map((address) => ({ emailAddress: { address } })) } : {}),
    ...(inline.length ? { attachments: inline.map(fileAttachment) } : {}),
  };
  const res = await graph(`${mb(mailbox)}/sendMail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }) });
  if (!res.ok) await fail(res, "Sending the email");
  return { skipped };
}
