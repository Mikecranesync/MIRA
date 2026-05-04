import { test, expect } from "@playwright/test";

// Diagnostic test for the /hub-is-down investigation. Probes the live
// production endpoint and reports what a real Chromium navigation sees,
// since curl alone has been showing 200 + empty body but not telling us
// what (if anything) renders. Safe: read-only, no mutations.

// Phase 1: HUB_PATH=/hub  Phase 2: HUB_PATH=
const HUB_PATH = process.env.HUB_PATH ?? "/hub";

test("diagnose /hub root response and rendering", async ({ page, request }) => {
  console.log("\n=== DIRECT REQUEST (no JS) ===");
  const res = await request.get(`${HUB_PATH}/`, { maxRedirects: 0 });
  console.log(`HTTP ${res.status()}`);
  console.log(`Headers:`, JSON.stringify(res.headers(), null, 2));
  const body = await res.text();
  console.log(`Body length: ${body.length}`);
  if (body.length > 0) {
    console.log(`First 300 chars:\n${body.slice(0, 300)}`);
  } else {
    console.log("Body is EMPTY");
  }

  console.log("\n=== FOLLOWED REDIRECTS ===");
  const followed = await request.get(`${HUB_PATH}/`);
  console.log(`Final URL: ${followed.url()}`);
  console.log(`Final status: ${followed.status()}`);
  console.log(`Final body length: ${(await followed.text()).length}`);

  console.log("\n=== BROWSER NAVIGATION (with JS, follows everything) ===");
  const consoleLogs: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const response = await page.goto(`${HUB_PATH}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
  console.log(`Initial response status: ${response?.status()}`);
  console.log(`Final URL after navigation: ${page.url()}`);

  const title = await page.title();
  console.log(`Page title: "${title}"`);

  const bodyHTML = await page.evaluate(() => document.body?.outerHTML?.slice(0, 500) ?? "<no body>");
  console.log(`Body HTML (first 500):\n${bodyHTML}`);

  const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "<no innerText>");
  console.log(`Visible text:\n${visibleText}`);

  if (consoleLogs.length > 0) {
    console.log(`\n=== CONSOLE LOGS (${consoleLogs.length}) ===`);
    consoleLogs.forEach((l) => console.log(l));
  }
  if (pageErrors.length > 0) {
    console.log(`\n=== PAGE ERRORS (${pageErrors.length}) ===`);
    pageErrors.forEach((e) => console.log(e));
  }

  // Don't fail the test — this is diagnostic. We just want the output.
  expect(true).toBe(true);
});
