import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  process.env.MS_TENANT_ID = "tenant";
  process.env.MS_CLIENT_ID = "client";
  process.env.MS_CLIENT_SECRET = "secret";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? "GET", body });
    if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (url.includes("other%40")) return new Response(JSON.stringify({ error: { code: "ErrorAccessDenied" } }), { status: 403 });
    if (url.endsWith("/events") && init.method === "POST") return new Response(JSON.stringify({ id: "evt-1" }), { status: 201 });
    if (url.endsWith("/attachments") && init.method === "POST") return new Response(JSON.stringify({ id: "att" }), { status: 201 });
    if (url.endsWith("/messages") && init.method === "POST") return new Response(JSON.stringify({ id: "msg-1" }), { status: 201 });
    if (url.endsWith("/messages/msg-1/send")) return new Response(null, { status: 202 });
    if (url.includes("/events/gone")) return new Response(JSON.stringify({ error: { code: "ErrorItemNotFound" } }), { status: 404 });
    if (url.includes("/cancel")) return new Response(null, { status: 202 });
    if (url.endsWith("/sendMail")) return new Response(null, { status: 202 });
    if (init.method === "PATCH") return new Response(JSON.stringify({ id: "evt-1" }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "ErrorAccessDenied" } }), { status: 403 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Outlook calendar calls", () => {
  const spec = { subject: "Task due: Sauna lights", html: "<p>x</p>", attendees: ["sam@example.com"], allDay: true, start: "2026-11-20T00:00:00", end: "2026-11-21T00:00:00", timeZone: "Europe/London" };

  it("creates the event in the shared mailbox with the attendees, so Outlook sends the invite", async () => {
    const { createEvent } = await import("@/lib/outlook/graph");
    expect(await createEvent("hub@example.com", spec)).toBe("evt-1");
    const post = calls.find((c) => c.url.endsWith("/users/hub%40example.com/events"))!;
    expect(post.method).toBe("POST");
    expect(post.body).toMatchObject({ subject: "Task due: Sauna lights", isAllDay: true, attendees: [{ emailAddress: { address: "sam@example.com" }, type: "required" }], start: { dateTime: "2026-11-20T00:00:00", timeZone: "Europe/London" } });
  });

  it("reports a deleted event so it can be created again, and cancels with a message", async () => {
    const { updateEvent, cancelEvent } = await import("@/lib/outlook/graph");
    expect(await updateEvent("hub@example.com", "gone", spec)).toBe(false);
    await cancelEvent("hub@example.com", "evt-1", "Cancelled");
    expect(calls.some((c) => c.url.endsWith("/events/evt-1/cancel") && (c.body as { comment: string }).comment === "Cancelled")).toBe(true);
  });

  it("emails updates with everyone blind-copied", async () => {
    const { sendMail } = await import("@/lib/outlook/graph");
    await sendMail("hub@example.com", { subject: "Company update", html: "<p>Hi</p>", bcc: ["a@x.com", "b@x.com"] });
    const m = calls.find((c) => c.url.endsWith("/sendMail"))!.body as { message: { bccRecipients: unknown[]; toRecipients: unknown[] } };
    expect(m.message.bccRecipients).toHaveLength(2);
    expect(m.message.toRecipients).toEqual([{ emailAddress: { address: "hub@example.com" } }]);
  });

  it("adds attachments before inviting, so the invitation carries them", async () => {
    const { createEvent } = await import("@/lib/outlook/graph");
    await createEvent("hub@example.com", spec, [{ name: "ticket.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.4") }]);
    const order = calls.filter((c) => !c.url.includes("login.")).map((c) => `${c.method} ${c.url.split("/hub%40example.com")[1]}`);
    expect(order).toEqual(["POST /events", "POST /events/evt-1/attachments", "PATCH /events/evt-1"]);
    expect((calls.find((c) => c.url.endsWith("/events") && c.method === "POST")!.body as { attendees: unknown[] }).attendees).toEqual([]);
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ attendees: [{ emailAddress: { address: "sam@example.com" }, type: "required" }] });
    expect(calls.find((c) => c.url.endsWith("/attachments"))!.body).toMatchObject({ name: "ticket.pdf", contentBytes: Buffer.from("%PDF-1.4").toString("base64") });
  });

  it("sends an update with its attachments in one request (Mail.Send only), leaving out what doesn't fit", async () => {
    const { sendMail } = await import("@/lib/outlook/graph");
    const r = await sendMail("hub@example.com", { subject: "Travel", html: "<p>x</p>", bcc: ["a@x.com"], attachments: [
      { name: "itinerary.pdf", contentType: "application/pdf", bytes: Buffer.from("x") },
      { name: "huge.pdf", contentType: "application/pdf", bytes: Buffer.alloc(3 * 1024 * 1024) },
    ] });
    const order = calls.filter((c) => !c.url.includes("login.")).map((c) => `${c.method} ${c.url.split("/hub%40example.com")[1]}`);
    expect(order).toEqual(["POST /sendMail"]);
    const msg = (calls.find((c) => c.url.endsWith("/sendMail"))!.body as { message: { attachments: { name: string }[] } }).message;
    expect(msg.attachments.map((a) => a.name)).toEqual(["itinerary.pdf"]);
    expect(r.skipped).toEqual(["huge.pdf"]);
  });

  it("explains a permissions problem", async () => {
    const { createEvent } = await import("@/lib/outlook/graph");
    await expect(createEvent("other@example.com", spec)).rejects.toThrow(/Calendars.ReadWrite and Mail.Send/);
  });
});
