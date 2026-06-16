/**
 * Proof spec for Phase 2 slice 1 — Hub product surfaces.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md
 * Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 2)
 *
 * Verifies the three new routes + the feed-mounted readiness widget:
 *   /namespace        — read-only tree from kg_entities
 *   /proposals        — read-only proposals list from relationship_proposals
 *   /feed             — HealthScoreWidget rendered above the KPI row
 *
 * Mutation tests (drag-drop, confirm/reject) land with slice 2.
 *
 * Run locally against deployed hub:
 *   cd mira-hub
 *   npx playwright test tests/e2e/phase2-namespace-builder-proof.spec.ts
 *
 * Override target:
 *   HUB_URL=https://staging.app.factorylm.com/hub \
 *     npx playwright test tests/e2e/phase2-namespace-builder-proof.spec.ts
 *
 * Test user registration is shared with the other proof-* specs in this
 * directory; the auth/register endpoint is idempotent (409 on duplicate).
 */

import { test, expect } from "@playwright/test";

const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com/hub").replace(/\/$/, "");
const CREDS = {
  email: "playwright@factorylm.com",
  password: "TestPass123",
  name: "Playwright Phase2",
};

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: CREDS,
  });
  // 201 = created, 409 = already exists — both fine.
  expect([201, 409]).toContain(res.status());
});

test.beforeEach(async ({ page }) => {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').first().fill(CREDS.email);
  await page.locator('input[type="password"]').first().fill(CREDS.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(feed|hub)/i, { timeout: 15_000 });
});

test.describe("Phase 2 slice 1 — Hub product surfaces", () => {
  test("/namespace renders the page shell and tree container", async ({ page }) => {
    const res = await page.goto(`${HUB}/namespace`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);

    // Page heading
    await expect(page.getByRole("heading", { name: /namespace/i })).toBeVisible();

    // Page shell rendered (data-testid is the contract with future drag-drop)
    await expect(page.locator('[data-testid="namespace-page"]')).toBeVisible();

    // Either a tree or the empty state — both are valid for slice 1.
    const tree = page.locator('[data-testid="namespace-tree"]');
    const empty = page.locator('[data-testid="namespace-empty"]');
    await expect(tree.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test("/proposals renders shell, status tabs, and list-or-empty", async ({ page }) => {
    const res = await page.goto(`${HUB}/proposals`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible();

    // Status tabs (proposed / verified / rejected / all)
    const tabs = page.locator('[data-testid="proposals-tabs"]');
    await expect(tabs).toBeVisible();
    await expect(page.locator('[data-testid="proposals-tab-proposed"]')).toBeVisible();
    await expect(page.locator('[data-testid="proposals-tab-verified"]')).toBeVisible();

    // Either a list of cards or the empty state.
    const list = page.locator('[data-testid="proposals-list"]');
    const empty = page.locator('[data-testid="proposals-empty"]');
    await expect(list.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test("/feed mounts the readiness widget above the KPI row", async ({ page }) => {
    const res = await page.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);

    const widget = page.locator('[data-testid="health-score-widget"]');
    await expect(widget).toBeVisible({ timeout: 10_000 });

    // Wait for the loading state to resolve to either ready or error — both
    // are valid (a brand-new tenant with no readiness signals still renders).
    await expect(widget).toHaveAttribute("data-state", /(ready|error)/, { timeout: 10_000 });
  });

  test("API GET /api/readiness returns a level between 0-6", async ({ request }) => {
    const res = await request.get(`${HUB}/api/readiness`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("level");
    expect(typeof body.level).toBe("number");
    expect(body.level).toBeGreaterThanOrEqual(0);
    expect(body.level).toBeLessThanOrEqual(6);
    expect(body).toHaveProperty("nextStep");
    expect(typeof body.nextStep).toBe("string");
    expect(body.nextStep.length).toBeGreaterThan(5);
  });

  test("API POST /api/readiness/recalculate returns fresh level", async ({ request }) => {
    const res = await request.post(`${HUB}/api/readiness/recalculate`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.level).toBeGreaterThanOrEqual(0);
    expect(body.level).toBeLessThanOrEqual(6);
    expect(body).toHaveProperty("computedAt");
  });
});

// ── Mutation flows (slice 2) ───────────────────────────────────────────────

test.describe("Phase 2 slice 2 — mutations", () => {
  test("Verify and Reject buttons render on Pending tab", async ({ page }) => {
    await page.goto(`${HUB}/proposals`, { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="proposals-tab-proposed"]')).toBeVisible();

    const empty = page.locator('[data-testid="proposals-empty"]');
    const firstCard = page.locator('[data-testid="proposal-card"]').first();
    if (await empty.isVisible().catch(() => false)) {
      return;
    }
    await expect(firstCard).toBeVisible();
    await expect(firstCard.locator('[data-testid="proposal-verify"]')).toBeVisible();
    await expect(firstCard.locator('[data-testid="proposal-reject"]')).toBeVisible();
  });

  test("Verified tab hides the decide buttons", async ({ page }) => {
    await page.goto(`${HUB}/proposals`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="proposals-tab-verified"]').click();
    const firstCard = page.locator('[data-testid="proposal-card"]').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await expect(firstCard.locator('[data-testid="proposal-verify"]')).toHaveCount(0);
      await expect(firstCard.locator('[data-testid="proposal-reject"]')).toHaveCount(0);
    }
  });

  test("Namespace nodes are draggable", async ({ page }) => {
    await page.goto(`${HUB}/namespace`, { waitUntil: "networkidle" });
    const empty = page.locator('[data-testid="namespace-empty"]');
    if (await empty.isVisible().catch(() => false)) {
      return;
    }
    const firstNode = page.locator('[data-testid="namespace-node"]').first();
    await expect(firstNode).toHaveAttribute("draggable", "true");
    await expect(firstNode).toHaveAttribute("data-node-id", /[0-9a-f-]+/i);
  });
});
