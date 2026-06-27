#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadPlaywright } from '../tools/qa/lib.mjs';

const { chromium } = loadPlaywright();

const REPO_ROOT = resolve(process.cwd());
const AUTH_STATE = join(REPO_ROOT, 'dogfood-output', '.auth', 'app-state.json');
const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error('usage: node dogfood-output/qa-login-save-state.mjs <email> <password>');
  process.exit(2);
}
mkdirSync(dirname(AUTH_STATE), { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleMsgs = [];
page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
function isLoginUrl(url) {
  return new URL(url).pathname.replace(/\/+$/, '') === '/login';
}
try {
  await page.goto('https://app.factorylm.com/login/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Let the login form hydrate before interacting; clicking the toggle too early
  // leaves the form in magic-link mode and the password field never renders
  // (see dogfood-output/QA_SETUP_REPORT.md "Hydration timing can overwrite fast scripted fills").
  await page.waitForTimeout(2000);
  const toggle = page.getByRole('button', { name: /sign in with password/i });
  if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) await toggle.click();
  const pwField = page.locator('input[type="password"]');
  await pwField.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(800);
  await page.locator('input[type="email"]').last().fill(email);
  await pwField.fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // A fresh account with no namespace lands on /onboarding/ — include it, else a
  // successful login reads as a timeout.
  await page.waitForURL(/\/(feed|namespace|hub|command-center|onboarding)\/?|app\.factorylm\.com\/$/, { timeout: 30000 }).catch(async () => {
    await page.waitForTimeout(5000);
  });
  await page.screenshot({ path: join(REPO_ROOT, 'dogfood-output', 'auth-state-screenshot.png'), fullPage: true });
  const state = await ctx.storageState({ path: AUTH_STATE });
  const hasSessionToken = state.cookies.some(c => c.name.includes('session-token'));
  const landedUrl = page.url();
  if (!hasSessionToken || isLoginUrl(landedUrl)) {
    console.log(JSON.stringify({
      ok: false,
      error: 'login did not produce a NextAuth session-token cookie or remained on /login',
      url: landedUrl,
      authState: AUTH_STATE,
      hasSessionToken,
      consoleMsgs,
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, landed: landedUrl, authState: AUTH_STATE, hasSessionToken, consoleMsgs }, null, 2));
} catch (e) {
  await page.screenshot({ path: join(REPO_ROOT, 'dogfood-output', 'auth-state-error.png'), fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e), url: page.url(), consoleMsgs }, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
