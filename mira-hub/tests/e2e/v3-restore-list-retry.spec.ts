/**
 * #3882 browser proof: reopening a preserved `/v3/?notebook=&thread=` URL must
 * restore that notebook even when the FIRST notebook-list GET fails (the cold
 * restart shape on the 2026-11-05 Pixel run). The list is failed once with a
 * route intercept; every other request goes to the real local dev Hub.
 *
 * Runs on a LOCAL dev server (dev Neon, never staging) with a real sign-in;
 * the notebook API is stubbed (see below). No chat turn, so no model call.
 *
 *   HUB_URL=http://localhost:3131 E2E_EMAIL=… E2E_PASSWORD=… \
 *     npx playwright test --config tests/e2e/v3-restore-list-retry.playwright.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3131").replace(/\/$/, "");
const OUT = process.env.PROOF_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "proofs", "2026-11-07-3882-restore-retry");
const LABEL = process.env.PROOF_LABEL ?? "run";

async function signIn(page: Page, email: string, password: string): Promise<void> {
  const csrf = (await (await page.request.get(`${HUB}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await page.request.post(`${HUB}/api/auth/callback/credentials/`, {
    form: { email, password, csrfToken: csrf.csrfToken, redirect: "false", json: "true", callbackUrl: HUB },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
  const me = await page.request.get(`${HUB}/api/me/`);
  expect(me.status(), "signed-in /api/me").toBe(200);
}

test("a failed first notebook-list GET still restores the URL's notebook (#3882)", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, "E2E_EMAIL/E2E_PASSWORD required (dev account)");
  fs.mkdirSync(OUT, { recursive: true });
  await signIn(page, email!, password!);

  // The dev schema has no notebook tables (2026-11-07: ledger = 2 rows), and
  // migrations are out of scope, so the notebook API is stubbed in the browser.
  // Auth, the page bundle and every other route stay real. This exercises the
  // client restore path the fix changes, not the server list query.
  const notebookId = randomUUID();
  const threadId = randomUUID(); // an empty thread, as on the Pixel (no chat turn)
  const name = `E2E-3882 ${notebookId.slice(0, 6)} (synthetic stub)`;
  const nb = {
    id: notebookId, displayName: name, manufacturer: "AutomationDirect", model: "GS10", catalogNumber: null,
    serialNumber: null, equipmentType: null, assetTag: null, locationLabel: null, identityStatus: "user_confirmed",
    identityConfidence: null, identitySourceType: "user", nodeId: `node-${notebookId}`, sourceCount: 0,
    lastOpenedAt: null, createdAt: new Date().toISOString(), asset: null, threads: [],
  };
  const listCalls: { status: number; ms: number }[] = [];
  const t0 = Date.now();
  // Fail every list GET in the first 500 ms. In dev, React may mount the host
  // twice, so two loads fire about 1 ms apart; failing only the first request
  // would let the second, concurrent load restore the URL even without a retry.
  let firstAt: number | null = null;
  await page.route(/\/api\/equipment-notebooks\/(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const now = Date.now();
    if (firstAt === null) firstAt = now;
    if (now - firstAt < 500) {
      listCalls.push({ status: 503, ms: now - t0 });
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"injected"}' });
    }
    listCalls.push({ status: 200, ms: Date.now() - t0 });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notebooks: [nb] }) });
  });
  await page.route(new RegExp(`/api/equipment-notebooks/${notebookId}/(\\?.*)?$`), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notebook: nb, sources: [], turns: [], manualSearch: null }) }),
  );
  const warnings: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });

  await page.goto(`${HUB}/v3/?notebook=${notebookId}&thread=${threadId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Long enough for both retries (1 s + 3 s) and the detail load.
  await page.waitForTimeout(12_000);

  const restored = await page.evaluate(() => new URLSearchParams(location.search).get("notebook"));
  const scope = await page.getByText(/General question/).count();
  const nameShown = await page.getByText(name).count();
  const pill = await page.getByTestId("living-sheet-pill").count();
  const receipt = { label: LABEL, listCalls, warnings: warnings.filter((w) => w.includes("notebook list")), urlNotebookKept: restored === notebookId, generalQuestionShown: scope > 0, jobSheetPill: pill > 0, notebookNameShown: nameShown > 0, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: path.join(OUT, `${LABEL}-mobile.png`) });

  expect(listCalls.length, "the list must be requested again after the injected failure").toBeGreaterThanOrEqual(2);
  expect(scope, "must not land on HOME / General question").toBe(0);
});
