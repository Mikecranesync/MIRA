#!/usr/bin/env node
// capture_console_network.mjs — evidence capture for a single page load.
// Records EVERY console message, every failed/4xx/5xx network request, and a
// screenshot. This is the evidence Hermes cannot gather itself (no CDP/network
// capture in its browser toolset). No auth required.
//
// Usage:
//   node tools/qa/capture_console_network.mjs <url>
//   node tools/qa/capture_console_network.mjs https://app.factorylm.com/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, newRunDir, instrument } from './lib.mjs';

const url = process.argv[2];
if (!url) {
  console.error('usage: node tools/qa/capture_console_network.mjs <url>');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const out = newRunDir('console-network');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const { consoleMsgs, failedRequests } = instrument(page);

// Record ALL requests (not just failures) for full network evidence.
const allRequests = [];
page.on('response', (r) => {
  allRequests.push({ url: r.url(), method: r.request().method(), status: r.status() });
});

let status = null;
try {
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  status = resp?.status() ?? null;
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, 'screenshot.png'), fullPage: true });
} catch (e) {
  consoleMsgs.push({ type: 'script-error', text: String(e?.message || e) });
} finally {
  await browser.close();
}

writeFileSync(join(out, 'console.json'), JSON.stringify(consoleMsgs, null, 2));
writeFileSync(join(out, 'network-all.json'), JSON.stringify(allRequests, null, 2));
writeFileSync(join(out, 'network-failures.json'), JSON.stringify(failedRequests, null, 2));

const errors = consoleMsgs.filter((m) => ['error', 'pageerror', 'script-error'].includes(m.type));
const summary = {
  url, httpStatus: status,
  consoleTotal: consoleMsgs.length, consoleErrors: errors.length,
  requestsTotal: allRequests.length, requestsFailed: failedRequests.length,
  outDir: out,
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const f of failedRequests.slice(0, 15)) {
  console.log(`  FAIL ${f.status || f.error} ${f.method} ${f.url}`);
}
