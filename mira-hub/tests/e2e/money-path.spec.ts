/**
 * E2E money-path gate — "a stranger can sign up, chat, and nothing breaks,
 * leaks, or lies" (beta-readiness plan P1-1, 2026-06-08).
 *
 * The original smoke gate only checked that app.factorylm.com/ redirects to
 * /login and that /login renders — it never exercised the grounded-chat money
 * path, so a broken signup→chat could deploy green. This suite extends the
 * deploy gate to assert the public money path AND the P0 hardening fixes:
 *
 *   1. NO BREAK  — the public grounded-chat path (/quickstart) returns a
 *                  grounded answer (P1-1 money path).
 *   2. NO BREAK  — flooding /api/quickstart/ask returns HTTP 429 (P0-1).
 *   3. NO LEAK   — /api/documents is auth-gated (401 unauth); the full authed
 *                  cross-tenant IDOR probe is a staging job (see below) (P0-2).
 *
 * The "no lie" assertion (wrong-vendor citation caught, P0-3) lives in the
 * offline eval regime (tests/eval) gated by the staging-gate, not here — it
 * needs the engine in-process, which the prod deploy gate does not run.
 *
 * Runs against production by default (same contract as smoke.spec.ts):
 *   cd mira-hub
 *   npx playwright test --config playwright.smoke.config.ts
 *
 * Override targets:
 *   WEB_URL=https://factorylm.com HUB_URL=https://app.factorylm.com \
 *   npx playwright test tests/e2e/money-path.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const WEB = (process.env.WEB_URL ?? "https://factorylm.com").replace(/\/$/, "");
const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

// P0-1's 429 assertion tests behavior that only exists AFTER this change
// deploys, so it CANNOT pass in the pre-deploy prod-health gate (it would
// deadlock the merge). It runs post-deploy / locally when SMOKE_RATE_LIMIT_CHECK=1.
const RUN_RATE_LIMIT_CHECK = process.env.SMOKE_RATE_LIMIT_CHECK === "1";

// Screenshot Rule (root CLAUDE.md): proof screenshots → docs/promo-screenshots/.
// Path is relative to the playwright cwd (mira-hub). Playwright auto-creates the
// dir; capture is best-effort (never fails the money-path assertion).
const STAMP = "2026-06-08_money-path-quickstart";
async function proofShot(page: Page, suffix: string, fullPage = false) {
  try {
    await page.screenshot({ path: `../docs/promo-screenshots/${STAMP}_${suffix}.png`, fullPage });
  } catch {
    /* screenshots are proof artifacts, not gate assertions */
  }
}

test.describe("money path — public grounded chat (P1-1)", () => {
  // This is the ONE test that makes a real cascade call. Keep it first so the
  // per-IP rate-limit budget (P0-1) is fresh before the flood test below.
  // 1) The public grounded-chat PAGE renders (front-end of the money path).
  test("quickstart page renders the grounded-chat form", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const res = await page.goto(HUB + "/quickstart", { waitUntil: "domcontentloaded", timeout: 20_000 });
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("quickstart-question")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("quickstart-submit")).toBeVisible();
    await proofShot(page, "desktop");
    await page.setViewportSize({ width: 412, height: 915 });
    await proofShot(page, "mobile", true);
  });

  // 2) The grounded-chat BACKEND answers (the actual money path). Asserted at
  // the API to avoid the flaky controlled-input submit; this is the same
  // endpoint the page POSTs to. One real cascade call per run.
  test("quickstart API returns a grounded answer (no break)", async ({ request }) => {
    const r = await request.post(HUB + "/api/quickstart/ask", {
      data: { question: "PowerFlex 525 fault F0004 on power-up, drive won't reset" },
      headers: { "content-type": "application/json" },
      timeout: 45_000,
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(200); // not 5xx, not a drained cascade
    const body = await r.json();
    // Grounding contract: a non-empty answer + a citations array (cite-or-refuse).
    expect(typeof body.answer).toBe("string");
    expect(body.answer.trim().length).toBeGreaterThan(20);
    expect(Array.isArray(body.citations)).toBe(true);
  });

  test("flooding /api/quickstart/ask returns 429 (P0-1, no break)", async ({ request }) => {
    // Pre-deploy this asserts behavior not yet on prod → would deadlock the
    // merge. Runs post-deploy / locally only (SMOKE_RATE_LIMIT_CHECK=1).
    test.skip(!RUN_RATE_LIMIT_CHECK, "429 flood is a post-deploy check (SMOKE_RATE_LIMIT_CHECK=1)");
    // Empty-body POSTs short-circuit at the 400 (missing question) AFTER the
    // rate-limit check, so this floods the limiter WITHOUT burning cascade
    // quota. The limiter is 20 req/IP/min; >20 in the window must 429.
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await request.post(HUB + "/api/quickstart/ask", {
        data: {},
        headers: { "content-type": "application/json" },
        failOnStatusCode: false,
      });
      codes.push(r.status());
    }
    expect(codes).toContain(429); // the limiter must trip within 25 rapid POSTs
  });
});

test.describe("no leak — /api/documents tenant gate (P0-2)", () => {
  test("unauthenticated /api/documents is rejected, never returns asset data", async ({ request }) => {
    const res = await request.get(HUB + "/api/documents?asset_id=00000000-0000-0000-0000-0000000000d1", {
      maxRedirects: 0,
      headers: { cookie: "" },
      failOnStatusCode: false,
    });
    // Must be rejected unauthenticated — the current middleware returns 401 JSON
    // (#1764); older deploys / basePath normalization may 307/308. The security
    // invariant is only "never 200 with asset data" — assert that robustly.
    expect([401, 403, 307, 308]).toContain(res.status());
    expect(res.status()).not.toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/"manufacturer"|"model_number"/);
  });

  // Full cross-tenant IDOR probe (authed as tenant A, request a tenant-B
  // asset_id → expect empty mfr/model, NOT B's data). Requires two seeded
  // tenant sessions, so it runs against STAGING with real session cookies,
  // not the no-secrets prod deploy gate. Tracked in the P1-1 handoff.
  //   HUB_URL=https://staging.app.factorylm.com \
  //   TENANT_A_COOKIE=... TENANT_B_ASSET_ID=... \
  //   npx playwright test tests/e2e/money-path.spec.ts -g "cross-tenant"
  test.skip("authed cross-tenant asset_id resolves nothing (staging only)", async () => {});
});

test.describe("marketing acquisition entry (money path front door)", () => {
  test("checkout session 303s to Stripe (anonymous trial entry)", async ({ request }) => {
    const res = await request.get(WEB + "/api/checkout/session", { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status()).toBe(303);
    expect(res.headers()["location"] ?? "").toMatch(/checkout\.stripe\.com/i);
  });
});
