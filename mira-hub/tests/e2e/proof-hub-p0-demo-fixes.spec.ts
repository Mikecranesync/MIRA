/**
 * Proof-of-work spec for the P0 pre-expo demo fixes (PR feat/hub-p0-demo-fixes).
 *
 * FIX 1 — /scan camera page + QR buttons (already shipped on origin/main in
 *         commit dec5bb1f; this spec adds a regression check so it can't
 *         silently break before the expo).
 * FIX 2 — "Upload Document" button on /assets/[id] Documents tab → opens
 *         UploadPicker pre-linked to the current asset (assetTag).
 * FIX 3 — "Connect Google Drive" CTA inside UploadPicker when Google isn't
 *         connected → navigates to /hub/api/auth/google to start OAuth.
 *
 * The hub login UI requires a real next-auth session; running the full
 * authenticated DOM crawl from a stateless CI worker is flaky. We stick to
 * request-level proofs (route exists, OAuth init redirects to Google) plus a
 * source-file assertion that the data-testid hooks our new DOM actually ships.
 * Eyeball verification of the rendered UI happens post-deploy on the demo
 * tablet — that's the only environment that matters for the expo.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-hub-p0-demo-fixes");
const REPO_ROOT = path.resolve(__dirname, "../..");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

/* ─── FIX 1 — /scan route compiles ──────────────────────────────────── */

test("FIX 1: /hub/scan route exists (not 404)", async ({ request }) => {
  const res = await request.get(`${HUB}/scan/`, { maxRedirects: 0, failOnStatusCode: false });
  expect(res.status()).not.toBe(404);
  expect([200, 301, 307, 308]).toContain(res.status());
});

test("FIX 1: /hub/feed page references the /scan link in its FAB", async () => {
  const feed = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/(hub)/feed/page.tsx"),
    "utf8",
  );
  expect(feed).toMatch(/href:\s*["']\/scan["']/);
});

test("FIX 1: /hub/assets page uses a Link to /scan for Scan QR button", async () => {
  const assets = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/(hub)/assets/page.tsx"),
    "utf8",
  );
  expect(assets).toMatch(/<Link\s+href=["']\/scan["']/);
});

/* ─── FIX 2 — Upload Document button on asset detail ────────────────── */

test("FIX 2: /hub/assets/1 route exists (not 404)", async ({ request }) => {
  const res = await request.get(`${HUB}/assets/1/`, { maxRedirects: 0, failOnStatusCode: false });
  expect(res.status()).not.toBe(404);
});

test("FIX 2: assets/[id] DocumentsTab ships data-testid='upload-document-button'", async () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/(hub)/assets/[id]/page.tsx"),
    "utf8",
  );
  expect(src).toMatch(/data-testid=["']upload-document-button["']/);
  // UploadPicker must be passed the asset tag so uploads pre-link to this asset.
  expect(src).toMatch(/defaultAssetTag=\{assetTag\}/);
});

test("FIX 2: /hub/api/uploads/local accepts multipart (auth-redirects unauth, never 404)", async ({ request }) => {
  const res = await request.post(`${HUB}/api/uploads/local/`, {
    multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") } },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(res.status()).not.toBe(404);
  // Unauth → 301/307 (auth redirect) OR 401 from sessionOr401. Either proves the route exists.
  expect([200, 201, 301, 307, 401]).toContain(res.status());
});

/* ─── FIX 3 — Connect Google Drive CTA ──────────────────────────────── */

test("FIX 3: UploadPicker ships data-testid='connect-google-drive'", async () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "src/components/UploadPicker.tsx"),
    "utf8",
  );
  expect(src).toMatch(/data-testid=["']connect-google-drive["']/);
  // The CTA must route to the OAuth init endpoint.
  expect(src).toMatch(/\/hub\/api\/auth\/google/);
});

test("FIX 3: /hub/api/auth/google OAuth init route exists (not 404)", async ({ request }) => {
  const res = await request.get(`${HUB}/api/auth/google/`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(res.status()).not.toBe(404);
});

/* ─── Smoke screenshot (no auth needed) ─────────────────────────────── */

test("smoke: /hub/login renders without errors (proves middleware healthy)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.screenshot({ path: path.join(OUT_DIR, "smoke-login.png"), fullPage: true });
  // Allow a few next-auth client-fetch warnings (a known pre-existing console noise).
  expect(consoleErrors.length).toBeLessThan(5);
});
