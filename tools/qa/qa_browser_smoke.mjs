#!/usr/bin/env node
// qa_browser_smoke.mjs — minimal outside-in smoke for a public URL.
// Navigates, captures page title, a full-page screenshot, and console errors.
// No auth required. Safe to run against production marketing/app pages.
//
// Usage:
//   node tools/qa/qa_browser_smoke.mjs [url]
// Default url: https://factorylm.com/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, newRunDir, instrument } from './lib.mjs';

const url = process.argv[2] || 'https://factorylm.com/';

const { chromium } = loadPlaywright();
const out = newRunDir('smoke');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const { consoleMsgs, failedRequests } = instrument(page);

let title = null;
let status = null;
try {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  status = resp?.status() ?? null;
  await page.waitForTimeout(1500); // let client JS settle
  title = await page.title();
  await page.screenshot({ path: join(out, 'screenshot.png'), fullPage: true });
} catch (e) {
  consoleMsgs.push({ type: 'script-error', text: String(e?.message || e) });
} finally {
  await browser.close();
}

const errors = consoleMsgs.filter((m) => ['error', 'pageerror', 'script-error'].includes(m.type));
const summary = { url, httpStatus: status, title, errorCount: errors.length, failedRequestCount: failedRequests.length, outDir: out };
writeFileSync(join(out, 'console.json'), JSON.stringify(consoleMsgs, null, 2));
writeFileSync(join(out, 'network-failures.json'), JSON.stringify(failedRequests, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
if (errors.length) {
  console.log('\nConsole errors:');
  for (const e of errors.slice(0, 10)) console.log(`  [${e.type}] ${e.text}`);
}
