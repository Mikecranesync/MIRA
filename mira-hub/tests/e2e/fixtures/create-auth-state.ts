/* eslint-disable no-console */
/**
 * Interactive helper that opens a real Chromium window, lets you log in
 * to app.factorylm.com, then saves cookies + localStorage to a JSON file
 * Playwright can reuse via `storageState`.
 *
 * Run once per environment when the magic-link / Google OAuth session
 * expires:
 *   bun run tests/e2e/fixtures/create-auth-state.ts
 *
 * Output: tests/e2e/fixtures/storageState.json (gitignored).
 *
 * Then in playwright.config.ts (or per-test):
 *   use: { storageState: "tests/e2e/fixtures/storageState.json" }
 */
import { chromium } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, "storageState.json");
const TARGET_URL = process.env.AUTH_TARGET_URL ?? "https://app.factorylm.com/login";
const POST_LOGIN_MARKER =
  process.env.AUTH_POST_LOGIN_MARKER ?? "/feed";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`\n→ Opening ${TARGET_URL}`);
  console.log("  Log in (magic-link / Google OAuth) in the browser window.");
  console.log(
    `  Once you land on a page whose URL contains "${POST_LOGIN_MARKER}",`,
  );
  console.log("  this script will save the session and exit.\n");

  await page.goto(TARGET_URL);
  await page.waitForURL((url) => url.pathname.includes(POST_LOGIN_MARKER), {
    timeout: 10 * 60 * 1000, // 10 minutes — magic-link can take a while
  });

  await context.storageState({ path: STATE_PATH });
  console.log(`✓ Session saved to ${STATE_PATH}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
