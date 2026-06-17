#!/usr/bin/env node
// upload_manual_smoke.mjs — manual-upload smoke (PARAMETERIZED TEMPLATE).
//
// WHY THIS IS A TEMPLATE, NOT A ONE-SHOT:
//   Uploading a manual requires being LOGGED IN to app.factorylm.com. The hard
//   part is the auth, not the file-input call. So this script expects a saved
//   Playwright storageState (cookies/localStorage) captured once after a manual
//   login. It then drives the file input + captures console/network evidence —
//   the exact capability the Hermes browser toolset lacks (no setInputFiles).
//
// ONE-TIME: capture an auth state by logging in by hand, then save state:
//   node tools/qa/upload_manual_smoke.mjs --login https://app.factorylm.com/
//     -> opens a HEADED browser; log in manually; press Enter in the terminal;
//        it writes dogfood-output/.auth/app-state.json (gitignored — secrets).
//
// RUN THE UPLOAD SMOKE (after auth state exists):
//   node tools/qa/upload_manual_smoke.mjs \
//     --url   https://app.factorylm.com/<upload-page> \
//     --input 'input[type=file]' \
//     --submit 'button:has-text("Upload")' \
//     --pdf   dogfood-output/samples/powerflex-fault-code-sample.pdf
//
// SAFETY: only uploads the synthetic sample PDF. No deletes. No payments.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { loadPlaywright, newRunDir, instrument, SAMPLE_PDF } from './lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_STATE = join(REPO_ROOT, 'dogfood-output', '.auth', 'app-state.json');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const isLogin = process.argv.includes('--login');
const { chromium } = loadPlaywright();

if (isLogin) {
  const loginUrl = process.argv[process.argv.indexOf('--login') + 1] || 'https://app.factorylm.com/';
  mkdirSync(dirname(AUTH_STATE), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(loginUrl);
  console.log('\n>>> Log in manually in the opened browser, then press Enter here to save auth state...');
  await new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); res(); });
  });
  await ctx.storageState({ path: AUTH_STATE });
  await browser.close();
  console.log(`Saved auth state -> ${AUTH_STATE}`);
  process.exit(0);
}

const url = arg('url');
const inputSel = arg('input', 'input[type=file]');
const submitSel = arg('submit', '');
const pdf = arg('pdf', SAMPLE_PDF);
if (!url) {
  console.error('usage: node tools/qa/upload_manual_smoke.mjs --url <upload-page> [--input <sel>] [--submit <sel>] [--pdf <path>]');
  console.error('first run once with: --login <app-url>   to capture auth state');
  process.exit(2);
}
if (!existsSync(AUTH_STATE)) {
  console.error(`No auth state at ${AUTH_STATE}. Run once with: --login https://app.factorylm.com/`);
  process.exit(3);
}
if (!existsSync(pdf)) {
  console.error(`Sample PDF not found: ${pdf}`);
  process.exit(4);
}

const out = newRunDir('upload');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: AUTH_STATE });
const page = await ctx.newPage();
const { consoleMsgs, failedRequests } = instrument(page);

let ok = false;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector(inputSel, { timeout: 15000 });
  await page.setInputFiles(inputSel, pdf);
  await page.screenshot({ path: join(out, '1-file-selected.png'), fullPage: true });
  if (submitSel) {
    await page.click(submitSel);
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: join(out, '2-after-submit.png'), fullPage: true });
  ok = true;
} catch (e) {
  consoleMsgs.push({ type: 'script-error', text: String(e?.message || e) });
} finally {
  await browser.close();
}

writeFileSync(join(out, 'console.json'), JSON.stringify(consoleMsgs, null, 2));
writeFileSync(join(out, 'network-failures.json'), JSON.stringify(failedRequests, null, 2));
const summary = { url, pdf, uploadAttempted: ok, consoleErrors: consoleMsgs.filter((m) => m.type !== 'log').length, failedRequests: failedRequests.length, outDir: out };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
