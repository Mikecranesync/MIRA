/**
 * #1899 beta-gate proof — the REAL folder=brain upload path, end to end.
 *
 * Unlike folder-brain-proof.spec.ts (which direct-SEEDS knowledge_entries and so
 * never exercises the upload route that 500'd), this spec drives the actual
 * `POST /api/namespace/node/[id]/files` door with a real PDF, asserts it returns
 * 201 + chunkCount > 0, then asks MIRA at that node and asserts a citation chip
 * for the uploaded manual. This is the "stranger uploads their own manual → gets
 * a cited answer" beta gate, run against a real surface.
 *
 *   HUB_URL=http://localhost:3007 doppler run -p factorylm -c dev -- \
 *     npx playwright test tests/e2e/folder-upload-citation-proof.spec.ts
 *
 * Point HUB_URL at a `next build && next start` (standalone) server or a deployed
 * surface to ALSO catch the unpdf/standalone-bundling regression (#1899 root
 * cause) — `next dev` resolves unpdf from node_modules and will not reproduce it.
 * NEON_DATABASE_URL must point at the SAME DB the target hub uses (dev/staging,
 * never prod). Fixture is cleaned up in afterAll.
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3007").replace(/\/$/, "");
const SUFFIX = Math.random().toString(36).slice(2, 8);
const CREDS = {
  email: `playwright-up-${SUFFIX}@factorylm.com`,
  password: "TestPass123!",
  name: "Folder Upload Proof",
};
const MARK = `up_proof_${SUFFIX}`;
const ROOT = `upproof_${SUFFIX}`;
const FIXTURE = path.join(__dirname, "fixtures", "zephyr-zx9000-service-manual.pdf");
const SHOT_DIR = path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");

let tenantId = "";
const ids = { line: randomUUID(), press: randomUUID() };
let cookieHeader = "";

async function register(): Promise<string> {
  const res = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDS),
    redirect: "manual",
  });
  const json = (await res.json().catch(() => ({}))) as { tenantId?: string };
  if (res.status !== 201 || !json.tenantId) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.tenantId;
}

async function apiSignIn() {
  const csrfRes = await fetch(`${HUB}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const setCookie1 = csrfRes.headers.get("set-cookie") ?? "";

  const form = new URLSearchParams();
  form.set("email", CREDS.email);
  form.set("password", CREDS.password);
  form.set("csrfToken", csrfToken);
  form.set("redirect", "false");
  form.set("json", "true");
  form.set("callbackUrl", HUB);

  const signInRes = await fetch(`${HUB}/api/auth/callback/credentials/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: setCookie1 },
    body: form.toString(),
    redirect: "manual",
  });
  expect([200, 302]).toContain(signInRes.status);

  const raw = [setCookie1, signInRes.headers.get("set-cookie") ?? ""].join(", ");
  const { hostname } = new URL(HUB);
  const cookies = raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .map((c) => {
      const eq = c.indexOf("=");
      return { name: c.slice(0, eq), value: c.slice(eq + 1), domain: hostname, path: "/" };
    });
  const session = cookies.find((c) => c.name.includes("next-auth.session-token"));
  expect(session, "no session cookie from credentials signin").toBeTruthy();
  cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return cookies;
}

async function seedNodesOnly() {
  const client = new Client({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO tenants (id, name, contact_email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, MARK, CREDS.email],
    );
    const ent = (id: string, type: string, name: string, p: string) =>
      client.query(
        `INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, uns_path, properties)
         VALUES ($1,$2,$3,$4,$5,$6::ltree,$7)`,
        [id, tenantId, type, `${MARK}_${name}`, name, p, JSON.stringify({ mark: MARK })],
      );
    await ent(ids.line, "line", "Press Line", `${ROOT}`);
    await ent(ids.press, "asset", "ZX-9000 Press", `${ROOT}.zx_9000`);
    // NO knowledge_entries seeded — the upload route must create them.
  } finally {
    await client.end();
  }
}

async function cleanup() {
  if (!tenantId) return;
  const client = new Client({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(`DELETE FROM knowledge_entries WHERE metadata->>'node_id' = $1`, [ids.press]);
    await client.query(`DELETE FROM hub_uploads WHERE kg_entity_id = $1`, [ids.press]);
    await client.query(`DELETE FROM kg_entities WHERE properties->>'mark' = $1`, [MARK]);
    await client.query(`DELETE FROM tenants WHERE id = $1 AND name = $2`, [tenantId, MARK]);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  expect(fs.existsSync(FIXTURE), `fixture missing: ${FIXTURE}`).toBeTruthy();
  tenantId = await register();
  await seedNodesOnly();
  await apiSignIn();
});

test.afterAll(async () => {
  await cleanup();
});

test("upload route returns 201 + chunks (the #1899 500 is gone)", async () => {
  const bytes = fs.readFileSync(FIXTURE);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), "zephyr-zx9000-service-manual.pdf");

  const res = await fetch(`${HUB}/api/namespace/node/${ids.press}/files`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: fd,
    redirect: "manual",
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; indexed?: boolean; chunkCount?: number; error?: string;
  };
  // The exact failure #1899 reported: a 500 here. Assert the door now succeeds.
  expect(res.status, `upload 500'd: ${JSON.stringify(body)}`).toBe(201);
  expect(body.indexed).toBe(true);
  expect(body.chunkCount ?? 0).toBeGreaterThan(0);
});

test("Ask MIRA at the node cites the uploaded manual", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await ctx.addCookies(await apiSignIn());
    await page.goto(`${HUB}/namespace`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.locator('[data-testid="namespace-page"]')).toBeVisible({ timeout: 30_000 });

    await page.locator('[data-testid="namespace-node"]', { hasText: "Press Line" }).first().click();
    const press = page.getByRole("button", { name: "ZX-9000 Press" }).first();
    await expect(press).toBeVisible({ timeout: 10_000 });
    await press.click();

    await page.locator('[data-testid="namespace-ask-mira"]').click();
    const input = page.locator('textarea[placeholder*="this folder"]');
    await expect(input).toBeVisible();
    await input.fill("My press throws fault ZX-451 — what is the cause and fix?");
    await input.press("Enter");

    // Citation chip for the uploaded manual proves the upload became citable.
    await expect(
      page.getByText("zephyr-zx9000-service-manual.pdf").first(),
    ).toBeVisible({ timeout: 45_000 });

    await page.waitForTimeout(2000);
    const shot = path.join(SHOT_DIR, "2026-06-12_folder-upload-citation_desktop.png");
    await page.screenshot({ path: shot, fullPage: false });
    expect(fs.existsSync(shot)).toBeTruthy();
  } finally {
    await ctx.close();
  }
});
