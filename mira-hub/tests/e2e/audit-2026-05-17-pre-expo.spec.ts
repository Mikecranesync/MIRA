/**
 * Pre-expo audit — 2026-05-17.
 *
 * Mike asked specifically:
 *   1. QR generation on every asset AND every subsystem/component
 *   2. "Upload Document" button on each asset page
 *   3. Google Drive link in Knowledge is broken
 *   4. Comprehensive Playwright pass of every Hub page
 *   5. Scan QR (camera) page — /scan
 *
 * Output:
 *   - docs/promo-screenshots/2026-05-17_<route>_desktop.png
 *   - mira-hub/test-results/audit-2026-05-17/findings.json
 *
 * Uses the storageState from audit-setup (playwright.audit.config.ts).
 */

import { test, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
const SCREENSHOTS = path.resolve(__dirname, "../../../docs/promo-screenshots");
const FINDINGS_DIR = path.resolve(__dirname, "../../test-results/audit-2026-05-17");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
fs.mkdirSync(FINDINGS_DIR, { recursive: true });

type RouteFinding = {
  route: string;
  status: number | null;
  finalUrl: string;
  consoleErrors: string[];
  failedRequests: { url: string; status: number }[];
  notes: string[];
};

const ROUTES = [
  "/feed",
  "/assets",
  "/namespace",
  "/knowledge",
  "/documents",
  "/workorders",
  "/conversations",
  "/alerts",
  "/event-log",
  "/parts",
  "/proposals",
  "/reports",
  "/channels",
  "/integrations",
  "/cmms",
  "/team",
  "/schedule",
  "/library",
  "/usage",
  "/plc",
  "/requests",
  "/more",
  "/scan", // Mike's new ask — verify if route exists
];

async function gotoCapture(page: Page, route: string): Promise<RouteFinding> {
  const finding: RouteFinding = {
    route,
    status: null,
    finalUrl: "",
    consoleErrors: [],
    failedRequests: [],
    notes: [],
  };

  const consoleHandler = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") finding.consoleErrors.push(msg.text().slice(0, 300));
  };
  const reqHandler = (resp: import("@playwright/test").Response) => {
    const s = resp.status();
    if (s >= 400 && !resp.url().includes("/_next/")) {
      finding.failedRequests.push({ url: resp.url(), status: s });
    }
  };
  page.on("console", consoleHandler);
  page.on("response", reqHandler);

  try {
    const resp = await page.goto(`${HUB}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    finding.status = resp?.status() ?? null;
    finding.finalUrl = page.url();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  } catch (e) {
    finding.notes.push(`navigation failed: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    page.off("console", consoleHandler);
    page.off("response", reqHandler);
  }

  return finding;
}

// Each test writes its own finding file to avoid afterAll races overwriting.
function persistFinding(f: RouteFinding) {
  const safe = f.route.replace(/^\//, "").replace(/\//g, "-").replace(/[\[\]]/g, "") || "root";
  fs.writeFileSync(
    path.join(FINDINGS_DIR, `finding-${safe}-${Date.now()}.json`),
    JSON.stringify(f, null, 2),
  );
}

test.describe("Pre-expo Hub audit 2026-05-17", () => {
  test.setTimeout(60_000);

  for (const route of ROUTES) {
    test(`route ${route}`, async ({ page }) => {
      const finding = await gotoCapture(page, route);

      // Screenshot regardless of status — we want to see the failure state too
      const safeName = route.replace(/^\//, "").replace(/\//g, "-") || "root";
      const ssPath = path.join(SCREENSHOTS, `2026-05-17_hub-${safeName}_desktop.png`);
      await page.screenshot({ path: ssPath, fullPage: false }).catch((e) => {
        finding.notes.push(`screenshot failed: ${(e as Error).message}`);
      });

      persistFinding(finding);
      console.log(`[audit] ${route} → status=${finding.status} errs=${finding.consoleErrors.length} failedReqs=${finding.failedRequests.length} ss=${ssPath}`);
    });
  }

  test("Mike concern #1 — find a real asset and test QR availability", async ({ page }) => {
    // Get a real asset id
    const apiResp = await page.request.get(`${HUB}/api/assets`);
    const note: RouteFinding = {
      route: "/assets/[id]",
      status: apiResp.status(),
      finalUrl: "",
      consoleErrors: [],
      failedRequests: [],
      notes: [],
    };

    if (!apiResp.ok()) {
      note.notes.push(`GET /api/assets returned ${apiResp.status()}`);
      persistFinding(note);
      return;
    }
    const json = await apiResp.json().catch(() => null);
    const list: Array<{ id: string | number; tag?: string; name?: string }> =
      (json?.assets ?? json?.data ?? json) as Array<{ id: string | number; tag?: string; name?: string }>;
    if (!Array.isArray(list) || list.length === 0) {
      note.notes.push("no assets returned from /api/assets");
      persistFinding(note);
      return;
    }

    const asset = list[0];
    const id = asset.id;
    const f = await gotoCapture(page, `/assets/${id}`);
    f.route = `/assets/${id}`;
    const safe = `asset-${String(id).slice(0, 8)}`;
    await page.screenshot({ path: path.join(SCREENSHOTS, `2026-05-17_hub-${safe}_desktop.png`) }).catch(() => {});

    // Inspect for QR button + Upload Document button presence
    const qrBtn = await page.locator("button:has-text('QR'), button:has-text('Generate QR'), [aria-label*='QR' i]").count();
    const uploadBtn = await page.locator("button:has-text('Upload'), button:has-text('Add Document'), button:has-text('Upload Document')").count();
    f.notes.push(`qrButtonCount=${qrBtn}`);
    f.notes.push(`uploadDocumentButtonCount=${uploadBtn}`);
    if (qrBtn === 0) f.notes.push("MISSING: QR generation control on asset detail");
    if (uploadBtn === 0) f.notes.push("MISSING: Upload Document button on asset detail (Mike #2)");

    persistFinding(f);
  });

  test("Mike concern #3 — Knowledge Google Drive picker", async ({ page }) => {
    const f = await gotoCapture(page, "/knowledge");
    await page.screenshot({ path: path.join(SCREENSHOTS, `2026-05-17_hub-knowledge-uploadbtn_desktop.png`) }).catch(() => {});

    // Look for "Add to Knowledge" / Upload button
    const addBtn = page.locator("button:has-text('Upload'), button:has-text('Add to Knowledge'), button:has-text('Add document')").first();
    const addBtnCount = await page.locator("button:has-text('Upload'), button:has-text('Add to Knowledge'), button:has-text('Add document')").count();
    f.notes.push(`addButtonCount=${addBtnCount}`);

    if (addBtnCount === 0) {
      f.notes.push("MISSING: Upload / Add-to-Knowledge button on /knowledge");
      persistFinding(f);
      return;
    }

    await addBtn.click().catch((e) => f.notes.push(`addBtn click failed: ${(e as Error).message}`));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS, `2026-05-17_hub-knowledge-picker-open_desktop.png`) }).catch(() => {});

    const googleBtn = page.locator("button:has-text('Google'), button:has-text('Drive'), [aria-label*='Google' i]").first();
    const googleVisible = await googleBtn.isVisible().catch(() => false);
    f.notes.push(`googleDriveButtonVisible=${googleVisible}`);
    if (!googleVisible) {
      f.notes.push("BROKEN: no Google Drive button surfaced in picker (Mike #3)");
    } else {
      // Click and capture error state if any
      await googleBtn.click().catch((e) => f.notes.push(`googleBtn click failed: ${(e as Error).message}`));
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(SCREENSHOTS, `2026-05-17_hub-knowledge-gdrive-clicked_desktop.png`) }).catch(() => {});
    }
    persistFinding(f);
  });

  test("Mike concern #5 — Scan QR button on /assets and /feed", async ({ page }) => {
    for (const route of ["/feed", "/assets"]) {
      const f = await gotoCapture(page, route);
      const scanBtn = page.locator("button:has-text('Scan'), a:has-text('Scan'), [aria-label*='scan' i]").first();
      const visible = await scanBtn.isVisible().catch(() => false);
      f.notes.push(`scanBtnVisible=${visible}`);

      if (visible) {
        const href = await scanBtn.getAttribute("href").catch(() => null);
        f.notes.push(`scanBtnHref=${href ?? "<button-no-href>"}`);
        await scanBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
        f.notes.push(`afterScanClickUrl=${page.url()}`);
        await page.screenshot({ path: path.join(SCREENSHOTS, `2026-05-17_hub-${route.slice(1)}-scan-clicked_desktop.png`) }).catch(() => {});
      } else {
        f.notes.push(`MISSING: Scan QR button on ${route}`);
      }
      persistFinding(f);
    }
  });
});
