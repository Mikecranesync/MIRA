/**
 * Global setup for the laptop->cloud E2E.
 *
 *  1. Spawns the offline contextualizer (its own venv python) headless, reads the
 *     OS-assigned port it prints, and records {url, pid} to .state/offline.json so
 *     the spec + teardown can find it.
 *  2. Mints a Hub session via the existing credentials fixture and saves it to
 *     .state/hub.json (storageState) — no Google OAuth.
 */
import { chromium, request as playwrightRequest, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HUB_URL, STORAGE_STATE_PATH } from "./fixtures/auth";

// Shared approved test account (registration is rate-limited 5/hour per IP, so a
// fresh account per run is not viable; the account is already onboarded + trial-valid).
// The run stays repeatable because B1 makes a NEW project each time and B3 asserts the
// verified-in-KG state idempotently (kg_entities dedup by tag within the tenant).
const RUN_EMAIL = process.env.E2E_HUB_EMAIL ?? "playwright@factorylm.com";
const RUN_PASSWORD = process.env.E2E_HUB_PASSWORD ?? "TestPass123";

async function registerFresh(): Promise<void> {
  const api = await playwrightRequest.newContext();
  const res = await api.post(`${HUB_URL}/api/auth/register/`, {
    data: { email: RUN_EMAIL, password: RUN_PASSWORD, name: "E2E Laptop->Cloud" },
    failOnStatusCode: false,
  });
  // 201 new / 409 exists / 429 rate-limited are all fine — the account already exists.
  if (res.status() >= 500) throw new Error(`register returned ${res.status()}: ${await res.text()}`);
  await api.dispose();
}

async function loginFresh(page: Page): Promise<void> {
  await page.goto(`${HUB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.click("text=Sign in with password");
  await page.locator('input[type="email"]').last().fill(RUN_EMAIL);
  await page.fill('input[type="password"]', RUN_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  // A fresh trial account may land on /feed or /onboarding — accept any move off /login.
  await page.waitForURL((u) => !/\/login\b/.test(u.toString()), { timeout: 30_000 });
}

const STATE_DIR = path.join(__dirname, ".state");
const OFFLINE_STATE = path.join(STATE_DIR, "offline.json");

// Repo root is two levels up from mira-hub/tests/e2e -> mira-hub -> <repo>.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CTX_ROOT =
  process.env.MIRA_CTX_ROOT ??
  "C:/Users/hharp/Documents/MIRA-pr2068/mira-contextualizer";
const VENV_PY =
  process.env.MIRA_CTX_PYTHON ?? path.join(CTX_ROOT, ".venv/Scripts/python.exe");
const LAUNCHER = path.join(REPO_ROOT, "tools/e2e/launch_contextualizer.py");

function spawnOfflineApp(): Promise<{ url: string; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(VENV_PY, [LAUNCHER], {
      env: { ...process.env, MIRA_CTX_ROOT: CTX_ROOT },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("offline app did not print PORT within 20s")), 20_000);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.unref(); // let it outlive globalSetup; teardown kills it by pid
        resolve({ url: `http://127.0.0.1:${m[1]}`, pid: child.pid! });
      }
    });
    child.stderr.on("data", (d: Buffer) => process.stderr.write(`[offline] ${d}`));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => { if (code) reject(new Error(`offline app exited ${code}`)); });
  });
}

export default async function globalSetup() {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // 1) Offline app
  const offline = await spawnOfflineApp();
  fs.writeFileSync(OFFLINE_STATE, JSON.stringify(offline, null, 2));
  console.log(`[setup] offline contextualizer up at ${offline.url} (pid ${offline.pid})`);

  // 2) Fresh Hub tenant -> storageState
  await registerFresh();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await loginFresh(page);
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
  console.log(`[setup] hub session ${RUN_EMAIL} -> ${STORAGE_STATE_PATH}`);
}
