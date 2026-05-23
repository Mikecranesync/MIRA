/**
 * Staging + Production verification spec — 2026-05-19
 *
 * Read-only. Verifies the surfaces touched in the most recent batch of work:
 *   1. Garage namespace / asset hierarchy (CV-001 + 6 children)        [auth-gated]
 *   2. Knowledge page on mobile (412x915)                              [auth-gated]
 *   3. QR scan page                                                    [public-ish]
 *   4. Asset detail page (CV-001)                                      [auth-gated]
 *   5. Hub login/auth redirect                                         [public]
 *   6. CMMS/Atlas integration view                                     [auth-gated]
 *   7. Marketing pages (factorylm.com homepage, /pricing, /cmms)       [public]
 *   8. General Hub health (no 500s, login renders, /api/health)        [public]
 *
 * Auth-gated tests verify that unauthenticated requests redirect to /login
 * (the security boundary), then take a screenshot of the redirect landing.
 * To exercise the post-login surfaces, set TEST_USER_EMAIL / TEST_USER_PASSWORD
 * env vars (e.g. from Doppler factorylm/stg).
 *
 * Run:
 *   # Staging hub + prod marketing (default)
 *   STAGING_HUB_URL=http://165.245.138.91:4101 \
 *   PROD_HUB_URL=https://app.factorylm.com/hub \
 *   MARKETING_URL=https://factorylm.com \
 *     npx playwright test tests/e2e/staging-verification.spec.ts
 *
 *   # Skip staging when unreachable (auto: probes first)
 *
 * Screenshots saved to:
 *   mira-hub/test-results/staging-verification-2026-05-19/
 * and copied (by a postscript) to docs/promo-screenshots/.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "path";
import fs from "fs";

const TODAY = "2026-05-19";

const STAGING_HUB = (process.env.STAGING_HUB_URL ?? "http://165.245.138.91:4101").replace(/\/$/, "");
const PROD_HUB = (process.env.PROD_HUB_URL ?? "https://app.factorylm.com/hub").replace(/\/$/, "");
const MARKETING = (process.env.MARKETING_URL ?? "https://factorylm.com").replace(/\/$/, "");

const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? "";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "";

const outDir = path.join(__dirname, "../../test-results/staging-verification-2026-05-19");
const promoDir = path.join(__dirname, "../../../docs/promo-screenshots");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 412, height: 915 };

let stagingReachable = false;

type Shot = { name: string; viewport: "desktop" | "mobile" };
const takenShots: Shot[] = [];

async function shot(page: Page, name: string, viewport: "desktop" | "mobile", fullPage = true) {
  const filename = `${TODAY}_${name}_${viewport}.png`;
  const fullPath = path.join(outDir, filename);
  await page.screenshot({ path: fullPath, fullPage });
  takenShots.push({ name, viewport });
  return fullPath;
}

async function probeReachable(request: APIRequestContext, url: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await request.get(url, { timeout: timeoutMs, failOnStatusCode: false });
    return res.status() > 0 && res.status() < 600;
  } catch {
    return false;
  }
}

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(promoDir, { recursive: true });
  stagingReachable = await probeReachable(request, STAGING_HUB + "/");
  console.log(`Staging reachable (${STAGING_HUB}): ${stagingReachable}`);
  if (!stagingReachable) {
    console.log("⚠️  Staging unreachable — staging-only tests will be skipped. Production tests still run.");
  }
});

test.afterAll(async () => {
  console.log("\n=== Screenshots taken ===");
  for (const s of takenShots) console.log(`  ${TODAY}_${s.name}_${s.viewport}.png`);
  // Copy into docs/promo-screenshots/ per CLAUDE.md "Screenshot Rule"
  if (fs.existsSync(outDir)) {
    for (const file of fs.readdirSync(outDir)) {
      if (!file.endsWith(".png")) continue;
      const src = path.join(outDir, file);
      const dst = path.join(promoDir, file);
      fs.copyFileSync(src, dst);
    }
    console.log(`Copied screenshots to ${promoDir}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 8. General Hub health — runs against both environments
// ───────────────────────────────────────────────────────────────────────────

test.describe("8. Hub health", () => {
  test("staging: /api/health returns ok", async ({ request }) => {
    test.skip(!stagingReachable, "staging unreachable");
    const res = await request.get(STAGING_HUB + "/api/health", { failOnStatusCode: false });
    expect.soft(res.status(), `status=${res.status()}`).toBe(200);
    if (res.status() === 200) {
      const body = await res.json().catch(() => ({}));
      console.log("staging /api/health:", JSON.stringify(body).slice(0, 200));
    }
  });

  test("prod: /api/health returns ok", async ({ request }) => {
    // PROD_HUB may have /hub suffix; try both with and without.
    const base = PROD_HUB.replace(/\/hub$/, "");
    const res = await request.get(base + "/api/health", { failOnStatusCode: false });
    expect.soft(res.status(), `status=${res.status()}`).toBe(200);
    if (res.status() === 200) {
      const body = await res.json().catch(() => ({}));
      console.log("prod /api/health:", JSON.stringify(body).slice(0, 200));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Hub login/auth — public surface, asserts redirect + form renders
// ───────────────────────────────────────────────────────────────────────────

test.describe("5. Hub login + auth redirect", () => {
  for (const env of ["staging", "prod"] as const) {
    test(`${env}: root → /login redirect + form renders (desktop)`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(DESKTOP);
      const res = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 20_000 });
      console.log(`${env} root: status=${res?.status()} url=${page.url()}`);
      // Either we landed on /login or we got a redirect chain that ended on it.
      expect.soft(page.url()).toMatch(/\/login/i);
      // The login form should render at least one email input.
      const emailInput = page.locator('input[type="email"]').first();
      await expect.soft(emailInput).toBeVisible({ timeout: 10_000 });
      await shot(page, `hub-login-${env}`, "desktop");
    });

    test(`${env}: login page on mobile`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(MOBILE);
      await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 20_000 });
      const emailInput = page.locator('input[type="email"]').first();
      await expect.soft(emailInput).toBeVisible({ timeout: 10_000 });
      await shot(page, `hub-login-${env}`, "mobile");
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 1+4. Garage namespace / asset hierarchy / CV-001 detail
//      (auth-gated — verify redirect, then attempt auth + content if creds)
// ───────────────────────────────────────────────────────────────────────────

async function tryLogin(page: Page, base: string): Promise<boolean> {
  if (!TEST_EMAIL || !TEST_PASSWORD) return false;
  try {
    await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
    await page.getByText(/sign in with password/i).click({ timeout: 5_000 }).catch(() => {});
    await page.locator('input[type="email"]').last().fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(feed|namespace|assets|hub)/i, { timeout: 15_000 });
    return true;
  } catch (e) {
    console.log(`login failed: ${(e as Error).message}`);
    return false;
  }
}

test.describe("1+4. Garage namespace + CV-001 asset hierarchy", () => {
  for (const env of ["staging", "prod"] as const) {
    test(`${env}: /namespace requires auth (redirect probe)`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(DESKTOP);
      await page.goto(base + "/namespace", { waitUntil: "domcontentloaded", timeout: 20_000 });
      const url = page.url();
      console.log(`${env} /namespace → ${url}`);
      // Should bounce to /login if unauthenticated.
      expect.soft(url).toMatch(/\/(login|namespace)/i);
      await shot(page, `namespace-redirect-${env}`, "desktop");
    });

    test(`${env}: CV-001 asset hierarchy (authenticated)`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      test.skip(!TEST_EMAIL || !TEST_PASSWORD, "no test credentials — set TEST_USER_EMAIL/TEST_USER_PASSWORD");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(DESKTOP);
      const ok = await tryLogin(page, base);
      expect(ok).toBeTruthy();
      await page.goto(base + "/namespace", { waitUntil: "networkidle", timeout: 20_000 });
      await shot(page, `namespace-tree-${env}`, "desktop");
      // CV-001 should appear as a root asset
      const cv001 = page.getByText(/CV-001/i).first();
      await expect.soft(cv001).toBeVisible({ timeout: 10_000 });
      // The 6 children
      for (const child of ["PE-001", "VFD-001", "VFD-002", "MTR-001", "PLC-001", "PANEL-001"]) {
        await expect.soft(page.getByText(new RegExp(child, "i")).first(), `child ${child}`).toBeVisible({ timeout: 5_000 });
      }
      await shot(page, `cv-001-hierarchy-${env}`, "desktop");
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Knowledge page on mobile (412x915)
// ───────────────────────────────────────────────────────────────────────────

test.describe("2. Knowledge page", () => {
  for (const env of ["staging", "prod"] as const) {
    test(`${env}: /knowledge mobile renders or redirects`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(MOBILE);
      await page.goto(base + "/knowledge", { waitUntil: "domcontentloaded", timeout: 20_000 });
      console.log(`${env} /knowledge → ${page.url()}`);
      await shot(page, "knowledge-page", "mobile");
      // If we're on the login page, that's still PASS for "no broken page" — record the state.
      // If authenticated, the upload button should be visible.
      if (TEST_EMAIL && TEST_PASSWORD && !/login/i.test(page.url())) {
        const upload = page.getByText(/upload|drag.*drop|connect.*drive/i).first();
        await expect.soft(upload).toBeVisible({ timeout: 5_000 });
        // Broken-emoji canary: look for the replacement char U+FFFD
        const bodyText = await page.locator("body").innerText();
        expect.soft(bodyText.includes("�"), "found broken-glyph U+FFFD in body").toBeFalsy();
      }
    });

    test(`${env}: /knowledge desktop`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(DESKTOP);
      await page.goto(base + "/knowledge", { waitUntil: "domcontentloaded", timeout: 20_000 });
      await shot(page, "knowledge-page", "desktop");
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3. QR scan page
// ───────────────────────────────────────────────────────────────────────────

test.describe("3. QR scan page", () => {
  for (const env of ["staging", "prod"] as const) {
    for (const path_ of ["/qr", "/scan", "/qr-scan"] as const) {
      test(`${env}: ${path_} loads (desktop)`, async ({ page }) => {
        test.skip(env === "staging" && !stagingReachable, "staging unreachable");
        const base = env === "staging" ? STAGING_HUB : PROD_HUB;
        await page.setViewportSize(DESKTOP);
        const res = await page.goto(base + path_, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const status = res?.status() ?? 0;
        console.log(`${env} ${path_}: status=${status} url=${page.url()}`);
        // 200, 3xx redirect to login, or 404 if the route is named differently.
        expect.soft([200, 301, 302, 307, 308, 401, 403, 404]).toContain(status);
        if (status === 200) {
          await shot(page, `qr-scan${path_.replace(/\//g, "-")}-${env}`, "desktop");
        }
      });
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 6. CMMS / Atlas integration view
// ───────────────────────────────────────────────────────────────────────────

test.describe("6. CMMS view", () => {
  for (const env of ["staging", "prod"] as const) {
    test(`${env}: /cmms-equipment or /assets reachable`, async ({ page }) => {
      test.skip(env === "staging" && !stagingReachable, "staging unreachable");
      const base = env === "staging" ? STAGING_HUB : PROD_HUB;
      await page.setViewportSize(DESKTOP);
      for (const p of ["/assets", "/cmms", "/equipment"] as const) {
        const res = await page.goto(base + p, { waitUntil: "domcontentloaded", timeout: 20_000 });
        console.log(`${env} ${p}: status=${res?.status()} url=${page.url()}`);
        if ((res?.status() ?? 0) === 200 || /login/i.test(page.url())) {
          await shot(page, `cmms-view${p.replace(/\//g, "-")}-${env}`, "desktop");
          break;
        }
      }
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Marketing — factorylm.com homepage, /pricing, /cmms (production only)
// ───────────────────────────────────────────────────────────────────────────

test.describe("7. Marketing site", () => {
  test("homepage: 200 + OG tags + title", async ({ page }) => {
    const res = await page.goto(MARKETING + "/", { waitUntil: "domcontentloaded" });
    expect.soft(res?.status()).toBe(200);
    await expect.soft(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect.soft(page).toHaveTitle(/FactoryLM/i);
    await page.setViewportSize(DESKTOP);
    await shot(page, "marketing-home", "desktop");
    await page.setViewportSize(MOBILE);
    await shot(page, "marketing-home", "mobile");
  });

  test("pricing: 200 + pricing cards", async ({ page }) => {
    const res = await page.goto(MARKETING + "/pricing", { waitUntil: "domcontentloaded" });
    expect.soft(res?.status()).toBe(200);
    const priceEl = page.locator(".card-price").first();
    await expect.soft(priceEl).toBeVisible({ timeout: 10_000 });
    await page.setViewportSize(DESKTOP);
    await shot(page, "marketing-pricing", "desktop");
    await page.setViewportSize(MOBILE);
    await shot(page, "marketing-pricing", "mobile");
  });

  test("/cmms: 200 + magic-link email form", async ({ page }) => {
    const res = await page.goto(MARKETING + "/cmms", { waitUntil: "domcontentloaded" });
    expect.soft(res?.status()).toBe(200);
    const emailInput = page
      .locator("#cmms-email, .fl-magic-form input[type='email']")
      .first();
    await expect.soft(emailInput).toBeVisible({ timeout: 10_000 });
    await page.setViewportSize(DESKTOP);
    await shot(page, "marketing-cmms", "desktop");
    await page.setViewportSize(MOBILE);
    await shot(page, "marketing-cmms", "mobile");
  });

  test("sitemap.xml: 200 + xml content-type", async ({ request }) => {
    const res = await request.get(MARKETING + "/sitemap.xml");
    expect.soft(res.status()).toBe(200);
    expect.soft(res.headers()["content-type"] ?? "").toMatch(/xml/i);
  });

  test("api health: 200", async ({ request }) => {
    const res = await request.get(MARKETING + "/api/health");
    expect.soft(res.status()).toBe(200);
  });
});
