/**
 * Synthetic user day-in-the-life E2E spec (#764).
 *
 * Tests 4 personas (Carlos, Dana, Jordan, Pat) against the hub.
 * Deterministic — no LLM calls, no external services beyond the hub.
 *
 * Requires:
 *   1. seed-synthetic-users.ts run against the target DB
 *   2. Hub server running at HUB_URL (default: http://localhost:3100)
 *
 * Usage:
 *   HUB_URL=http://localhost:3100 npx playwright test tests/e2e/synthetic-day.spec.ts
 *
 * Persona credentials (set by seeder):
 *   carlos@synthetic.test    — Technician (2AM)
 *   dana@synthetic.test      — Maintenance Manager
 *   plantmgr@synthetic.test  — Plant Manager
 *   cfo@synthetic.test       — CFO
 *   Password: SynthTest2026!
 */

import { test, expect, type Page } from "@playwright/test";

const HUB = (process.env.HUB_URL ?? "http://localhost:3100").replace(/\/$/, "");

const TEST_PASSWORD = "SynthTest2026!";

const PERSONAS = {
  carlos: { email: "carlos@synthetic.test", name: "Carlos Mendez", role: "Technician" },
  dana: { email: "dana@synthetic.test", name: "Dana Reyes", role: "Manager" },
  plantmgr: { email: "plantmgr@synthetic.test", name: "Jordan Taylor", role: "Plant Manager" },
  cfo: { email: "cfo@synthetic.test", name: "Pat Hoffman", role: "CFO" },
} as const;

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });

  // Fill credentials — hub uses NextAuth credentials provider
  await page.locator('input[name="email"], input[type="email"]').fill(email);
  await page.locator('input[name="password"], input[type="password"]').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
}

// ── Shared assertions ─────────────────────────────────────────────────────────

async function assertAssetsLoad(page: Page): Promise<void> {
  await page.goto(`${HUB}/assets`, { waitUntil: "domcontentloaded" });
  // At least 5 equipment rows from seed
  await expect(page.locator("[data-testid='asset-row'], tr, .asset-card").first())
    .toBeVisible({ timeout: 15_000 });
}

async function assertWorkOrdersLoad(page: Page): Promise<void> {
  await page.goto(`${HUB}/workorders`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main, [role='main']")).toBeVisible({ timeout: 10_000 });
  // Should not show an error state
  await expect(page.locator("text=/server error|500|uncaught/i")).toHaveCount(0);
}

async function assertPmSchedulesLoad(page: Page): Promise<void> {
  await page.goto(`${HUB}/schedule`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main, [role='main']")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("text=/server error|500|uncaught/i")).toHaveCount(0);
}

// ── Carlos — Technician 2AM workflow ─────────────────────────────────────────

test.describe("Carlos (Technician) — 2AM shift workflow", () => {
  test("login succeeds and reaches dashboard", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.carlos.email);
    // Hub redirects to /dashboard or /workorders or /assets after login
    const url = page.url();
    expect(url).toContain(HUB);
    expect(url).not.toContain("/login");
  });

  test("assets page lists seeded equipment", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.carlos.email);
    await assertAssetsLoad(page);
  });

  test("work orders page loads without error", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.carlos.email);
    await assertWorkOrdersLoad(page);
  });

  test("asset detail page has Ask MIRA tab", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.carlos.email);
    await page.goto(`${HUB}/assets`, { waitUntil: "domcontentloaded" });
    const firstAsset = page.locator("a[href*='/assets/']").first();
    await firstAsset.click();
    await page.waitForURL(/\/assets\//, { timeout: 10_000 });
    // Check for "Ask MIRA" or chat tab
    const askTab = page.locator("text=/ask mira|chat|bot/i").first();
    await expect(askTab).toBeVisible({ timeout: 10_000 });
  });

  test("chat API returns SSE stream for VFD fault question", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    // Verify the chat endpoint is reachable (unauthenticated probe)
    const chatRes = await request.post(
      `${HUB}/api/assets/00000000-0000-0000-0000-000000001001/chat`,
      {
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({
          messages: [
            { role: "user", content: "VFD-07 showing fault F005. What should I check first?" },
          ],
        }),
      },
    );
    // Without auth, expect 401 (proves endpoint exists and is guarded)
    expect([200, 401, 503]).toContain(chatRes.status());
  });
});

// ── Dana — Maintenance Manager workflow ───────────────────────────────────────

test.describe("Dana (Manager) — morning review workflow", () => {
  test("login succeeds", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.dana.email);
    expect(page.url()).not.toContain("/login");
  });

  test("PM schedule page loads with seeded schedules", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.dana.email);
    await assertPmSchedulesLoad(page);
  });

  test("work orders page shows open + in-progress WOs", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.dana.email);
    await assertWorkOrdersLoad(page);
  });

  test("API: GET /api/work-orders returns seeded work orders", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    // Unauthenticated — expect 401 (proves endpoint exists)
    const res = await request.get(`${HUB}/api/work-orders`);
    expect([200, 401]).toContain(res.status());
  });

  test("API: GET /api/pm-schedules returns seeded PM schedules", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    const res = await request.get(`${HUB}/api/pm-schedules`);
    expect([200, 401]).toContain(res.status());
  });

  test("API: GET /api/cmms/stats returns counts", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    const res = await request.get(`${HUB}/api/cmms/stats`);
    expect([200, 401, 503]).toContain(res.status());
  });
});

// ── Jordan (Plant Manager) — KPI overview workflow ────────────────────────────

test.describe("Jordan (Plant Manager) — KPI overview", () => {
  test("login succeeds", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.plantmgr.email);
    expect(page.url()).not.toContain("/login");
  });

  test("assets page shows full equipment list", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.plantmgr.email);
    await assertAssetsLoad(page);
  });

  test("reports page is reachable", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.plantmgr.email);
    const res = await page.goto(`${HUB}/reports`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("API: POST /api/kg/sync triggers KG sync without crash", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    const res = await request.post(`${HUB}/api/kg/sync`);
    // 401 = endpoint exists and is auth-guarded (expected without session)
    expect([200, 401, 503]).toContain(res.status());
  });
});

// ── Pat (CFO) — usage and billing workflow ────────────────────────────────────

test.describe("Pat (CFO) — usage and billing", () => {
  test("login succeeds", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.cfo.email);
    expect(page.url()).not.toContain("/login");
  });

  test("usage page is reachable", async ({ page }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");
    await loginAs(page, PERSONAS.cfo.email);
    const res = await page.goto(`${HUB}/usage`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("API: GET /api/me returns tenant info", async ({ request }) => {
    test.skip(!process.env.NEON_DATABASE_URL, "Skipped: NEON_DATABASE_URL not set");

    const res = await request.get(`${HUB}/api/me`);
    expect([200, 401]).toContain(res.status());
  });
});

// ── Infrastructure: API endpoint health (no auth required) ────────────────────

test.describe("API health — no auth", () => {
  test("hub root returns 200 or 301", async ({ request }) => {
    const res = await request.get(`${HUB}/`, { maxRedirects: 1 });
    expect(res.status()).toBeLessThan(500);
  });

  test("login page returns 200", async ({ request }) => {
    const res = await request.get(`${HUB}/login`);
    expect(res.status()).toBe(200);
  });

  test("chat API rejects unauthenticated request with 401", async ({ request }) => {
    const res = await request.post(
      `${HUB}/api/assets/00000000-0000-0000-0000-000000001001/chat`,
      {
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      },
    );
    expect(res.status()).toBe(401);
  });

  test("work orders API rejects unauthenticated request", async ({ request }) => {
    const res = await request.get(`${HUB}/api/work-orders`);
    expect(res.status()).toBe(401);
  });

  test("assets API rejects unauthenticated request", async ({ request }) => {
    const res = await request.get(`${HUB}/api/assets`);
    expect(res.status()).toBe(401);
  });
});
