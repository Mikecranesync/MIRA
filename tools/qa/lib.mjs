// Shared helpers for MIRA QA Playwright fallback scripts.
// These exist because the Hermes desktop agent's browser toolset has NO
// file-upload tool and NO network-request capture (CDP backend unavailable).
// Playwright is reused from mira-hub/node_modules — nothing new is installed.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// Resolve Playwright from mira-hub first, then mira-web, then a global install.
export function loadPlaywright() {
  const candidates = [
    join(REPO_ROOT, 'mira-hub', 'node_modules'),
    join(REPO_ROOT, 'mira-web', 'node_modules'),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, 'noop.js'));
      return req('playwright');
    } catch { /* try next */ }
  }
  // Last resort: ambient resolution.
  return createRequire(import.meta.url)('playwright');
}

// Timestamped output dir under dogfood-output/qa-runs/.
export function newRunDir(name) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(REPO_ROOT, 'dogfood-output', 'qa-runs', `${name}-${ts}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const SAMPLE_PDF = join(
  REPO_ROOT, 'dogfood-output', 'samples', 'powerflex-fault-code-sample.pdf',
);

// Attach console + failed-request listeners; returns arrays you can dump later.
export function instrument(page) {
  const consoleMsgs = [];
  const failedRequests = [];
  page.on('console', (m) => {
    consoleMsgs.push({ type: m.type(), text: m.text() });
  });
  page.on('pageerror', (e) => {
    consoleMsgs.push({ type: 'pageerror', text: String(e?.message || e) });
  });
  page.on('requestfailed', (r) => {
    failedRequests.push({ url: r.url(), method: r.method(), error: r.failure()?.errorText });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      failedRequests.push({ url: r.url(), method: r.request().method(), status: r.status() });
    }
  });
  return { consoleMsgs, failedRequests };
}
