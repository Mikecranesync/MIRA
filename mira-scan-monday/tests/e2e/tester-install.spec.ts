/**
 * Playwright spec — Phase 1 tester-install walkthrough automation.
 *
 * Designed to be run AFTER:
 *   - PRs #1557 + #1558 are merged + deployed
 *   - A tester Monday workspace exists (separate from Mike's main)
 *   - Mike has done the one-time install click in Monday Dev Center
 *
 * Drives Steps 3-7 of the goal flow. Steps 1 (Install button click)
 * and 8 (Uninstall click) require Mike inside Monday's admin UI; this
 * spec verifies the *server-side* effects of those clicks.
 *
 * Required env (set via Doppler `factorylm/dev` for safety — never run
 * destructive tests against prod with the prod tester account without
 * a separate test workspace):
 *   MONDAY_TESTER_SESSION_TOKEN   — JWT from devtools, scoped to tester
 *   MONDAY_TESTER_ACCOUNT_ID      — numeric account_id Monday issued
 *   MIRA_SCAN_API_BASE            — defaults to https://app.factorylm.com/api/scanbe
 *
 * Receipts land in tools/web-review-runs/2026-05-26-tester-install/.
 */
import { test, expect, request, type APIRequestContext } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const API_BASE =
  process.env.MIRA_SCAN_API_BASE ?? "https://app.factorylm.com/api/scanbe";
const TESTER_TOKEN = process.env.MONDAY_TESTER_SESSION_TOKEN ?? "";
const TESTER_ACCOUNT_ID = process.env.MONDAY_TESTER_ACCOUNT_ID ?? "";

const RECEIPTS_DIR = path.resolve(
  __dirname,
  "../../../tools/web-review-runs/2026-05-26-tester-install"
);

async function saveReceipt(name: string, body: string | Buffer): Promise<void> {
  await fs.mkdir(RECEIPTS_DIR, { recursive: true });
  await fs.writeFile(path.join(RECEIPTS_DIR, name), body);
}

test.describe("tester-install — server-side effects of Mike's Dev Center click", () => {
  test.skip(
    !TESTER_TOKEN || !TESTER_ACCOUNT_ID,
    "needs MONDAY_TESTER_SESSION_TOKEN + MONDAY_TESTER_ACCOUNT_ID"
  );

  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        "X-Monday-Session-Token": TESTER_TOKEN,
        "Content-Type": "application/json",
      },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("Step 2 keystone — /oauth/monday/install returns 302 to auth.monday.com", async () => {
    // Independent of session token; just checks the env-plumbing fix landed.
    const raw = await request.newContext({ baseURL: API_BASE });
    const resp = await raw.get("/oauth/monday/install", {
      maxRedirects: 0,
    });
    expect(resp.status(), `expected 302 got ${resp.status()}`).toBe(302);
    const location = resp.headers()["location"] ?? "";
    expect(location).toContain("auth.monday.com/oauth2/authorize");
    expect(location).toContain("client_id=");
    expect(location).toContain("redirect_uri=");
    await saveReceipt("02a-install-redirect-location.txt", location);
    await raw.dispose();
  });

  test("Step 3 — kb/lookup with tester sessionToken returns 200, not 401", async () => {
    const resp = await api.get("/kb/lookup?make=Allen-Bradley&model=PowerFlex+525");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    await saveReceipt("03-kb-lookup-tester.json", JSON.stringify(body, null, 2));
  });

  test("Step 5 — /chat/message returns sourced reply for tester", async () => {
    const resp = await api.post("/chat/message", {
      data: {
        message: "What is the rated current of a PowerFlex 525 5HP at 480V?",
        history: [],
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("reply");
    expect(body).toHaveProperty("sources");
    await saveReceipt("05-chat-response.json", JSON.stringify(body, null, 2));
  });

  test("Step 7 — rate-limit fires for tester after 30 messages", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i += 1) {
      const resp = await api.post("/chat/message", {
        data: { message: `burst test ${i}`, history: [] },
      });
      statuses.push(resp.status());
      if (resp.status() === 429) {
        const body = await resp.json();
        expect(body.detail.error).toBe("rate_limit_exceeded");
        break;
      }
    }
    await saveReceipt("07-rate-limit-statuses.txt", statuses.join("\n"));
    expect(statuses).toContain(429);
  });
});
