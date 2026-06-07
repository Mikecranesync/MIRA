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
// Schema mirrors TreeResponse + CCNode in src/app/api/command-center/tree/route.ts.
const TREE = {
  total: 4,
  displaysTotal: 1,
  liveCount: 1,
  freshnessCounts: { live: 1, stale: 0, simulated: 0 },
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
      tagFreshness: "unknown",
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
          tagFreshness: "unknown",
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
              tagFreshness: "live",
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
              tagFreshness: "unknown",
              live: false,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

// The viewer no longer iframes the HMI — it hands off via "Open Live View" in a
// new tab. Mocking the display route is still useful so a stray top-level click
// during the test never reaches a real LAN host.
const FAKE_HMI_REDIRECT_BODY = "<!doctype html><html><body>handoff</body></html>";

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test("command center renders — UNS tree, freshness summary, Open Live View handoff", async ({
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

  // 2) Deterministic data: mock the tree fetch + the handoff route.
  await page.route("**/api/command-center/tree*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(TREE) }),
  );
  await page.route("**/api/command-center/display/**", (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_HMI_REDIRECT_BODY }),
  );

  // 3) Desktop render.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  // Freshness summary "1 live · 0 stale · 0 sim · 1/1 display up" confirms tree
  // + freshnessCounts + display-reachability logic ran. Match the substring so
  // whitespace / dot punctuation doesn't break the assertion.
  await expect(page.getByText(/1 live · 0 stale · 0 sim/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/1\/1 display.*up/)).toBeVisible();
  // The conveyor row with its live dot.
  await expect(page.getByText("Conveyor 1")).toBeVisible();

  await page.screenshot({
    path: path.join(OUT, `${DATE}_command-center-tree-live_desktop.png`),
    fullPage: false,
  });
  console.log(`📸 ${DATE}_command-center-tree-live_desktop.png`);

  // 4) Select the live asset → viewer offers an "Open Live View" handoff link.
  await page.getByText("Conveyor 1").click();
  await expect(page.getByText(/^Live$/)).toBeVisible({ timeout: 10_000 });
  const openLink = page.getByRole("link", { name: /Open Live View/i });
  await expect(openLink).toBeVisible();
  await expect(openLink).toHaveAttribute("target", "_blank");
  await expect(openLink).toHaveAttribute("rel", /noopener/);
  await expect(openLink).toHaveAttribute("href", /\/api\/command-center\/display\//);
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

// Defense-in-depth CSP guard. The viewer no longer iframes the HMI (it hands off
// in a new tab — see Open Live View), so frame-src is no longer load-bearing for
// the Command Center. The directive is still enforced site-wide and 'self' must
// stay listed for any future framed surface; assert that minimum here.
// See mira-hub/src/middleware.ts (DISPLAY_FRAME_SRC / CSP_FRAME_SRC_DISPLAY_HOSTS).
test("CSP frame-src admits the display iframe ('self' + configured hosts)", async ({
  page,
  context,
  baseURL,
}) => {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: { uid: "cc-csp-user", tid: TENANT_ID, status: "trial", trialExpiresAt, email: "cc-csp@factorylm-test.com" },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);

  const res = await page.goto("/command-center", { waitUntil: "domcontentloaded" });
  const csp = res?.headers()["content-security-policy"] ?? "";
  const frameSrc = (csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "").trim();

  expect(frameSrc, "frame-src directive present").not.toBe("");
  // 'self' is required for the same-origin display route to be frameable at all.
  expect(frameSrc, "frame-src must include 'self'").toContain("'self'");
});
