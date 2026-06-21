/**
 * Human-like laptop -> cloud E2E.
 *
 * Phase A (laptop): drive the offline contextualizer UI with real clicks to
 *   create a profile, CCW-import a PLC program, accept the extracted signals,
 *   and export a Factory Context Bundle (.zip).
 * Phase B (cloud): drive the Hub UI with real clicks to import that bundle,
 *   review the signals, Promote them to the knowledge graph, and approve so a
 *   kg_entities row is verified.
 *
 * Auth + the offline server come from laptop-to-cloud.globalSetup.ts.
 * Run via: npx playwright test --config playwright.e2e-laptop-to-cloud.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = path.join(__dirname, ".state");
const OFFLINE_URL: string = JSON.parse(
  fs.readFileSync(path.join(STATE_DIR, "offline.json"), "utf-8"),
).url;

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PLC_DIR = process.env.MIRA_PLC_DIR ?? path.join(REPO_ROOT, "plc");
const ST_FILE = path.join(PLC_DIR, "Micro820_v4.1.9_Program.st");
const XML_FILE = path.join(PLC_DIR, "MbSrvConf_v4.xml");

const HUB = "/hub"; // basePath; baseURL is the bare origin
const OUT_DIR = path.join("test-results", "laptop-to-cloud");
const BUNDLE_PATH = path.join(OUT_DIR, "bundle.zip");

// ── per-run console + network capture (saved to the run dir) ────────────────
type LogEntry = { kind: string; text: string; at: string };
function attachListeners(page: Page, sink: LogEntry[]) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      sink.push({ kind: `console.${m.type()}`, text: m.text().slice(0, 500), at: page.url() });
  });
  page.on("pageerror", (e) => sink.push({ kind: "pageerror", text: `${e.name}: ${e.message}`, at: page.url() }));
  page.on("response", (r) => {
    if (r.status() >= 400) sink.push({ kind: `http.${r.status()}`, text: `${r.request().method()} ${r.url()}`, at: page.url() });
  });
}

test("laptop -> cloud: offline parse to Hub verified", async ({ page }) => {
  test.setTimeout(180_000);
  const logs: LogEntry[] = [];
  attachListeners(page, logs);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── PHASE A — offline contextualizer (real clicks) ────────────────────────
  await test.step("A1: open offline app + create profile", async () => {
    await page.goto(`${OFFLINE_URL}/index.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#newName", "E2E Garage Conveyor");
    await page.locator('button.btn.primary[onclick="createProfile()"]').click();
    await expect(page.locator("#projectList")).toContainText("E2E Garage Conveyor");
  });

  await test.step("A2: CCW-import the PLC program", async () => {
    // The "CCW Project" button proxies a hidden webkitdirectory input — Playwright
    // requires a *directory* path for those, so stage the PLC files in a temp dir.
    const ccwDir = path.join(OUT_DIR, "ccw-src");
    fs.mkdirSync(ccwDir, { recursive: true });
    fs.copyFileSync(ST_FILE, path.join(ccwDir, path.basename(ST_FILE)));
    fs.copyFileSync(XML_FILE, path.join(ccwDir, path.basename(XML_FILE)));
    await page.locator("#dirInput").setInputFiles(ccwDir);
    // signals land in the Extracted Signals view; wait for rows to populate.
    await page.locator('#viewTabs button:has-text("Extracted Signals")').click();
    await expect.poll(() => page.locator("table tr").count(), { timeout: 30_000 }).toBeGreaterThan(50);
  });

  await test.step("A3: accept all extracted signals", async () => {
    await page.locator('#viewTabs button:has-text("Review Queue")').click();
    const accepts = page.locator('button:has-text("Accept")');
    // decide() does an async full re-render (Review Queue shows only pending), so
    // each accept removes exactly one row. Click the first, then wait for the count
    // to strictly decrease before the next click — avoids the re-render detach race.
    let pending = await accepts.count();
    let guard = 400;
    while (pending > 0 && guard-- > 0) {
      await accepts.first().click();
      await expect.poll(() => accepts.count(), { timeout: 10_000 }).toBeLessThan(pending);
      pending = await accepts.count();
    }
    await expect(accepts).toHaveCount(0);
  });

  await test.step("A4: export bundle (.zip)", async () => {
    await page.locator('#viewTabs button:has-text("Dashboard")').click();
    const dl = page.waitForEvent("download");
    await page.locator('button.btn.primary[onclick="exportBundle()"]').click();
    const download = await dl;
    await download.saveAs(BUNDLE_PATH);
    expect(fs.statSync(BUNDLE_PATH).size).toBeGreaterThan(1000);
  });

  // ── PHASE B — Hub (real clicks, authenticated via storageState) ───────────
  await test.step("B1: open Contextualization + import the bundle", async () => {
    await page.goto(`${HUB}/contextualization`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Import bundle/ }).click();
    // modal: leave "Import into: New project", then attach the file to the hidden input.
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles(BUNDLE_PATH);
    // success routes into the new project's signal review.
    await expect(page).toHaveURL(/\/contextualization\/[0-9a-f-]{36}/, { timeout: 30_000 });
  });

  await test.step("B2: review signals + Promote", async () => {
    await expect(page.getByRole("heading", { name: /Extracted Signals/ })).toBeVisible();
    await expect.poll(() => page.locator("table tbody tr").count(), { timeout: 20_000 }).toBeGreaterThan(50);
    const promote = page.getByRole("button", { name: /Promote/ });
    await expect(promote).toBeEnabled();
    await promote.click();
  });

  await test.step("B3: approve a suggestion so kg_entities is verified", async () => {
    // Promote stages each accepted signal as a kg_entity (proposed) + a paired
    // ai_suggestion (pending). The verify/approve queue is /knowledge/suggestions
    // (the "Pending" tab is default). Accepting one promotes its kg_entity to verified.
    await page.goto(`${HUB}/knowledge/suggestions`, { waitUntil: "domcontentloaded" });
    const cards = page.locator('[data-testid="suggestion-card"]');
    const verify = page.locator('[data-testid="suggestion-verify"]').first();
    await expect(verify).toBeVisible({ timeout: 30_000 });
    const before = await cards.count();
    await verify.click();
    // the accepted suggestion leaves the Pending list → its kg_entity is now verified
    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeLessThan(before);
    // confirm it shows under the Verified filter
    await page.getByRole("button", { name: /^Verified$/ }).click();
    await expect(page.locator('[data-testid="suggestion-card"]').first()).toBeVisible({ timeout: 15_000 });
  });

  // persist captured logs for the /loop to read
  fs.writeFileSync(path.join(OUT_DIR, "console-network.json"), JSON.stringify(logs, null, 2));
});
