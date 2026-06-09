/**
 * Playwright proof — folder=brain end-to-end: Ask MIRA at a namespace node and
 * get a streamed, citation-chipped answer grounded in a document attached to a
 * node BENEATH it (subtree retrieval).
 *
 * Runs against a LOCAL dev server on the feature branch (never prod):
 *   PORT=3007; doppler run -p factorylm -c dev -- env \
 *     NEXTAUTH_URL=http://localhost:$PORT NEXT_PUBLIC_API_BASE= PORT=$PORT \
 *     npx next dev -p $PORT          # (started separately, in background)
 *   HUB_URL=http://localhost:3007 doppler run -p factorylm -c dev -- \
 *     npx playwright test tests/e2e/folder-brain-proof.spec.ts
 *
 * Fixture is direct-seeded (owner connection) under a freshly-registered tenant,
 * then read back through the real RLS path by the page. Cleaned up in afterAll.
 *
 * Spec: docs/specs/uns-node-centric-knowledge-spec.md §8 ("the demo").
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3007").replace(/\/$/, "");
const SUFFIX = Math.random().toString(36).slice(2, 8);
const CREDS = {
  email: `playwright-fb-${SUFFIX}@factorylm.com`,
  password: "TestPass123!",
  name: "Folder Brain Proof",
};
const MARK = `fb_proof_${SUFFIX}`;
const ROOT = `fbproof_${SUFFIX}`; // ltree-safe root segment

let tenantId = "";
const ids = {
  line: randomUUID(),
  cv: randomUUID(),
  gs10: randomUUID(),
  m101: randomUUID(),
};

const SHOT_DIR = path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");

async function api(method: string, p: string, body?: unknown, form = false) {
  const headers: Record<string, string> = {};
  let data: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = form ? "application/x-www-form-urlencoded" : "application/json";
    data = form ? (body as URLSearchParams).toString() : JSON.stringify(body);
  }
  return fetch(`${HUB}${p}`, { method, headers, body: data, redirect: "manual" });
}

async function register(): Promise<string> {
  const res = await api("POST", "/api/auth/register/", CREDS);
  const json = (await res.json().catch(() => ({}))) as { tenantId?: string };
  if (res.status !== 201 || !json.tenantId) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.tenantId;
}

// NextAuth credentials sign-in via API; returns the cookies to inject into the browser.
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

  // Collect Set-Cookie from both responses → Playwright cookie objects on localhost.
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
  return cookies;
}

async function seedFixture() {
  const client = new Client({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    // register() created the tenant on the AUTH side (hub_tenants, TEXT id). The
    // data-side knowledge_entries.tenant_id FKs to `tenants` (UUID) — mirror the
    // id there so chunk inserts satisfy the FK. Cleaned up in afterAll.
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
    await ent(ids.line, "line", "Conveyor Demo Line", `${ROOT}`);
    await ent(ids.cv, "asset", "CV-101", `${ROOT}.cv_101`);
    await ent(ids.gs10, "component", "GS10 VFD", `${ROOT}.cv_101.gs10`);
    await ent(ids.m101, "component", "M101 Motor", `${ROOT}.cv_101.m101`);

    const chunk = (nodeId: string, filename: string, content: string) =>
      client.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, source_type, content, source_url, source_page, doc_id, ingest_route, page_start, page_end, metadata)
         VALUES ($1,$2,'node_attachment',$3,$4,$5,$6,'v2',$5,$5,$7)`,
        [
          randomUUID(), tenantId, content,
          `node-doc/${MARK}/${filename}`, 12, randomUUID(),
          JSON.stringify({ filename, node_id: nodeId, chunk_index: 0, mark: MARK }),
        ],
      );
    await chunk(
      ids.gs10,
      "GS10_manual.pdf",
      "GS10 drive fault F0004 indicates a DC bus undervoltage condition. The drive trips when the DC bus voltage falls below the P09.03 threshold. Check the incoming supply voltage and the DC bus capacitors, then reset the fault once nominal voltage is restored.",
    );
    await chunk(
      ids.m101,
      "M101_motor_datasheet.pdf",
      "The M101 conveyor motor requires bearing lubrication every 2000 operating hours. Use lithium-based grease and do not over-pack the bearing housing.",
    );
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
    await client.query(`DELETE FROM knowledge_entries WHERE metadata->>'mark' = $1`, [MARK]);
    await client.query(`DELETE FROM kg_entities WHERE properties->>'mark' = $1`, [MARK]);
    await client.query(`DELETE FROM tenants WHERE id = $1 AND name = $2`, [tenantId, MARK]);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  tenantId = await register();
  await seedFixture();
});

test.afterAll(async () => {
  await cleanup();
});

async function driveAskMira(page: import("@playwright/test").Page) {
  await page.goto(`${HUB}/namespace`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator('[data-testid="namespace-page"]')).toBeVisible({ timeout: 30_000 });

  // Select the root line, then click CV-101 — it renders as a child folder in the
  // content panel's Folders grid.
  await page.locator('[data-testid="namespace-node"]', { hasText: "Conveyor Demo Line" }).first().click();
  const cv = page.getByRole("button", { name: "CV-101" }).first();
  await expect(cv).toBeVisible({ timeout: 10_000 });
  await cv.click();

  // Open the node chat.
  await page.locator('[data-testid="namespace-ask-mira"]').click();
  const input = page.locator('textarea[placeholder*="this folder"]');
  await expect(input).toBeVisible();

  await input.fill("What is fault F0004?");
  await input.press("Enter");

  // The streamed answer + the GS10 citation chip prove subtree grounding.
  await expect(page.getByText("GS10_manual.pdf").first()).toBeVisible({ timeout: 45_000 });
}

test("desktop — Ask MIRA at CV-101 cites the GS10 manual from the subtree", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await ctx.addCookies(await apiSignIn());
    await driveAskMira(page);
    // Let the answer finish streaming for a clean shot.
    await page.waitForTimeout(2500);
    const shot = path.join(SHOT_DIR, "2026-05-29_folder-brain-node-ask-mira_desktop.png");
    await page.screenshot({ path: shot, fullPage: false });
    expect(fs.existsSync(shot)).toBeTruthy();
  } finally {
    await ctx.close();
  }
});

test("mobile — Ask MIRA at CV-101 (phone viewport)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await ctx.addCookies(await apiSignIn());
    await driveAskMira(page);
    await page.waitForTimeout(2500);
    const shot = path.join(SHOT_DIR, "2026-05-29_folder-brain-node-ask-mira_mobile.png");
    await page.screenshot({ path: shot, fullPage: false });
    expect(fs.existsSync(shot)).toBeTruthy();
  } finally {
    await ctx.close();
  }
});
