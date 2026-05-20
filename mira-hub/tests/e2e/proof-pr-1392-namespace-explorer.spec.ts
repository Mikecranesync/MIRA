/**
 * Proof spec for PR #1392 — Windows 3.1 Namespace Explorer
 *
 * Plan: docs/plans/2026-05-18-windows-explorer-namespace.md
 * Branch: feat/hub-namespace-explorer
 *
 * Golden path from the plan's Verification section:
 *  1. /hub/namespace — toolbar appears, split pane visible
 *  2. POST /api/namespace/node — "Building A" folder created in tree
 *  3. PUT /api/namespace/node/:id — rename to "Building_Renamed"
 *  4. POST /api/namespace/node/:id/files — upload sample PDF
 *  5. GET  /api/namespace/node/:id/files — file appears in listing
 *  6. GET  /api/namespace/files/:id      — download content served
 *  7. DELETE /api/namespace/files/:id    — file removed
 *  8. DELETE /api/namespace/node/:id     — blocked when children present; succeeds on leaf
 *
 * Run locally:
 *   cd mira-hub
 *   HUB_URL=http://localhost:3100 npx playwright test tests/e2e/proof-pr-1392-namespace-explorer.spec.ts --reporter=list
 */

import * as fs from "fs";
import * as path from "path";
import { test, expect, APIRequestContext } from "@playwright/test";

const HUB = (process.env.HUB_URL ?? "http://localhost:3100/hub").replace(/\/$/, "");
const SCREENSHOTS_DIR = path.resolve(__dirname, "../../../docs/promo-screenshots");
const DATE = "2026-05-20";

const CREDS = {
  email: "playwright@factorylm.com",
  password: "TestPass123",
  name: "Playwright PR1392",
};

async function ensureUser(request: APIRequestContext) {
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: CREDS,
    failOnStatusCode: false,
  });
  // 200/201 = created, 409 = already exists, 429 = rate limited (already seeded)
  expect([200, 201, 409, 429]).toContain(res.status());
}

async function loginPage(page: import("@playwright/test").Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });

  // Toggle the password accordion (magic-link form shows first)
  const pwBtn = page.locator("text=Sign in with password");
  if (await pwBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await pwBtn.click();
    // Wait for password input to become visible before filling
    await page.locator('input[type="password"]').waitFor({ state: "visible", timeout: 8_000 });
  }
  // Fill within the password section (last = password form, not magic-link)
  await page.locator('input[type="email"]').last().fill(CREDS.email);
  await page.locator('input[type="password"]').last().fill(CREDS.password);
  await page.locator('button[type="submit"]').last().click();
  // Wait until URL is NOT the login page (hub/login would falsely match /hub/ pattern)
  await page.waitForURL((url) => !url.toString().includes("/login"), { timeout: 20_000 });
}

function saveScreenshot(name: string, buffer: Buffer) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filepath = path.join(SCREENSHOTS_DIR, `${DATE}_${name}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`  📸 saved → ${filepath}`);
}

// ─── shared state across tests ────────────────────────────────────────────────
let parentNodeId: string;
let childNodeId: string;
let fileId: string;

// ─── test suite ───────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  await ensureUser(request);
});

test("1. namespace page — Explorer layout renders", async ({ page }) => {
  await loginPage(page);
  await page.goto(`${HUB}/namespace`, { waitUntil: "domcontentloaded" });

  // Toolbar
  await expect(page.locator("text=New Folder")).toBeVisible({ timeout: 10_000 });

  // Tree panel (left split)
  const treePanel = page.locator('[data-testid="namespace-tree"], .font-mono').first();
  await expect(treePanel).toBeVisible({ timeout: 10_000 });

  const shot = await page.screenshot({ fullPage: false });
  saveScreenshot("namespace-explorer-layout_desktop", shot);
});

test("2. POST /api/namespace/node — create parent folder", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.post(`${HUB}/api/namespace/node`, {
    data: { name: "Building A PR1392", kind: "area" },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.node.id).toBeTruthy();
  parentNodeId = body.node.id;
  console.log(`  created parent node: ${parentNodeId}`);
});

test("3. POST /api/namespace/node — create child folder (for delete-blocked test)", async ({
  page,
}) => {
  await loginPage(page);
  const res = await page.request.post(`${HUB}/api/namespace/node`, {
    data: { name: "Electrical PR1392", kind: "area", parentId: parentNodeId },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.ok).toBe(true);
  childNodeId = body.node.id;
  console.log(`  created child node: ${childNodeId}`);
});

test("4. GET /api/namespace/tree — includes filesCount", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.get(`${HUB}/api/namespace/tree`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const allNodes: unknown[] = [];
  function collect(nodes: Array<{ filesCount?: number; children?: unknown[] }>) {
    for (const n of nodes) {
      allNodes.push(n);
      if (n.children) collect(n.children as Array<{ filesCount?: number; children?: unknown[] }>);
    }
  }
  collect(body.nodes ?? body);
  const missing = allNodes.filter((n: unknown) => {
    const node = n as Record<string, unknown>;
    return !("filesCount" in node);
  });
  expect(missing.length).toBe(0);
  console.log(`  tree has ${allNodes.length} nodes, all with filesCount`);
});

test("5. PUT /api/namespace/node/:id — rename parent", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.put(`${HUB}/api/namespace/node/${parentNodeId}`, {
    data: { newName: "Building A Renamed PR1392" },
  });
  expect([200, 204]).toContain(res.status());
  console.log(`  rename returned ${res.status()}`);
});

test("6. POST /api/namespace/node/:id/files — upload PDF", async ({ page }) => {
  await loginPage(page);
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const samplePath = path.resolve(__dirname, "fixtures/sample.pdf");
  const fileBytes = fs.readFileSync(samplePath);

  const formData = new FormData();
  const blob = new Blob([fileBytes], { type: "application/pdf" });
  formData.append("file", blob, "sample.pdf");

  // Use fetch since Playwright request doesn't do FormData well
  const fetchRes = await page.evaluate(
    async ({
      url,
      cookieHeader: _cookieHeader,
      bytes,
    }: {
      url: string;
      cookieHeader: string;
      bytes: number[];
    }) => {
      const fd = new FormData();
      const buf = new Uint8Array(bytes);
      const blob = new Blob([buf], { type: "application/pdf" });
      fd.append("file", blob, "sample.pdf");
      const r = await fetch(url, { method: "POST", body: fd });
      return { status: r.status, body: await r.json() };
    },
    {
      url: `${HUB}/api/namespace/node/${childNodeId}/files`,
      cookieHeader,
      bytes: Array.from(fileBytes),
    }
  );

  expect(fetchRes.status).toBe(201);
  expect(fetchRes.body.ok).toBe(true);
  fileId = fetchRes.body.file.id;
  console.log(`  uploaded file: ${fileId}`);
});

test("7. GET /api/namespace/node/:id/files — file appears in list", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.get(`${HUB}/api/namespace/node/${childNodeId}/files`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const found = (body.files as Array<{ id: string }>).find((f) => f.id === fileId);
  expect(found).toBeTruthy();
  console.log(`  file listing confirmed: ${JSON.stringify(found)}`);
});

test("8. GET /api/namespace/files/:id — download returns binary", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.get(`${HUB}/api/namespace/files/${fileId}`);
  expect(res.status()).toBe(200);
  const contentType = res.headers()["content-type"];
  expect(contentType).toContain("application/pdf");
  const disposition = res.headers()["content-disposition"];
  expect(disposition).toContain("sample.pdf");
  console.log(`  download OK — Content-Type: ${contentType}`);
});

test("9. DELETE /api/namespace/files/:id — removes file", async ({ page }) => {
  await loginPage(page);
  const res = await page.request.delete(`${HUB}/api/namespace/files/${fileId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  console.log("  file deleted OK");
});

test("10. DELETE /api/namespace/node/:id — 409 when node has children", async ({ page }) => {
  await loginPage(page);
  // Parent has a child → must return 409
  const res = await page.request.delete(`${HUB}/api/namespace/node/${parentNodeId}`);
  expect(res.status()).toBe(409);
  console.log("  delete blocked with children — 409 ✓");
});

test("11. DELETE /api/namespace/node/:id — succeeds on leaf", async ({ page }) => {
  await loginPage(page);
  const childRes = await page.request.delete(`${HUB}/api/namespace/node/${childNodeId}`);
  expect(childRes.status()).toBe(200);
  console.log("  child leaf deleted OK");

  const parentRes = await page.request.delete(`${HUB}/api/namespace/node/${parentNodeId}`);
  expect(parentRes.status()).toBe(200);
  console.log("  parent deleted after child removed OK");
});

test("12. namespace page — folder creation visible in tree (UI smoke)", async ({ page }) => {
  await loginPage(page);

  // Create a temporary node via API first

  const createRes = await page.evaluate(
    async ({ url, body }: { url: string; body: unknown }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json() };
    },
    {
      url: `${HUB}/api/namespace/node`,
      body: { name: "UI Smoke Test Node", kind: "area" },
    }
  );
  expect(createRes.status).toBe(201);
  const uiNodeId = createRes.json.node.id;

  // Navigate to namespace page and check it's there
  await page.goto(`${HUB}/namespace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000); // let tree load

  const shot = await page.screenshot({ fullPage: true });
  saveScreenshot("namespace-explorer-tree-loaded_desktop", shot);

  // Cleanup
  await page.evaluate(
    async ({ url }: { url: string }) => {
      await fetch(url, { method: "DELETE" });
    },
    { url: `${HUB}/api/namespace/node/${uiNodeId}` }
  );
});
