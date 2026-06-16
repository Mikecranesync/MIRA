/**
 * Demo conveyor tablet page — Plan P8 (docs/plans/2026-05-14-demo-backend-plan.md).
 *
 * Two test surfaces:
 *
 *  1. **Live smoke** — hits `/demo/conveyor/CV-001` on the deployed app and
 *     verifies the route loads (either authed render or login bounce — both
 *     count as "route is wired"). Runs against `HUB_URL` like the other e2e
 *     specs in this directory.
 *
 *  2. **Mocked render + screenshots** — sets up `page.route()` interceptors
 *     for next-auth's session check and the four demo endpoints the page
 *     consumes, then renders the page against a local Next.js dev server
 *     (started by the caller with `bun run dev`). Captures iPad landscape
 *     (1024×768) and portrait (820×1180) screenshots into
 *     `docs/promo-screenshots/`. Gated behind `MIRA_DEMO_SCREENSHOTS=1` so
 *     the CI default ("smoke against prod") doesn't require a dev server.
 */

import { test, expect, type Route } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const LOCAL = process.env.LOCAL_HUB_URL ?? "http://localhost:3000";
const SHOULD_SHOOT = process.env.MIRA_DEMO_SCREENSHOTS === "1";

const DEMO_TAG = "CV-001";
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "promo-screenshots",
);

test.describe("demo conveyor — route smoke", () => {
  test("route resolves (authed render or login bounce)", async ({ page }) => {
    const res = await page.goto(`${HUB}/demo/conveyor/${DEMO_TAG}`, {
      waitUntil: "domcontentloaded",
    });
    // 200 = page rendered (either the loading spinner or the data view, or the
    // login bounce target). 302/301 = same idea. Anything else (4xx/5xx) is a
    // routing failure.
    expect(res?.status() ?? 500).toBeLessThan(400);
    // Either we landed on the demo page OR were bounced to /login.
    const url = page.url();
    expect(url).toMatch(/\/(demo\/conveyor\/CV-001|login)/);
  });
});

const mockCustomer = {
  tenant: { id: "00000000-0000-0000-0000-0000000000d1", name: "Demo Tenant" },
  sites: [
    {
      id: "site-1",
      name: "FactoryLM Lake Wales Demo",
      areas: [
        {
          id: "area-1",
          name: "Sorting",
          lines: [
            {
              id: "line-1",
              name: "Conveyor Line 1",
              equipment: [
                {
                  id: "asset-cv-001",
                  name: "Conveyor 001",
                  asset_tag: "CV-001",
                  manufacturer: "Allen-Bradley",
                  model: "Micro820 + GS10",
                  components: [
                    {
                      id: "cmp-pe-001",
                      name: "Photo Eye 001",
                      asset_tag: "PE-001",
                      component_kind: "sensor",
                      plc_tag: "PE_001_PRESENT",
                    },
                    {
                      id: "cmp-mtr-001",
                      name: "Motor 001",
                      asset_tag: "MTR-001",
                      component_kind: "motor",
                      plc_tag: "MTR_001_RUN",
                    },
                    {
                      id: "cmp-vfd-001",
                      name: "VFD GS10-2.2KW",
                      asset_tag: "VFD-001",
                      component_kind: "drive",
                      plc_tag: "VFD_001_SPEED_HZ",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const now = new Date().toISOString();
const mockSummary = {
  signals: [
    {
      plc_tag: "PE_001_PRESENT",
      component_id: "cmp-pe-001",
      component_name: "Photo Eye 001",
      asset_id: "asset-cv-001",
      asset_name: "Conveyor 001",
      last_value_text: null,
      last_value_numeric: null,
      last_value_bool: true,
      prev_value_text: null,
      prev_value_numeric: null,
      prev_value_bool: false,
      last_seen_at: now,
      last_changed_at: now,
      simulated: true,
      source: "simulator",
      properties: {},
    },
    {
      plc_tag: "MTR_001_RUN",
      component_id: "cmp-mtr-001",
      component_name: "Motor 001",
      asset_id: "asset-cv-001",
      asset_name: "Conveyor 001",
      last_value_text: null,
      last_value_numeric: null,
      last_value_bool: true,
      prev_value_text: null,
      prev_value_numeric: null,
      prev_value_bool: false,
      last_seen_at: now,
      last_changed_at: now,
      simulated: true,
      source: "simulator",
      properties: {},
    },
    {
      plc_tag: "VFD_001_SPEED_HZ",
      component_id: "cmp-vfd-001",
      component_name: "VFD GS10-2.2KW",
      asset_id: "asset-cv-001",
      asset_name: "Conveyor 001",
      last_value_text: null,
      last_value_numeric: 60,
      last_value_bool: null,
      prev_value_text: null,
      prev_value_numeric: 0,
      prev_value_bool: null,
      last_seen_at: now,
      last_changed_at: now,
      simulated: true,
      source: "simulator",
      properties: {},
    },
  ],
};

async function installMocks(page: import("@playwright/test").Page) {
  // next-auth client polls /api/auth/session — pretend the demo tablet is authed
  await page.route("**/api/auth/session*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { email: "demo-tablet@factorylm.com", name: "Demo Tablet" },
        expires: new Date(Date.now() + 3600_000).toISOString(),
      }),
    }),
  );
  await page.route("**/api/demo/customer", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockCustomer),
    }),
  );
  await page.route("**/api/demo/signals/summary", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSummary),
    }),
  );
  await page.route("**/api/sessions/confirm", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: { id: "demo-session-1" } }),
    }),
  );
  await page.route("**/api/mira/ask", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session_id: "demo-session-1",
        answer:
          "The photo eye is reading PRESENT and the motor is running at 60 Hz, so the box is detected and the conveyor is moving.",
        provider: "groq:llama-3.3-70b-versatile",
        duration_ms: 1234,
        citations: [
          {
            label: "PE-001 component template",
            source: "kb://components/photo-eye/banner-qs18",
          },
        ],
      }),
    }),
  );
}

test.describe("demo conveyor — mocked render", () => {
  test.skip(!SHOULD_SHOOT, "set MIRA_DEMO_SCREENSHOTS=1 to enable");

  test("iPad landscape (1024×768) — three panels visible", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installMocks(page);
    await page.goto(`${LOCAL}/demo/conveyor/${DEMO_TAG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Conveyor 001")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Live signals")).toBeVisible();
    await expect(page.getByText("Components")).toBeVisible();
    await expect(page.getByText("Ask MIRA")).toBeVisible();
    await expect(
      page.getByTestId("signal-value-PE_001_PRESENT"),
    ).toContainText("ON");

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(
        SCREENSHOT_DIR,
        "2026-05-15_demo-conveyor-001_ipad-landscape.png",
      ),
      fullPage: true,
    });
  });

  test("iPad portrait (820×1180) — stacked layout", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await installMocks(page);
    await page.goto(`${LOCAL}/demo/conveyor/${DEMO_TAG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Conveyor 001")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Live signals")).toBeVisible();

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(
        SCREENSHOT_DIR,
        "2026-05-15_demo-conveyor-001_ipad-portrait.png",
      ),
      fullPage: true,
    });
  });
});
