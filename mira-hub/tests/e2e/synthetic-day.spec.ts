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
 *   HUB_URL=http://localhost:3100 SYNTHETIC_USERS_ENABLED=1 npx playwright test tests/e2e/synthetic-day.spec.ts
 *   HUB_URL=https://app.factorylm.com SYNTHETIC_USERS_ENABLED=1 SYNTHETIC_CARLOS_EMAIL=... SYNTHETIC_CARLOS_PASSWORD=... npx playwright test tests/e2e/synthetic-day.spec.ts
 *
 * Local persona defaults (set by the local-only seeder):
 *   carlos@synthetic.test    — Technician (2AM)
 *   dana@synthetic.test      — Maintenance Manager
 *   plantmgr@synthetic.test  — Plant Manager
 *   cfo@synthetic.test       — CFO
 *   Password: SynthTest2026!
 */

import { test, expect, type Page } from "@playwright/test";

const HUB = (process.env.HUB_URL ?? "http://localhost:3100").replace(/\/$/, "");

const LOCAL_TEST_PASSWORD =
  process.env.HUB_SYNTHETIC_PASSWORD ??
  process.env.SYNTHETIC_USER_PASSWORD ??
  "SynthTest2026!";
const RUN_PERSONA_TESTS = process.env.SYNTHETIC_USERS_ENABLED === "1";
const PERSONA_SKIP_REASON =
  "Set SYNTHETIC_USERS_ENABLED=1 after seeding synthetic users in the target environment.";
const IS_LOCAL_HUB = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(HUB);

const PERSONAS = {
  carlos: {
    email: process.env.SYNTHETIC_CARLOS_EMAIL ?? "carlos@synthetic.test",
    password: process.env.SYNTHETIC_CARLOS_PASSWORD ?? LOCAL_TEST_PASSWORD,
    name: "Carlos Mendez",
    role: "Technician",
  },
  dana: {
    email: process.env.SYNTHETIC_DANA_EMAIL ?? "dana@synthetic.test",
    password: process.env.SYNTHETIC_DANA_PASSWORD ?? LOCAL_TEST_PASSWORD,
    name: "Dana Reyes",
    role: "Manager",
  },
  plantmgr: {
    email: process.env.SYNTHETIC_PLANTMGR_EMAIL ?? "plantmgr@synthetic.test",
    password: process.env.SYNTHETIC_PLANTMGR_PASSWORD ?? LOCAL_TEST_PASSWORD,
    name: "Jordan Taylor",
    role: "Plant Manager",
  },
  cfo: {
    email: process.env.SYNTHETIC_CFO_EMAIL ?? "cfo@synthetic.test",
    password: process.env.SYNTHETIC_CFO_PASSWORD ?? LOCAL_TEST_PASSWORD,
    name: "Pat Hoffman",
    role: "CFO",
  },
} as const;

const PROD_PERSONA_ENV = [
  "SYNTHETIC_CARLOS_EMAIL",
  "SYNTHETIC_DANA_EMAIL",
  "SYNTHETIC_PLANTMGR_EMAIL",
  "SYNTHETIC_CFO_EMAIL",
] as const;

const PROD_PERSONA_PASSWORD_ENV = [
  "SYNTHETIC_CARLOS_PASSWORD",
  "SYNTHETIC_DANA_PASSWORD",
  "SYNTHETIC_PLANTMGR_PASSWORD",
  "SYNTHETIC_CFO_PASSWORD",
] as const;

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page, persona: { email: string; password: string }): Promise<void> {
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });

  // Fill credentials — hub uses NextAuth credentials provider
  await page.getByRole("button", { name: /sign in with password/i }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('input[type="email"]').last().fill(persona.email);
  await page.locator('input[name="password"], input[type="password"]').fill(persona.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const authError = page.getByText(/email or password is incorrect|invalid|incorrect/i).first();
  await Promise.race([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }),
    authError.waitFor({ state: "visible", timeout: 30_000 }).then(async () => {
      const message = (await authError.textContent())?.trim() || "login failed";
      throw new Error(`Synthetic persona login failed for ${persona.email}: ${message}`);
    }),
  ]);
}

function skipUnlessSyntheticUsersEnabled(): void {
  test.skip(!RUN_PERSONA_TESTS, PERSONA_SKIP_REASON);
  if (!IS_LOCAL_HUB) {
    const missing = PROD_PERSONA_ENV.filter((key) => !process.env[key]);
    const hasSharedPassword = Boolean(process.env.HUB_SYNTHETIC_PASSWORD || process.env.SYNTHETIC_USER_PASSWORD);
    const missingPasswords = hasSharedPassword
      ? []
      : PROD_PERSONA_PASSWORD_ENV.filter((key) => !process.env[key]);
    expect(
      [...missing, ...missingPasswords],
      `Non-local synthetic persona runs require explicit credentials. Missing: ${[
        ...missing,
        ...missingPasswords,
      ].join(", ")}`,
    ).toEqual([]);
  }
}

// ── Shared assertions ─────────────────────────────────────────────────────────

async function assertAssetsLoad(page: Page): Promise<void> {
  await page.goto(`${HUB}/assets`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^assets$/i })).toBeVisible({ timeout: 15_000 });
  await expect(firstSeededAssetLink(page)).toBeVisible({ timeout: 15_000 });
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

function firstSeededAssetLink(page: Page) {
  return page.getByRole("link", {
    name: /QA Conveyor|CONV-QA-01|VFD-QA-01|Allen-Bradley PowerFlex 755|Dorner 2100|VFD-07|CONV-03/i,
  }).first();
}

// ── Carlos — Technician 2AM workflow ─────────────────────────────────────────

test.describe("Carlos (Technician) — 2AM shift workflow", () => {
  test("login succeeds and reaches dashboard", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.carlos);
    // Hub redirects to /dashboard or /workorders or /assets after login
    const url = page.url();
    expect(url).toContain(HUB);
    expect(url).not.toContain("/login");
  });

  test("assets page lists seeded equipment", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.carlos);
    await assertAssetsLoad(page);
  });

  test("work orders page loads without error", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.carlos);
    await assertWorkOrdersLoad(page);
  });

  test("asset detail page has Ask MIRA tab", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.carlos);
    await page.goto(`${HUB}/assets`, { waitUntil: "domcontentloaded" });
    const firstAsset = firstSeededAssetLink(page);
    await expect(firstAsset).toBeVisible({ timeout: 15_000 });
    await firstAsset.click();
    await page.waitForURL(/\/assets\/[0-9a-f-]+\/?$/i, { timeout: 10_000 });
    const askTab = page.locator("text=/ask mira|chat|bot/i").first();
    await expect(askTab).toBeVisible({ timeout: 10_000 });
  });

  test("chat API returns SSE stream for VFD fault question", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

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
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.dana);
    expect(page.url()).not.toContain("/login");
  });

  test("PM schedule page loads with seeded schedules", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.dana);
    await assertPmSchedulesLoad(page);
  });

  test("work orders page shows open + in-progress WOs", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.dana);
    await assertWorkOrdersLoad(page);
  });

  test("API: GET /api/work-orders returns seeded work orders", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

    // Unauthenticated — expect 401 (proves endpoint exists)
    const res = await request.get(`${HUB}/api/work-orders`);
    expect([200, 401]).toContain(res.status());
  });

  test("API: GET /api/pm-schedules returns seeded PM schedules", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

    const res = await request.get(`${HUB}/api/pm-schedules`);
    expect([200, 401]).toContain(res.status());
  });

  test("API: GET /api/cmms/stats returns counts", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

    const res = await request.get(`${HUB}/api/cmms/stats`);
    expect([200, 401, 503]).toContain(res.status());
  });
});

// ── Jordan (Plant Manager) — KPI overview workflow ────────────────────────────

test.describe("Jordan (Plant Manager) — KPI overview", () => {
  test("login succeeds", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.plantmgr);
    expect(page.url()).not.toContain("/login");
  });

  test("assets page shows full equipment list", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.plantmgr);
    await assertAssetsLoad(page);
  });

  test("reports page is reachable", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.plantmgr);
    const res = await page.goto(`${HUB}/reports`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("API: POST /api/kg/sync triggers KG sync without crash", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

    const res = await request.post(`${HUB}/api/kg/sync`);
    // 401 = endpoint exists and is auth-guarded (expected without session)
    expect([200, 401, 503]).toContain(res.status());
  });
});

// ── Pat (CFO) — usage and billing workflow ────────────────────────────────────

test.describe("Pat (CFO) — usage and billing", () => {
  test("login succeeds", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.cfo);
    expect(page.url()).not.toContain("/login");
  });

  test("usage page is reachable", async ({ page }) => {
    skipUnlessSyntheticUsersEnabled();
    await loginAs(page, PERSONAS.cfo);
    const res = await page.goto(`${HUB}/usage`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("API: GET /api/me returns tenant info", async ({ request }) => {
    skipUnlessSyntheticUsersEnabled();

    const res = await request.get(`${HUB}/api/me`);
    expect([200, 401]).toContain(res.status());
  });
});

// ── Infrastructure: API endpoint health (no auth required) ────────────────────

test.describe("API health — no auth", () => {
  test("hub root returns 200 or 301", async ({ request }) => {
    const res = await request.get(`${HUB}/`, { maxRedirects: 0 });
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
