/**
 * Full E2E proof for streaming ingest-v2 (PR #1935) — login + UPLOAD SCREEN +
 * AI-written cited answer, repeated for N monitored runs.
 *
 * Unlike folder-upload-citation-proof.spec.ts (uploads via the API route), this
 * drives the REAL upload screen (`[data-testid="namespace-file-input"]`, which
 * the page wires to POST /api/namespace/node/:id/files for the selected node),
 * then asks via the real Ask-MIRA UI and asserts a citation chip from the LIVE
 * cascade (Groq→Cerebras; Gemini is blocked per CLAUDE.md).
 *
 * RUN UNDER THE STANDALONE BUILD (not `next dev`) so it tests the deployed shape
 * and can catch the #1899-class unpdf-bundling 500:
 *
 *   cd mira-hub && doppler run -p factorylm -c dev -- bash -lc 'next build && next start -p 3017'   # terminal A
 *   HUB_URL=http://localhost:3017 doppler run -p factorylm -c dev -- \
 *     npx playwright test tests/e2e/ingest-v2-e2e-5run.spec.ts --config playwright.config.ts   # terminal B
 *
 * NEON_DATABASE_URL must point at the SAME db the hub uses (dev — NEVER prod).
 * Each run uses a fresh registered tenant + nodes, cleaned in a per-run finally;
 * a final sweep removes anything a mid-run crash stranded (by email/mark prefix).
 * Results are written to tests/e2e/.artifacts/ingest-v2-e2e-results.json for the
 * runbook (docs/runbooks/ingest-v2-verify-and-benchmark.md).
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3017").replace(/\/$/, "");
const RUNS = Number(process.env.E2E_RUNS ?? "5");
const FIXTURE = path.join(__dirname, "fixtures", "zephyr-zx9000-service-manual.pdf");
const FIXTURE_NAME = "zephyr-zx9000-service-manual.pdf";
const QUESTION = "My press throws fault ZX-451 — what is the cause and fix?";
const EMAIL_PREFIX = "pw-e2e-v2";
const MARK_PREFIX = "e2e_v2_";
const ARTIFACT_DIR = path.join(__dirname, ".artifacts");
const RESULTS_FILE = path.join(ARTIFACT_DIR, "ingest-v2-e2e-results.json");

// A refusal/ungrounded answer looks like one of these; the deterministic signal
// is still the citation chip — this only flags "answered but didn't ground".
const REFUSAL_HINTS = [
  "i don't have", "i do not have", "no information", "couldn't find", "could not find",
  "not able to find", "nothing attached", "no documents", "don't have access",
];
const looksLikeRefusal = (s: string) =>
  REFUSAL_HINTS.some((h) => s.toLowerCase().includes(h));

type RunResult = {
  run: number;
  verdict: "PASS" | "PROVIDER_FLAKE" | "PATH_FAIL";
  uploadChunks: number | null;
  uploadMs: number | null;
  chip: boolean;
  answerMs: number | null;
  chatStatus: number | null;
  answerSnippet: string;
  note: string;
};
const RESULTS: RunResult[] = [];

const db = () =>
  new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function register(creds: { email: string; password: string; name: string }): Promise<string> {
  const res = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
    redirect: "manual",
  });
  const json = (await res.json().catch(() => ({}))) as { tenantId?: string };
  if (res.status !== 201 || !json.tenantId) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.tenantId;
}

async function signInCookies(creds: { email: string; password: string }) {
  const csrfRes = await fetch(`${HUB}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const setCookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const form = new URLSearchParams();
  form.set("email", creds.email);
  form.set("password", creds.password);
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
  expect(cookies.find((c) => c.name.includes("next-auth.session-token")), "no session cookie").toBeTruthy();
  return cookies;
}

async function seedNodes(tenantId: string, mark: string, root: string, lineId: string, pressId: string) {
  const c = db();
  await c.connect();
  try {
    const ent = (id: string, type: string, name: string, p: string) =>
      c.query(
        `INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, uns_path, properties)
         VALUES ($1,$2,$3,$4,$5,$6::ltree,$7)`,
        [id, tenantId, type, `${mark}_${name}`, name, p, JSON.stringify({ mark })],
      );
    await ent(lineId, "line", "Press Line", root);
    await ent(pressId, "asset", "ZX-9000 Press", `${root}.zx_9000`);
  } finally {
    await c.end();
  }
}

async function chunkCountForNode(pressId: string): Promise<number> {
  const c = db();
  await c.connect();
  try {
    const r = await c.query(
      `select count(*)::int n from knowledge_entries where metadata->>'node_id'=$1 and ingest_route='v2'`,
      [pressId],
    );
    return r.rows[0].n as number;
  } finally {
    await c.end();
  }
}

async function cleanupTenant(tenantId: string, mark: string) {
  if (!tenantId) return;
  const c = db();
  await c.connect();
  try {
    await c.query(
      `delete from knowledge_entries where metadata->>'node_id' in
         (select id::text from kg_entities where properties->>'mark'=$1)`, [mark]);
    await c.query(
      `delete from hub_uploads where kg_entity_id in
         (select id from kg_entities where properties->>'mark'=$1)`, [mark]);
    await c.query(`delete from kg_entities where properties->>'mark'=$1`, [mark]);
    await c.query(`delete from tenants where id=$1`, [tenantId]);
  } finally {
    await c.end();
  }
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

for (let run = 1; run <= RUNS; run++) {
  test(`run ${run}/${RUNS}: login → upload screen → cited answer`, async ({ browser }) => {
    const suffix = `${Date.now().toString(36)}r${run}`;
    const creds = { email: `${EMAIL_PREFIX}-${suffix}@factorylm.com`, password: "TestPass123!", name: "E2E v2" };
    const mark = `${MARK_PREFIX}${suffix}`;
    const root = `e2e_${suffix}`;
    const lineId = randomUUID();
    const pressId = randomUUID();
    const result: RunResult = {
      run, verdict: "PATH_FAIL", uploadChunks: null, uploadMs: null,
      chip: false, answerMs: null, chatStatus: null, answerSnippet: "", note: "",
    };
    let tenantId = "";
    let ctx: BrowserContext | null = null;
    try {
      tenantId = await register(creds);
      await seedNodes(tenantId, mark, root, lineId, pressId);
      const cookies = await signInCookies(creds);

      ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      let chatStatus: number | null = null;
      page.on("response", (r) => {
        if (r.url().includes(`/node/${pressId}/chat`) || r.url().match(/\/node\/[^/]+\/chat/)) {
          chatStatus = r.status();
        }
      });

      // --- UPLOAD via the real screen ---
      await page.goto(`${HUB}/namespace`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(page.locator('[data-testid="namespace-page"]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-testid="namespace-node"]', { hasText: "Press Line" }).first().click();
      const press = page.getByRole("button", { name: "ZX-9000 Press" }).first();
      await expect(press).toBeVisible({ timeout: 10_000 });
      await press.click();

      const tUp = Date.now();
      await page.locator('[data-testid="namespace-file-input"]').setInputFiles(FIXTURE);
      // poll the DB for v2 chunks on the selected node (upload is async/parsing)
      let chunks = 0;
      for (let i = 0; i < 45 && chunks === 0; i++) {
        await page.waitForTimeout(2000);
        chunks = await chunkCountForNode(pressId);
      }
      result.uploadMs = Date.now() - tUp;
      result.uploadChunks = chunks;
      if (chunks === 0) {
        result.verdict = "PATH_FAIL";
        result.note = "upload screen produced no v2 chunks (possible #1899-class standalone 500 — check server log)";
        throw new Error(result.note);
      }

      // --- ASK via the real Ask-MIRA UI ---
      await page.locator('[data-testid="namespace-ask-mira"]').click();
      const input = page.locator('textarea[placeholder*="this folder"]');
      await expect(input).toBeVisible({ timeout: 10_000 });
      await input.fill(QUESTION);
      const tAsk = Date.now();
      await input.press("Enter");

      // Deterministic grounding signal: citation chip for the uploaded manual.
      try {
        await expect(page.getByText(FIXTURE_NAME).first()).toBeVisible({ timeout: 60_000 });
        result.chip = true;
      } catch {
        result.chip = false;
      }
      result.answerMs = Date.now() - tAsk;
      result.chatStatus = chatStatus;

      // Capture the assistant prose (don't assert its words). The assistant bubble
      // is the streamed `.whitespace-pre-wrap` block in NodeChat (no test-id).
      const answerText = await page
        .locator(".whitespace-pre-wrap")
        .last()
        .innerText()
        .catch(() => "");
      result.answerSnippet = answerText.replace(/\s+/g, " ").slice(0, 220);

      // Classify: chip = grounded path works. No chip + chat 5xx/0 = provider flake,
      // not a path failure. No chip + chat 200 + refusal = path/grounding failure.
      if (result.chip && result.answerSnippet.length > 0) {
        result.verdict = "PASS";
      } else if (chatStatus != null && chatStatus >= 500) {
        result.verdict = "PROVIDER_FLAKE";
        result.note = `chat returned ${chatStatus} (Groq/Cerebras upstream) — infra flake, not ingest-path`;
      } else if (!result.chip && looksLikeRefusal(result.answerSnippet)) {
        result.verdict = "PATH_FAIL";
        result.note = "answered but did not cite the uploaded manual (grounding gap)";
      } else {
        result.verdict = "PROVIDER_FLAKE";
        result.note = `no chip; chatStatus=${chatStatus}; answer="${result.answerSnippet.slice(0, 80)}"`;
      }

      const shot = path.join(ARTIFACT_DIR, `run-${run}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

      // The hard assertions for THIS run (a flake won't fail the suite-as-a-whole
      // because each run is its own test()).
      expect(result.uploadChunks, "upload screen → v2 chunks").toBeGreaterThan(0);
      expect(result.chip, `no citation chip (verdict=${result.verdict}, ${result.note})`).toBe(true);
    } finally {
      RESULTS.push(result);
      if (ctx) await ctx.close();
      await cleanupTenant(tenantId, mark).catch(() => {});
    }
  });
}

test.afterAll(async () => {
  // Final sweep: remove anything a mid-run crash stranded.
  const c = db();
  await c.connect();
  try {
    await c.query(
      `delete from knowledge_entries where metadata->>'node_id' in
         (select id::text from kg_entities where (properties->>'mark') like $1)`, [`${MARK_PREFIX}%`]);
    await c.query(
      `delete from hub_uploads where kg_entity_id in
         (select id from kg_entities where (properties->>'mark') like $1)`, [`${MARK_PREFIX}%`]);
    await c.query(`delete from kg_entities where (properties->>'mark') like $1`, [`${MARK_PREFIX}%`]);
    await c.query(`delete from tenants where contact_email like $1`, [`${EMAIL_PREFIX}-%`]);
  } finally {
    await c.end();
  }
  if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(RESULTS, null, 2));
  const pass = RESULTS.filter((r) => r.verdict === "PASS").length;
  const flake = RESULTS.filter((r) => r.verdict === "PROVIDER_FLAKE").length;
  const fail = RESULTS.filter((r) => r.verdict === "PATH_FAIL").length;
  console.log(`\n=== INGEST-V2 E2E: ${pass} PASS / ${flake} PROVIDER_FLAKE / ${fail} PATH_FAIL (of ${RESULTS.length}) ===`);
  for (const r of RESULTS) {
    console.log(`run ${r.run}: ${r.verdict} | chunks=${r.uploadChunks} uploadMs=${r.uploadMs} chip=${r.chip} answerMs=${r.answerMs} chat=${r.chatStatus} ${r.note}`);
    if (r.answerSnippet) console.log(`   answer: ${r.answerSnippet}`);
  }
});
