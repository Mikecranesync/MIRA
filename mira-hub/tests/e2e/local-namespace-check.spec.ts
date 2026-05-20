import { test } from "@playwright/test";
import { AUDIT_USER, ensureUserRegistered, loginWithPassword } from "./fixtures/auth";

// HUB_URL must be set to the local dev server, e.g.:
//   HUB_URL=http://localhost:8888 bunx playwright test tests/e2e/local-namespace-check.spec.ts
const HUB_URL = process.env.HUB_URL ?? "http://localhost:8888";

test("local /namespace check", async ({ page, request }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  const networkFailures: { url: string; status: number; body?: string }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", async (res) => {
    if (res.status() >= 400) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        body = "(could not read body)";
      }
      networkFailures.push({ url: res.url(), status: res.status(), body });
    }
  });

  await ensureUserRegistered(request);
  await loginWithPassword(page);

  // Direct probe of the API route first — bypasses any client-side UI state.
  const apiRes = await page.request.get(`${HUB_URL}/api/namespace/tree`, {
    failOnStatusCode: false,
  });
  const apiStatus = apiRes.status();
  const apiBody = (await apiRes.text()).slice(0, 600);
  console.log(`[api] /api/namespace/tree -> ${apiStatus}`);
  console.log(`[api-body] ${apiBody}`);

  // Now drive the page.
  await page.goto(`${HUB_URL}/namespace`, { waitUntil: "networkidle", timeout: 60_000 });
  const title = await page.title();
  console.log(`[page] title: ${title}`);

  const visibleText = (await page.locator("body").innerText()).slice(0, 800);
  console.log(`[page-text] ${visibleText.replace(/\n+/g, " | ")}`);

  await page.screenshot({
    path: "test-results/local-namespace.png",
    fullPage: true,
  });
  console.log(`[screenshot] test-results/local-namespace.png`);

  console.log(`[console-errors] count=${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`  - ${e.slice(0, 200)}`);

  console.log(`[network-failures] count=${networkFailures.length}`);
  for (const f of networkFailures.slice(0, 10)) {
    console.log(`  - ${f.status} ${f.url}`);
    if (f.body) console.log(`    body: ${f.body}`);
  }
});

void AUDIT_USER;
