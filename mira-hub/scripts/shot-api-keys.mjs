/**
 * Standalone Playwright screenshot script for /settings/api-keys.
 *
 * Stubs GET/POST/DELETE /api/i3x-keys* so three states render
 * deterministically without a live DB or auth backend.
 *
 * Usage:
 *   node scripts/shot-api-keys.mjs
 *
 * Requirements:
 *   - A running Next.js dev server (started externally or by this script).
 *   - AUTH_SECRET env var (or falls back to a fixed test value).
 *   - NEXT_PUBLIC_BASE_PATH="" (root mount; set when starting the server).
 */

import { chromium } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(REPO_ROOT, "docs/promo-screenshots");
const HUB_PORT = 3456;
const HUB_URL = `http://localhost:${HUB_PORT}`;
const AUTH_SECRET = process.env.AUTH_SECRET ?? "Wnu1AJ1ReacoVIUCumrn8qbjvLTjDH3ehw5IwZnduUI=";

// Fake tenant/user UUIDs (valid UUID format required by sessionOr401)
const FAKE_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FAKE_USER_ID = "22222222-2222-2222-2222-222222222222";

/**
 * Mint a next-auth session JWT matching the salt="" default used in session.ts.
 */
async function mintSessionCookie() {
  const token = await encode({
    token: {
      uid: FAKE_USER_ID,
      tid: FAKE_TENANT_ID,
      email: "test@factorylm.com",
      status: "trial",
      trialExpiresAt: null,
    },
    secret: AUTH_SECRET,
    salt: "", // v4 default — matches decode() in session.ts
    maxAge: 60 * 60, // 1 hour
  });
  return token;
}

/**
 * Wait until the Next.js server is responding.
 */
async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 600) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------
const STUB_KEYS = [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    label: "Production relay",
    enabled: true,
    created_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
    last_used_at: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    label: "CI / staging",
    enabled: true,
    created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    last_used_at: null,
  },
];

const STUB_NEW_KEY = {
  key: "i3x_sk_live_EXAMPLEKEY1234567890ABCDEF",
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  label: "My new key",
  created_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Start Next.js dev server
  console.log(`[shot] Starting Next.js dev server on port ${HUB_PORT}...`);
  // Use the real next binary from the main checkout to avoid the Turbopack
  // symlink panic (node_modules in this worktree is a symlink to the main
  // checkout, which Turbopack refuses to follow). --webpack bypasses it.
  const NEXT_BIN = "/Users/charlienode/MIRA/mira-hub/node_modules/.bin/next";
  const devServer = spawn(
    NEXT_BIN,
    ["dev", "--webpack", "--port", String(HUB_PORT)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_BASE_PATH: "",
        AUTH_SECRET,
        // Minimal no-op values for env vars the server checks at startup:
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://noop:noop@localhost/noop",
        NEXTAUTH_SECRET: AUTH_SECRET,
        NEXTAUTH_URL: HUB_URL,
        // Skip DB connections that would crash startup
        SKIP_ENV_VALIDATION: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );

  devServer.stdout?.on("data", (d) => {
    const line = d.toString().trim();
    if (line) process.stdout.write(`[next] ${line}\n`);
  });
  devServer.stderr?.on("data", (d) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`[next:err] ${line}\n`);
  });

  let killed = false;
  function cleanup() {
    if (!killed) {
      killed = true;
      devServer.kill("SIGTERM");
    }
  }
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  try {
    await waitForServer(`${HUB_URL}/`);
    console.log("[shot] Server ready.");
  } catch (err) {
    console.error("[shot] Server did not start:", err);
    cleanup();
    process.exit(1);
  }

  const sessionToken = await mintSessionCookie();

  const browser = await chromium.launch({ headless: true });

  // ---------------------------------------------------------------------------
  // Helper: set up a page with auth cookie + API stubs
  // ---------------------------------------------------------------------------
  async function makePage(viewport, getStub, postStub) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([
      {
        name: "next-auth.session-token",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    const page = await ctx.newPage();

    // Strip CSP headers on HTML responses so React hydrates without nonce blockage,
    // and stub all i3x-keys API calls.
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      const isI3xKeys = /\/api\/i3x-keys/.test(url);

      if (isI3xKeys) {
        const isDelete = /\/api\/i3x-keys\//.test(url);
        if (isDelete && method === "DELETE") {
          void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deleted: true }) });
        } else if (!isDelete && method === "GET") {
          void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keys: getStub }) });
        } else if (!isDelete && method === "POST") {
          void route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(postStub ?? STUB_NEW_KEY) });
        } else {
          void route.continue();
        }
        return;
      }

      // For all other requests: strip CSP to allow React hydration
      const resp = await route.fetch().catch(() => null);
      if (!resp) { void route.continue(); return; }
      const headers = await resp.headersArray();
      const filteredHeaders = headers.filter(
        (h) => !["content-security-policy", "x-frame-options"].includes(h.name.toLowerCase()),
      );
      void route.fulfill({
        response: resp,
        headers: Object.fromEntries(filteredHeaders.map((h) => [h.name, h.value])),
      });
    });

    return { page, ctx };
  }

  const DESKTOP = { width: 1440, height: 900 };
  const MOBILE = { width: 412, height: 915 };

  // Helper: wait for the API Keys page to fully render (heading visible + loading gone)
  async function waitForPageReady(page) {
    await page.waitForSelector("h1:has-text('API Keys')", { timeout: 20_000 });
    // Wait for loading to disappear — the stub will have fired and React re-rendered
    await page.waitForSelector("text=Loading…", { state: "hidden", timeout: 15_000 }).catch(() => {});
    // Extra buffer for React batch updates
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // 1. Empty state
  // ---------------------------------------------------------------------------
  console.log("[shot] Capturing: empty state...");
  for (const [vpName, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
    const { page, ctx } = await makePage(vp, [], null);
    await page.goto(`${HUB_URL}/settings/api-keys/`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    const found = await page.waitForSelector("text=No API keys yet", { timeout: 5_000 }).catch(() => null);
    if (!found) console.warn(`[shot] 'No API keys yet' not found on ${vpName} empty state`);
    const file = path.join(OUT_DIR, `2026-06-16_settings-api-keys-empty_${vpName}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[shot] Saved: ${path.relative(REPO_ROOT, file)}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------------------
  // 2. Reveal state (show key after create)
  // ---------------------------------------------------------------------------
  console.log("[shot] Capturing: reveal state...");
  for (const [vpName, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
    const { page, ctx } = await makePage(vp, [], STUB_NEW_KEY);
    await page.goto(`${HUB_URL}/settings/api-keys/`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    // Page is ready — fill label + click Create
    await page.fill('input[placeholder*="Label"]', "My new key");
    await page.click('button:has-text("Create key")');
    const revealed = await page.waitForSelector("text=Copy this key now", { timeout: 10_000 }).catch(() => null);
    if (!revealed) console.warn(`[shot] Reveal panel not visible on ${vpName}`);
    const file = path.join(OUT_DIR, `2026-06-16_settings-api-keys-reveal_${vpName}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[shot] Saved: ${path.relative(REPO_ROOT, file)}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------------------
  // 3. List state (2 keys)
  // ---------------------------------------------------------------------------
  console.log("[shot] Capturing: list state...");
  for (const [vpName, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
    const { page, ctx } = await makePage(vp, STUB_KEYS, null);
    await page.goto(`${HUB_URL}/settings/api-keys/`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    const found = await page.waitForSelector("text=Production relay", { timeout: 5_000 }).catch(() => null);
    if (!found) console.warn(`[shot] Key list not visible on ${vpName}`);
    const file = path.join(OUT_DIR, `2026-06-16_settings-api-keys-list_${vpName}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[shot] Saved: ${path.relative(REPO_ROOT, file)}`);
    await ctx.close();
  }

  await browser.close();
  cleanup();
  console.log("[shot] Done.");
}

main().catch((err) => {
  console.error("[shot] Fatal:", err);
  process.exit(1);
});
