import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

/**
 * Full Phase A journeys against a real local Supabase stack (`supabase start` +
 * `supabase db reset`, which loads supabase/seed.sql). Mail is read from the CLI's Mailpit.
 * Enable with E2E_SUPABASE=1. Skipped otherwise (the default CI smoke suite has no Auth server).
 */
test.skip(!process.env.E2E_SUPABASE, "Set E2E_SUPABASE=1 with a local Supabase stack running");
test.describe.configure({ mode: "serial" });

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const PASSWORD = "DemoPass-2026!";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(o\/|onboarding)/);
}

async function latestLinkFor(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
      const match = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML ?? "");
      if (match) return match[1].replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${email}`);
}

/** Small valid PNG (solid colour) so the avatar pipeline has a real image to decode. */
function png(size = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x55)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const newEmail = `crew-${Date.now()}@demo.test`;

test("admin invites an employee who sets a password and joins", async ({ page, browser }) => {
  await signIn(page, "alice@demo.test");
  await page.goto("/o/demo/admin/invitations");
  await page.getByLabel("Work email").fill(newEmail);
  await page.getByLabel("Name").fill("Marin Deckhand");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${newEmail}`)).toBeVisible();

  const link = await latestLinkFor(newEmail);
  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  await invitee.goto(link);
  await invitee.waitForURL(/\/auth\/set-password/);
  await invitee.getByLabel("New password").fill("Harbour-lights-2026");
  await invitee.getByLabel("Repeat password").fill("Harbour-lights-2026");
  await invitee.getByRole("button", { name: "Save password and continue" }).click();
  await invitee.waitForURL(/\/onboarding/);
  await invitee.getByRole("button", { name: "Join Acme Demo Co" }).click();
  await invitee.waitForURL(/\/o\/demo\?welcome=1/);
  await expect(invitee.getByText("Welcome to Acme Demo Co")).toBeVisible();
  await ctx.close();
});

test("employee uploads a selfie and colleagues see it", async ({ page, browser }) => {
  await signIn(page, "bob@demo.test");
  await page.goto("/o/demo/profile");
  await page.locator('input[type="file"][accept^="image/jpeg"]').setInputFiles({ name: "selfie.png", mimeType: "image/png", buffer: png(400) });
  await page.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText("Photo updated.")).toBeVisible();

  const ctx = await browser.newContext();
  const alice = await ctx.newPage();
  await signIn(alice, "alice@demo.test");
  await alice.goto("/o/demo/people?q=Bob");
  const img = alice.locator("li", { hasText: "Bob Tanaka" }).locator("img");
  await expect(img).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/avatars\//);
  const res = await alice.request.get((await img.getAttribute("src"))!);
  expect(res.headers()["content-type"]).toBe("image/webp");
  await ctx.close();
});

test("employees cannot open admin pages or other organizations", async ({ page }) => {
  await signIn(page, "bob@demo.test");
  await page.goto("/o/demo/admin/roles");
  await expect(page.getByText("You don’t have access to this page.")).toBeVisible();
  const res = await page.goto("/o/some-other-org");
  expect(res?.status()).toBe(404);
});

test("deactivation removes access immediately", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const bob = await ctx.newPage();
  await signIn(bob, "bob@demo.test");

  await signIn(page, "alice@demo.test");
  await page.goto("/o/demo/admin/members");
  await page.getByRole("link", { name: /Bob Tanaka/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove Bob’s access" }).click();
  await expect(page.getByText("Access removed.")).toBeVisible();

  await bob.goto("/o/demo/people");
  await expect(bob).toHaveURL(/\/login\?error=deactivated|\/onboarding|404/);

  // Restore for repeatable runs.
  await page.getByRole("button", { name: "Restore access" }).click();
  await expect(page.getByText("Access restored.")).toBeVisible();
  await ctx.close();
});
