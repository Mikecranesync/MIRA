/**
 * Command Center render proof — displays-first view, onboarding empty state,
 * refresh-persists, and down-not-missing.
 *
 * Auth: mint a next-auth JWE session cookie (Hub local-e2e recipe) signed with the
 * SAME AUTH_SECRET the server boots with (see playwright.command-center.config.ts)
 * so the (hub) middleware lets us in — no real login.
 *
 * Data: the tree is mocked via page.route() so renders are deterministic and don't
 * depend on dev-DB seed state or any HMI being reachable. DB-level PERSISTENCE of a
 * registered display is proven separately + non-circularly by
 * scripts/verify-display-register-roundtrip.sh (ephemeral Postgres round-trip);
 * mocking the tree here would only prove the UI re-renders what it's handed, so this
 * spec scopes itself to UI-state rendering.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.command-center.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as path from "path";
import * as fs from "fs";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "00000000-0000-0000-0000-0000000000cc"; // valid UUID; gate doesn't hit DB
const OUT = path.resolve(__dirname, "..", "..", "..", "docs", "promo-screenshots");
const DATE = "2026-06-16";

const DISPLAY_ID = "11111111-1111-1111-1111-111111111111";
const CONV_UNS = "enterprise.bench.area.conv_simple";

// A leaf display node (conv_simple) used inside the trees below.
function convNode(live: boolean) {
  return {
    id: "asset-conv-1",
    name: "Conveyor",
    kind: "equipment",
    unsPath: CONV_UNS,
    filesCount: 0,
    status: "running",
    counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 },
    hasLiveDisplay: true,
    displayId: DISPLAY_ID,
    displayType: "web_iframe",
    displayLabel: "Conv Simple — Live",
    tagFreshness: live ? "live" : "stale",
    live,
    children: [],
  };
}

// An audit/test node like the ones the secret-shopper QA saw dumped.
const AUDIT_NODE = {
  id: "audit-1",
  name: "Audit 0o494d 0O494D",
  kind: "area",
  unsPath: "audit_0o494d_0o494d",
  filesCount: 0,
  status: null,
  counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 },
  hasLiveDisplay: false,
  displayId: null,
  displayType: null,
  displayLabel: null,
  tagFreshness: "unknown",
  live: false,
  children: [] as unknown[],
};

// Tree WITH a configured conv_simple display (+ an audit node to prove demotion).
function treeWithDisplay(live = true) {
  return {
    total: 2,
    displaysTotal: 1,
    liveCount: live ? 1 : 0,
    freshnessCounts: { live: live ? 1 : 0, stale: live ? 0 : 1, simulated: 0 },
    nodes: [AUDIT_NODE, convNode(live)],
  };
}

// Tree with NO displays + NO telemetry — the empty/onboarding case (118 audit nodes).
const TREE_EMPTY = {
  total: 1,
  displaysTotal: 0,
  liveCount: 0,
  freshnessCounts: { live: 0, stale: 0, simulated: 0 },
  nodes: [AUDIT_NODE],
};

const FAKE_HMI_REDIRECT_BODY = "<!doctype html><html><body>handoff</body></html>";

const FAKE_GATEWAYS = {
  gateways: [
    {
      hostname: "plc-laptop.local:8088",
      agentId: "agent-abc123",
      activatedAt: "2026-06-01T00:00:00Z",
      online: true,
    },
  ],
};

async function auth(context: BrowserContext, baseURL: string, uid: string) {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: { uid, tid: TENANT_ID, status: "trial", trialExpiresAt, email: `${uid}@factorylm-test.com` },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
}

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test("displays-first: Live Views leads, audit nodes are demoted, Open Live View hands off", async ({
  page, context, baseURL,
}) => {
  await auth(context, baseURL!, "cc-e2e-user");
  await page.route(/\/api\/command-center\/tree/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(treeWithDisplay(true)) }),
  );
  await page.route(/\/api\/command-center\/display\//, (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_HMI_REDIRECT_BODY }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  // Live Views section leads with the configured display.
  await expect(page.getByText(/Live Views \(1\)/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Conv Simple — Live").first()).toBeVisible();
  // exact: the header summary also contains "…display up" ("1/1 display up").
  // first: the auto-selected viewer header also renders "display up".
  await expect(page.getByText("display up", { exact: true }).first()).toBeVisible();
  // The audit node is NOT in the default view (it's behind "All namespace nodes").
  await expect(page.getByText("Audit 0o494d 0O494D")).toHaveCount(0);

  await page.screenshot({ path: path.join(OUT, `${DATE}_command-center-live-views_desktop.png`), fullPage: false });

  // Selecting the display offers the new-tab handoff.
  await page.getByText("Conv Simple — Live").first().click();
  const openLink = page.getByRole("link", { name: /Open Live View/i });
  await expect(openLink).toBeVisible({ timeout: 10_000 });
  await expect(openLink).toHaveAttribute("target", "_blank");
  await expect(openLink).toHaveAttribute("href", /\/api\/command-center\/display\//);

  // Demoted tree is reachable on demand.
  await page.getByText(/All namespace nodes \(2\)/).click();
  await expect(page.getByText("Audit 0o494d 0O494D")).toBeVisible();
});

test("refresh keeps the configured display present", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!, "cc-refresh-user");
  await page.route(/\/api\/command-center\/tree/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(treeWithDisplay(true)) }),
  );
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Conv Simple — Live").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /Refresh/i }).click();
  // Still present after an explicit refresh (re-fetch returns the same row).
  await expect(page.getByText("Conv Simple — Live").first()).toBeVisible();
  await expect(page.getByText(/Live Views \(1\)/)).toBeVisible();
});

test("unprobeable display stays listed as 'open to view' (configured, not missing)", async ({
  page, context, baseURL,
}) => {
  await auth(context, baseURL!, "cc-down-user");
  await page.route(/\/api\/command-center\/tree/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(treeWithDisplay(false)) }),
  );
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Conv Simple — Live").first()).toBeVisible({ timeout: 15_000 });
  // A display the cloud Hub can't server-side-probe (e.g. a Tailscale gateway) is
  // NOT shown as a red "down" — it's an honest "open to view ↗" the user can open
  // from their own browser. See DisplayDot in command-center/page.tsx.
  await expect(page.getByText("open to view ↗", { exact: true }).first()).toBeVisible();
});

test("empty state: onboarding CTA instead of an audit-node dump", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!, "cc-empty-user");
  await page.route(/\/api\/command-center\/tree/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(TREE_EMPTY) }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("No live screens connected yet")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Connect live screen/i }).first()).toBeVisible();
  // Audit nodes are NOT the primary content — hidden until explicitly browsed.
  await expect(page.getByText("Audit 0o494d 0O494D")).toHaveCount(0);

  await page.screenshot({ path: path.join(OUT, `${DATE}_command-center-empty-onboarding_desktop.png`), fullPage: false });

  // Demoted, not deleted: the operator can still reach the raw namespace.
  await page.getByText(/Browse all namespace nodes/).click();
  await expect(page.getByText("Audit 0o494d 0O494D")).toBeVisible();
});

test("ConnectedGatewaysBar shows online gateways from the registry", async ({
  page, context, baseURL,
}) => {
  await auth(context, baseURL!, "cc-gw-user");
  await page.route(/\/api\/command-center\/tree/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(treeWithDisplay(true)) }),
  );
  await page.route(/\/api\/command-center\/gateways/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(FAKE_GATEWAYS) }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/command-center", { waitUntil: "domcontentloaded" });

  // Gateway bar should surface the online gateway hostname.
  await expect(page.getByText(/plc-laptop\.local/)).toBeVisible({ timeout: 10_000 });

  await page.screenshot({
    path: path.join(OUT, `${DATE}_command-center-gateway-bar_desktop.png`),
    fullPage: false,
  });
});

// Defense-in-depth CSP guard (site-wide frame-src must keep 'self' for any future
// framed surface). The viewer hands off in a new tab rather than iframing.
test("CSP frame-src keeps 'self'", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!, "cc-csp-user");
  const res = await page.goto("/command-center", { waitUntil: "domcontentloaded" });
  const csp = res?.headers()["content-security-policy"] ?? "";
  const frameSrc = (csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "").trim();
  expect(frameSrc, "frame-src directive present").not.toBe("");
  expect(frameSrc, "frame-src must include 'self'").toContain("'self'");
});
