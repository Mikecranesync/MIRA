import { test, expect } from "@playwright/test";
import { AUDIT_USER, ensureUserRegistered, loginWithPassword } from "./fixtures/auth";

// Override HUB_URL via env to point at staging:
//   HUB_URL=http://165.245.138.91:4101 bunx playwright test tests/e2e/audit-post-023-grants.spec.ts
const HUB_URL = process.env.HUB_URL ?? "https://app.factorylm.com";

// Post-merge verification for PR #1378 / migration 023.
// Expects the 3 routes flagged as 500 in the 2026-05-17 auth-pass audit
// (#1370 comment) to return 200 now that factorylm_app has SELECT/INSERT/
// UPDATE on the namespace + proposals + component tables.

const ENDPOINTS = [
  "/api/knowledge",          // known-good per #1370 (renders fully)
  "/api/library/tree",       // known-good per migration 011
  "/api/namespace/tree",     // was 500
  "/api/proposals",          // was 500
  "/api/readiness",          // was 500
];

test.describe("post-023-grants — API 500 fix verification", () => {
  test("auth + probe 3 previously-500 endpoints", async ({ page, request }) => {
    test.setTimeout(90_000);

    await ensureUserRegistered(request);
    await loginWithPassword(page);

    for (const path of ENDPOINTS) {
      const res = await page.request.get(`${HUB_URL}${path}`, { failOnStatusCode: false });
      const status = res.status();
      const bodyPreview = (await res.text()).slice(0, 300);
      console.log(`[probe] ${path} -> ${status} :: ${bodyPreview}`);
      expect.soft(status, `${path} should not 500 (was 500 in 02:47Z audit) — body: ${bodyPreview}`).not.toBe(500);
      expect.soft(status, `${path} should return 200`).toBe(200);
    }
  });
});

void AUDIT_USER;
