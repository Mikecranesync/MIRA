/**
 * Command Center (Phase 1) render proof.
 *
 * Auth: mint a next-auth JWE session cookie (Hub local-e2e recipe) signed with the
 * SAME AUTH_SECRET the server boots with (see playwright.command-center.config.ts)
 * so the (hub) middleware lets us in — no real login.
 *
 * Data: the tree + display endpoints are mocked via page.route() so the screenshot
 * is deterministic (green dot guaranteed) and doesn't depend on dev-DB seed state
 * or Node-RED being reachable. The real tree route + reachability probe were proven
 * separately at the data layer; this spec proves the UI renders.
 *
 * Captures desktop (1440×900) + mobile (412×915) into docs/promo-screenshots/.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.command-center.config.ts
 */
import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as path from "path";
import * as fs from "fs";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "00000000-0000-0000-0000-0000000000cc"; // valid UUID; gate doesn't hit DB
const OUT = path.resolve(__dirname, "..", "..", "..", "docs", "promo-screenshots");
const DATE = "2026-05-29";

const DISPLAY_ID = "11111111-1111-1111-1111-111111111111";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";

// Deterministic tree: a site → area → two assets, one with a LIVE display.
const TREE = {
  total: 4,
  displaysTotal: 1,
  liveCount: 1,
  nodes: [
    {
      id: "site-1",
      name: "Lake Wales Plant",
      kind: "site",
      unsPath: "enterprise.home_garage",
      filesCount: 0,
      status: null,
      counts: { children: 1, proposalsPending: 0, proposalsVerified: 0 },
      hasLiveDisplay: false,
      displayId: null,
      displayType: null,
      displayLabel: null,
      live: false,
      children: [
        {
          id: "area-1",
          name: "Conveyor Lab",
          kind: "namespace",
          unsPath: "enterprise.home_garage.conveyor_lab",
          filesCount: 0,
          status: null,
          counts: { children: 2, proposalsPending: 0, proposalsVerified: 0 },
          hasLiveDisplay: false,
          displayId: null,
          displayType: null,
          displayLabel: null,
          live: false,
          children: [
            {
              id: "asset-conv-1",
              name: "Conveyor 1",
              kind: "equipment",
              unsPath: UNS,
              filesCount: 3,
              status: "running",
              counts: { children: 0, proposalsPending: 0, proposalsVerified: 2 },
              hasLiveDisplay: true,
              displayId: DISPLAY_ID,
              displayType: "nodered",
              displayLabel: "Conveyor 1 — Fault Detective",
              live: true,
              children: [],
            },
            {
              id: "asset-pump-1",
              name: "Coolant Pump 1",
              kind: "equipment",
              unsPath: "enterprise.home_garage.conveyor_lab.coolant_pump_1",
              filesCount: 1,
              status: "stopped",
              counts: { children: 0, proposalsPending: 1, proposalsVerified: 0 },
              hasLiveDisplay: false,
              displayId: null,
              displayType: null,
              displayLabel: null,
              live: false,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

// A small stand-in for the framed HMI so the viewer iframe shows a live screen
// instead of a failed cross-origin load.
const FAKE_HMI = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0b1220;color:#e2e8f0;height:100vh;display:flex;flex-direction:column}
  .bar{padding:10px 16px;background:#111c33;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:10px;font-size:13px}
  .dot{width:9px;height:9px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px #16a34a33}
  .grid{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
  .card{background:#111c33;border:1px solid #1e293b;border-radius:10px;padding:18px}
  .k{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
  .v{font-size:28px;font-weight:700;margin-top:6px}
  .ok{color:#22c55e}.warn{color:#f59e0b}
</style></head><body>
  <div class="bar"><span class="dot"></span> Fault Detective — Conveyor 1 · Node-RED · live</div>
  <div class="grid">
    <div class="card"><div class="k">Motor Speed</div><div class="v ok">1,180 rpm</div></div>
    <div class="card"><div class="k">Current</div><div class="v">4.2 A</div></div>
    <div class="card"><div class="k">Temp</div><div class="v ok">38 °C</div></div>
    <div class="card"><div class="k">State</div><div class="v ok">RUNNING</div></div>
    <div class="card"><div class="k">Photo Eye</div><div class="v">CLEAR</div></div>
    <div class="card"><div class="k">Faults (24h)</div><div class="v warn">1</div></div>
  </div>
</body></html>`;

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test("command center renders — UNS tree, green live dot, framed display", async ({
  page,
  context,
  baseURL,
}) => {
  // 1) Mint the session cookie so (hub) middleware admits us.
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: {
      uid: "cc-e2e-user",
      tid: TENANT_ID,
      status: "trial",
      trialExpiresAt,
      email: "command-center-e2e@factorylm-test.com",
    },
    secret: AUTH_SECRET,
  });
  await context.addCookies([
    { name: "next-auth.session-token", value: token, url: baseURL! },
  ]);

  // 2) Deterministic data: mock the tree fetch + the framed display.
  await page.route("**/api/command-center/tree*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(TREE) }),
  );
  await page.route("**/api/command-center/display/**", (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_HMI }),
  );

  // 3) Desktop render.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  // Live badge ("1 live · 1 display") confirms the tree + dot logic ran.
  await expect(page.getByText(/1 live · 1 display/)).toBeVisible({ timeout: 15_000 });
  // The conveyor row with its live dot.
  await expect(page.getByText("Conveyor 1")).toBeVisible();

  await page.screenshot({
    path: path.join(OUT, `${DATE}_command-center-tree-live_desktop.png`),
    fullPage: false,
  });
  console.log(`📸 ${DATE}_command-center-tree-live_desktop.png`);

  // 4) Select the live asset → viewer frames the (mocked) live HMI.
  await page.getByText("Conveyor 1").click();
  await expect(page.getByText(/^Live$/)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600); // let the iframe paint
  await page.screenshot({
    path: path.join(OUT, `${DATE}_command-center-watching-display_desktop.png`),
    fullPage: false,
  });
  console.log(`📸 ${DATE}_command-center-watching-display_desktop.png`);

  // 5) Mobile render.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, `${DATE}_command-center-tree-live_mobile.png`),
    fullPage: false,
  });
  console.log(`📸 ${DATE}_command-center-tree-live_mobile.png`);
});
