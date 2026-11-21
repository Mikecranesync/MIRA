/**
 * #5551 — Prepare job for a maker job packets don't cover, and the synthetic demo controls.
 * Every /api request is answered here (unmatched ones fail the test); no DB, no provider.
 * Fixture proof only. LOCAL ONLY: lives outside tests/e2e (the default config's testDir targets
 * production) and refuses any non-loopback baseURL before it encodes a cookie or opens a page.
 * Run: npx playwright test --config playwright.prepare-job-5551.config.ts
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as fs from "node:fs";
import * as path from "node:path";

const SHOT_DIR = process.env.SHOT_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");
async function shot(page: Page, name: string, project: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `2026-11-21_${name}_${project}.png`) });
}

const AUTH_SECRET = "pj-5551-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "00000000-0000-0000-0000-000000005551";
const NB = "00000000-0000-4000-8000-000000005551";

async function auth(context: BrowserContext, baseURL: string) {
  const token = await encode({
    token: { uid: "pj5551", tid: TENANT_ID, status: "trial", trialExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), email: "pj5551@factorylm-test.com" },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
}

type Avail = { manufacturer: string; blocking: null | { reason: string; message: string } };
const SIEMENS: Avail = { manufacturer: "Siemens", blocking: { reason: "manufacturer_not_supported", message: "stale server wording" } };
const CAT: Avail = { manufacturer: "CAT Pumps", blocking: null };

function notebook(manufacturer: string, status = "user_confirmed") {
  return {
    id: NB, displayName: "Pump 5551", manufacturer, model: "X1", catalogNumber: null, serialNumber: null, equipmentType: null,
    assetTag: null, locationLabel: null, identityStatus: status, identityConfidence: null, identitySourceType: "user",
    nodeId: "node-5551", sourceCount: 0, lastOpenedAt: null, createdAt: "2026-11-14T00:00:00.000Z", asset: null,
  };
}
const availability = (a: Avail, status = a.blocking?.reason === "identity_not_confirmed" ? "pending" : "user_confirmed") => ({
  enabled: true, documents: [], documentsState: "read",
  identity: { manufacturer: a.manufacturer, model: "X1", catalogNumber: null, serialNumber: null, status, confidence: null }, blocking: a.blocking,
});

/** Answers every /api request (unmocked reads get an empty 200 and are listed; unmocked writes fail the test); `state.avail` can change mid-test (identity confirmation). */
async function mockApi(page: Page, state: { avail: Avail }, unhandled: string[]) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const p = url.pathname.replace(/\/$/, "");
    if (p.endsWith("/work-packet") && method === "GET") return route.fulfill({ json: availability(state.avail) });
    if (p.endsWith("/identity/confirm") && method === "POST") {
      state.avail = SIEMENS;
      return route.fulfill({ json: { ok: true, message: "Confirmed." } });
    }
    if (p === "/api/equipment-notebooks" && method === "GET") return route.fulfill({ json: { notebooks: [{ ...notebook(state.avail.manufacturer, state.avail.blocking?.reason === "identity_not_confirmed" ? "pending" : "user_confirmed"), threads: [] }] } });
    if (p === `/api/equipment-notebooks/${NB}` && method === "GET") {
      return route.fulfill({ json: { notebook: notebook(state.avail.manufacturer, state.avail.blocking?.reason === "identity_not_confirmed" ? "pending" : "user_confirmed"), sources: [], turns: [], threads: [], photos: [], manualSearch: null } });
    }
    if (p === "/api/auth/session") return route.fulfill({ json: { user: { email: "pj5551@factorylm-test.com" }, expires: new Date(Date.now() + 86_400_000).toISOString() } });
    if (p.startsWith("/api/auth")) return route.fulfill({ json: {} });
    unhandled.push(`${method} ${p}`);
    if (method !== "GET") return route.abort(); // an unmocked write fails the request and the test
    return route.fulfill({ status: 200, json: {} });
  });
}

async function openMenuItemOrPill(page: Page): Promise<boolean> {
  const pill = page.getByTestId("wp-open");
  if (await pill.count()) { await pill.click(); return true; }
  const more = page.getByRole("button", { name: /more/i }).first();
  if (await more.count()) {
    await more.click();
    const item = page.getByRole("menuitem", { name: /prepare job/i }).or(page.getByRole("button", { name: /prepare job/i })).first();
    if (await item.count()) { await item.click(); return true; }
  }
  return false;
}

const FORM = ["wp-workorder", "wp-build", "wp-load-synthetic"];
async function expectNoForm(page: Page) {
  for (const id of FORM) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText(/Synthetic \/ demo/)).toHaveCount(0);
}

/** Loopback hosts only. Throws before any cookie is minted or page is touched. */
export function assertLoopback(baseURL: string | undefined): string {
  let host = "";
  try { host = new URL(baseURL ?? "").hostname.replace(/^\[|\]$/g, ""); } catch { /* falls through to refusal */ }
  if (!(host === "127.0.0.1" || host === "localhost" || host === "::1")) {
    throw new Error(`prepare-job-5551 fixture refuses non-loopback baseURL: ${baseURL ?? "(none)"}`);
  }
  return baseURL!;
}

test.beforeEach(async ({ context, baseURL }) => { await auth(context, assertLoopback(baseURL)); });

test("known unsupported maker: no Prepare job entry up front", async ({ page }) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: SIEMENS }, unhandled);
  const settled = page.waitForResponse((r) => r.url().includes("/work-packet/"), { timeout: 60_000 });
  await page.goto(`/v3/?notebook=${NB}`, { waitUntil: "domcontentloaded" });
  await settled;
  await page.waitForTimeout(750); // the menu registers on the render after the response
  await expect(page.getByTestId("notebook-actions")).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId("wp-open")).toHaveCount(0);
  // Let availability settle (the panel fetches on mount), then open More if it exists: the
  // Prepare job item must not be listed. The CAT control below proves the same locator CAN match.
  const more = page.getByTestId("notebook-more");
  if (await more.count()) await more.click();
  await expect(page.getByTestId("notebook-more-item-work-packet")).toHaveCount(0);
  expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);
});

test("direct ?workpacket=open on Siemens: plain message, Close works, no form or demo controls", async ({ page }, info) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: SIEMENS }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  const msg = page.getByTestId("wp-unsupported-message");
  await expect(msg).toBeVisible({ timeout: 60_000 });
  await expect(msg).toContainText("Job packets aren't available for Siemens equipment yet.");
  await expect(page.getByTestId("wp-dialog")).not.toContainText(/own documents|attach/i);
  await expectNoForm(page);
  await shot(page, "prepare-job-5551-siemens-direct-link", info.project.name);
  await page.getByTestId("wp-close").click();
  await expect(page.getByTestId("wp-dialog")).not.toBeVisible();
  expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);
});

test("identity confirmed inside the open panel becomes unsupported: reason stays, Close available, form hidden", async ({ page }) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: { manufacturer: "", blocking: { reason: "identity_not_confirmed", message: "Confirm identity." } } }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("wp-typed-manufacturer").fill("Siemens", { timeout: 60_000 });
  await page.getByTestId("wp-typed-model").fill("X1");
  await page.getByTestId("wp-typed-confirm").click();
  await expect(page.getByTestId("wp-unsupported-message")).toContainText("Siemens equipment yet");
  await expect(page.getByTestId("wp-close")).toBeVisible();
  await expectNoForm(page);
  expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);
});

test("supported CAT Pumps: normal form, no demo controls", async ({ page }, info) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: CAT }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("wp-build")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wp-unsupported")).toHaveCount(0);
  await expect(page.getByTestId("wp-load-synthetic")).toHaveCount(0);
  await expect(page.getByText(/Synthetic \/ demo/)).toHaveCount(0);
  await shot(page, "prepare-job-5551-cat-pumps-no-demo", info.project.name);
  // Control: for a supported maker the Prepare job entry IS listed under More.
  await page.getByTestId("wp-close").click();
  await page.getByTestId("notebook-more").click();
  await expect(page.getByTestId("notebook-more-item-work-packet")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);
});

test("feature flag off (404): renders nothing", async ({ page }) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: CAT }, unhandled);
  await page.route("**/api/equipment-notebooks/*/work-packet/**", (r) => r.fulfill({ status: 404, json: { error: "not_found" } }));
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notebook-actions")).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId("wp-dialog")).toHaveCount(0);
  await expect(page.getByTestId("wp-open")).toHaveCount(0);
  expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);
});
