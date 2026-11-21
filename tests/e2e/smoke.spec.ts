import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("anonymous access", () => {
  test("workspace routes redirect to sign-in and keep the destination", async ({ page }) => {
    await page.goto("/o/acme/people?q=ana");
    await expect(page).toHaveURL(/\/login\?next=%2Fo%2Facme%2Fpeople%3Fq%3Dana/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("root redirects to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("open redirects are neutralised", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/steal");
    await expect(page.locator('input[name="next"]')).toHaveValue("/");
    await page.goto("/login?next=//evil.example");
    await expect(page.locator('input[name="next"]')).toHaveValue("/");
  });

  test("invalid email links fail safely", async ({ page }) => {
    await page.goto("/auth/confirm?type=invite&token_hash=bogus&next=https://evil.example");
    await expect(page).toHaveURL(/\/login\?error=link/);
    await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
  });
});

test.describe("sign-in page", () => {
  test("is labelled, keyboard reachable and has no serious accessibility violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  });

  test("forgot-password page is reachable and accessible", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("fits the viewport without horizontal scrolling", async ({ page }) => {
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("follows the system dark preference", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await ctx.close();
  });
});

test.describe("platform hardening", () => {
  test("sends security headers", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("sign-out via GET without reason does not sign anyone out", async ({ request }) => {
    const res = await request.get("/auth/signout", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).not.toContain("/login");
  });

  test("serves the PWA manifest and offline page", async ({ request, page }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.short_name).toBe("Group Hub");
    expect(manifest.display).toBe("standalone");
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  });
});
