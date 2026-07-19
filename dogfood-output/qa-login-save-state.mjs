#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadPlaywright } from '../tools/qa/lib.mjs';

const { chromium } = loadPlaywright();

const REPO_ROOT = resolve(process.cwd());

// Base URL of the target Hub. Defaults to prod for back-compat; set QA_BASE_URL
// to point the helper at staging (e.g. http://localhost:4101 over an SSH tunnel,
// or https://stg.factorylm.com once that subdomain lands).
const BASE_URL = (process.env.QA_BASE_URL || 'https://app.factorylm.com').replace(/\/+$/, '');
const BASE_ORIGIN = new URL(BASE_URL).origin;

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error('usage: [QA_BASE_URL=…] [QA_AUTH_STATE=…] node dogfood-output/qa-login-save-state.mjs <email> <password>');
  process.exit(2);
}

// One saved session per persona by default — minting all 7 RBAC personas to a
// single file would clobber. Override QA_AUTH_STATE for the legacy single
// (app-state.json) path the older fallbacks expect.
const localPart = email.split('@')[0].replace(/[^a-z0-9._+-]/gi, '_');
const AUTH_STATE = process.env.QA_AUTH_STATE
  ? resolve(process.env.QA_AUTH_STATE)
  : join(REPO_ROOT, 'dogfood-output', '.auth', `${localPart}-state.json`);
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
  await page.goto(`${BASE_URL}/login/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
  // Base-aware success match: a known authenticated path, or the app root (off
  // /login) on the target origin. Replaces the prod-hardcoded host regex.
  await page.waitForURL((url) => {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    if (/^\/(feed|namespace|hub|command-center|onboarding)/.test(path)) return true;
    return u.origin === BASE_ORIGIN && path === '';
  }, { timeout: 30000 }).catch(async () => {
    await page.waitForTimeout(5000);
  });
  await page.screenshot({ path: join(REPO_ROOT, 'dogfood-output', `auth-state-${localPart}.png`), fullPage: true });
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
  await page.screenshot({ path: join(REPO_ROOT, 'dogfood-output', `auth-state-error-${localPart}.png`), fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e), url: page.url(), consoleMsgs }, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
