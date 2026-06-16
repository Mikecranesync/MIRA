/**
 * Non-interactive session capture for automated review tooling.
 *
 * Closes the "no unauthenticated view of product health" blind spot
 * (web-review 2026-05-28 #1): synthetic monitors, uptime checks, and the
 * `web-review` skill all bounce off the login wall and can only see /login.
 * This script logs in once via the REAL credentials provider and writes a
 * Playwright `storageState` JSON that those tools inject to reach authed
 * routes (feed, namespace, proposals, assets, admin) — enabling authenticated
 * crawls (broken-link detection, #2) and authed `?_rsc=` probes (503 repro, #3).
 *
 * Why login-capture and NOT a JWE forger: this exercises the real auth path,
 * needs no AUTH_SECRET, and can't drift from a NextAuth version bump.
 * The interactive sibling `tests/e2e/fixtures/create-auth-state.ts` is for a
 * human at a keyboard; this one is for CI / cron / unattended monitors.
 *
 * Usage (STAGING — the intended target):
 *   HUB_URL=http://127.0.0.1:4101 \
 *   E2E_HUB_EMAIL=playwright@factorylm.com E2E_HUB_PASSWORD=TestPass123 \
 *   bun run scripts/capture-review-session.ts
 *
 * Output: tests/e2e/.state/review-session.json (gitignored). Reuse via
 *   browser_run_code_unsafe / Playwright `context: { storageState: <path> }`,
 *   or extract the `next-auth.session-token` cookie for curl-based monitors.
 *
 * PRODUCTION is blocked by default: logging in here would create/exercise a
 * test account on prod (the exact pollution fixed in PR #1579). To target prod
 * you must set REVIEW_SESSION_ALLOW_PROD=1 AND supply a dedicated, non-default
 * monitoring account via E2E_HUB_EMAIL — never the shared test account.
 */
import { chromium } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, "..", "tests/e2e/.state/review-session.json");

const HUB_URL = process.env.HUB_URL ?? "http://127.0.0.1:4101";
const EMAIL = process.env.E2E_HUB_EMAIL ?? "playwright@factorylm.com";
const PASSWORD = process.env.E2E_HUB_PASSWORD ?? "TestPass123";
const DEFAULT_EMAIL = "playwright@factorylm.com";

// Production hostnames — capturing here would create/exercise a test account
// on prod (the pollution fixed in PR #1579). Listed explicitly so that staging
// on a *.factorylm.com subdomain (e.g. staging.factorylm.com) is NOT treated as
// prod; add new prod hostnames here if prod ever serves under another name.
const PROD_HOSTNAMES = new Set([
  "app.factorylm.com", // prod Hub
  "factorylm.com",     // prod marketing apex
  "165.245.138.91",    // prod VPS — guards the IP-direct bypass
]);

function assertNotProd(): void {
  let hostname = "";
  try {
    hostname = new URL(HUB_URL).hostname;
  } catch {
    console.error(`✗ HUB_URL is not a valid URL: ${HUB_URL}`);
    process.exit(1);
  }
  if (!PROD_HOSTNAMES.has(hostname)) return;
  if (process.env.REVIEW_SESSION_ALLOW_PROD !== "1") {
    console.error(
      `✗ Refusing to capture a session against production (${hostname}).\n` +
        `  This tool targets STAGING. Capturing here would create/exercise a\n` +
        `  test account on prod. Set HUB_URL to the staging tunnel, or for a\n` +
        `  genuine prod monitor set REVIEW_SESSION_ALLOW_PROD=1 with a dedicated\n` +
        `  E2E_HUB_EMAIL (never the shared ${DEFAULT_EMAIL}).`,
    );
    process.exit(1);
  }
  if (EMAIL === DEFAULT_EMAIL) {
    console.error(
      `✗ Refusing to use the shared test account (${DEFAULT_EMAIL}) against prod.\n` +
        `  Supply a dedicated monitoring account via E2E_HUB_EMAIL.`,
    );
    process.exit(1);
  }
}

async function ensureRegistered(): Promise<void> {
  // Idempotent — 200 (new) or 409 (exists) both fine; only 5xx is fatal.
  const res = await fetch(`${HUB_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Review Session" }),
  });
  if (res.status >= 500) {
    throw new Error(`register endpoint returned ${res.status}: ${await res.text()}`);
  }
}

async function main(): Promise<void> {
  assertNotProd();
  console.log(`→ Capturing review session against ${HUB_URL} as ${EMAIL}`);
  await ensureRegistered();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${HUB_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.click("text=Sign in with password");
    // Two email inputs (magic-link first, credentials second) — use .last().
    await page.locator('input[type="email"]').last().fill(EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await page.waitForURL(/\/(?:hub\/)?(feed|pending-approval|upgrade)\/?/, { timeout: 30_000 });

    mkdirSync(dirname(STATE_PATH), { recursive: true });
    await context.storageState({ path: STATE_PATH });
    console.log(`✓ Session saved to ${STATE_PATH}`);
    console.log(`  Landed on: ${page.url()}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
