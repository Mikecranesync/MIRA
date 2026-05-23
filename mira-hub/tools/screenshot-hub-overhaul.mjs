// Captures sidebar + labs-stub screenshots for the hub-overhaul PR.
// Logging in requires a NEXT_AUTH session, which is too heavy for this
// one-off. Instead we capture the LabsStub directly (it renders before
// the auth gate when the env flag is off, but the (hub) layout still
// runs the middleware → /login redirect).
//
// Strategy: hit the public quickstart page (already covered) + capture
// /hub/login + the home redirect. Sidebar screenshot is best-captured
// from a logged-in env; deferred to staging Playwright run.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.HUB_BASE ?? "http://localhost:3100";
const OUT = join("..", "docs", "promo-screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function snap(name, url, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
  } catch {
    // Render whatever we got.
  }
  await page.waitForTimeout(500);
  const file = join(OUT, `2026-05-20_hub-overhaul_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
  await ctx.close();
}

await snap("login_desktop",     `${BASE}/hub/login`,      { width: 1440, height: 900 });
await snap("signup_desktop",    `${BASE}/hub/signup`,     { width: 1440, height: 900 });
await snap("quickstart_query",  `${BASE}/hub/quickstart/?demo=1`, { width: 1440, height: 900 });

await browser.close();
console.log("done");
