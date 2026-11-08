import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "../../../mira-web/node_modules/playwright";

// Run from mira-web, after its locked dependencies are installed:
// env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" PORT=0 \
//   PLG_POSTHOG_KEY=phc_local_disclosure_proof PLG_POSTHOG_HOST=https://analytics.invalid \
//   bun --no-env-file ../docs/proofs/posthog-disclosure-5124/browser-proof.ts
const allowed = new Set(["PATH", "HOME", "TMPDIR", "PORT", "PLG_POSTHOG_KEY", "PLG_POSTHOG_HOST"]);
assert.deepEqual(Object.keys(process.env).filter((name) => !allowed.has(name)), [], "Use the stripped environment command above");
assert.equal(process.env.PLG_POSTHOG_KEY, "phc_local_disclosure_proof");
assert.equal(process.env.PLG_POSTHOG_HOST, "https://analytics.invalid");
assert.equal(process.env.PORT, "0");

const root = path.resolve(import.meta.dir, "..", "..", "..");
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const date = new Date().toISOString().slice(0, 10);
const sourcePaths = [
  ".github/workflows/ci.yml",
  "mira-web/public/privacy.html",
  "mira-web/public/trust.html",
  "mira-web/src/server.ts",
  "mira-web/src/capabilities/posthog-init-route.test.ts",
  "mira-web/src/views/__tests__/honest-claims.test.ts",
  "docs/proofs/posthog-disclosure-5124/browser-proof.ts",
];
const sourceHashes = Object.fromEntries(sourcePaths.map((file) => [
  file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex"),
]));
const parent = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
assert.equal(parent.exitCode, 0);

async function focusPosthogRow(page: Page) {
  const cell = page.getByRole("cell", { name: "PostHog", exact: true });
  assert(await cell.isVisible());
  await cell.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForFunction(() => {
    const cell = [...document.querySelectorAll(".legal td")].find((element) => element.textContent?.trim() === "PostHog");
    if (!cell) return false;
    const box = cell.getBoundingClientRect();
    const headerBottom = Math.max(0, ...[...document.querySelectorAll("header, nav")]
      .filter((element) => ["fixed", "sticky"].includes(getComputedStyle(element).position))
      .map((element) => element.getBoundingClientRect().bottom));
    const front = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.top >= headerBottom && box.bottom <= innerHeight && !!front && cell.contains(front);
  });
  return cell.boundingBox();
}

// Import only after the strict no-credentials guard, since startup normally runs DDL.
const config = (await import(pathToFileURL(path.join(root, "mira-web/src/server.ts")).href)).default;
const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
const origin = server.url.origin;
let browser: Browser | undefined;
let exitCode = 0;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const cases: Array<Record<string, unknown>> = [];
  const captures: Array<{ page: Page; file: string; result: Record<string, unknown> }> = [];
  let externalRequestsBlocked = 0;
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900, mobile: false },
    { name: "mobile", width: 412, height: 915, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === origin) await route.continue();
      else { externalRequestsBlocked++; await route.abort(); }
    });
    for (const route of ["/privacy", "/trust"]) {
      const page = await context.newPage();
      const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200);
      const legal = page.locator(".legal");
      const text = await legal.innerText();
      assert(text.includes("The factorylm.com snippet does not enable session replay"));
      assert(text.includes("autocapture") && text.includes("server-side product-funnel events"));
      assert(!text.includes("We do not use cookies for tracking"));
      assert(!text.includes("no tracking cookies"));
      const posthogViewportBox = await focusPosthogRow(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 0, `${route} overflows at ${viewport.width}px: ${overflow}`);
      const replayDisabled = await page.evaluate(() => {
        const analytics = (window as unknown as { posthog?: { _i?: Array<[unknown, Record<string, unknown>]> } }).posthog;
        return analytics?._i?.[0]?.[1]?.disable_session_recording ?? null;
      });
      if (route === "/privacy") assert.equal(replayDisabled, true);
      const result = {
        route, viewport: viewport.name, width: viewport.width, height: viewport.height,
        httpStatus: response!.status(), visiblePosthogCell: true, overflowPx: overflow,
        configuredReplayDisabled: replayDisabled, posthogViewportBox,
      };
      const file = `docs/promo-screenshots/${date}_posthog-disclosure-5124-${runId}-${route.slice(1)}_${viewport.name}.png`;
      assert(!existsSync(path.join(root, file)), "Screenshots are append-only");
      cases.push(result);
      captures.push({ page, file, result });
    }
  }
  // Validate every viewport before generating any screenshot in the append-only archive.
  for (const capture of captures) {
    capture.result.posthogViewportBox = await focusPosthogRow(capture.page);
    await capture.page.screenshot({ path: path.join(root, capture.file) });
    capture.result.screenshot = capture.file;
  }
  const receipt = {
    status: "PASS", environment: "local candidate; no DB; fake analytics; external requests blocked",
    sourceGitParent: new TextDecoder().decode(parent.stdout).trim(),
    identity: "source-byte hashes (not a claim that the parent commit contains uncommitted changes)",
    sourceHashes, browser: browser.version(), externalRequestsBlocked, cases,
    limitations: "No external SDK ingestion, live provider inventory, production deployment, physical phone, or offline acceptance verified",
  };
  const receiptPath = `docs/proofs/posthog-disclosure-5124/receipt-${runId}.json`;
  assert(!existsSync(path.join(root, receiptPath)));
  await Bun.write(path.join(root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", origin, receiptPath, screenshots: captures.map((capture) => capture.file) }));
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser?.close();
  server.stop(true);
  process.exit(exitCode); // Stop this proof process's startup scheduler; no shared process is touched.
}
