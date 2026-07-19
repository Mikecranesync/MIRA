#!/usr/bin/env node
// Browser-based customer-use work packs for the dogfood crew.
//
// This is intentionally evidence-first: it browses as saved QA personas, records
// what a real customer would see, classifies blocking/degraded/infra states, and
// writes artifacts. It does not file issues by itself.

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, instrument, newRunDir } from '../../qa/lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export const WORK_PACKS = {
  carlos: {
    persona: 'carlos',
    title: 'Carlos shift-start maintenance pass',
    authState: 'carlos-state.json',
    task:
      'Start like a maintenance tech: check the feed, assets, work orders, and knowledge for anything that blocks diagnosing VFD-07.',
    pages: [
      { name: 'feed', path: '/feed', expect: [/feed/i, /work order|asset|fault|maintenance/i] },
      { name: 'assets', path: '/assets', expect: [/asset|equipment|vfd|line/i] },
      { name: 'workorders', path: '/workorders', expect: [/work order|priority|status|open/i] },
      { name: 'knowledge', path: '/knowledge', expect: [/knowledge|manual|upload|library/i] },
    ],
  },
  dana: {
    persona: 'dana',
    title: 'Dana manager backlog pass',
    authState: 'dana-state.json',
    task:
      'Start like a maintenance manager: review the feed, backlog, assets, and knowledge surface for stale counts or missing next actions.',
    pages: [
      { name: 'feed', path: '/feed', expect: [/feed/i, /open|overdue|priority|work order/i] },
      { name: 'workorders', path: '/workorders', expect: [/work order|priority|status|open/i] },
      { name: 'assets', path: '/assets', expect: [/asset|equipment|line|status/i] },
      { name: 'knowledge', path: '/knowledge', expect: [/knowledge|manual|upload|library/i] },
    ],
  },
};

export function parseArgs(argv) {
  const args = {
    persona: 'all',
    base: process.env.QA_BASE_URL || 'http://100.68.120.99:4101',
    outDir: process.env.OUT_DIR || '',
    authDir: process.env.DF_AUTH_DIR || join(REPO_ROOT, 'dogfood-output', '.auth'),
    ledger: process.env.DOGFOOD_LEDGER_PATH || join(REPO_ROOT, 'dogfood-output', 'runner-ledger.jsonl'),
    strict: false,
    headful: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--persona') args.persona = argv[++i] || args.persona;
    else if (arg === '--base') args.base = argv[++i] || args.base;
    else if (arg === '--out-dir') args.outDir = argv[++i] || args.outDir;
    else if (arg === '--auth-dir') args.authDir = argv[++i] || args.authDir;
    else if (arg === '--ledger') args.ledger = argv[++i] || args.ledger;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--headful') args.headful = true;
    else if (arg === '--help') {
      args.help = true;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return args;
}

export function isAuthRedirect(finalUrl) {
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    return path.includes('/login') || path.includes('/auth');
  } catch {
    return String(finalUrl).includes('/login') || String(finalUrl).includes('/auth');
  }
}

export function observationFromSnapshot(snapshot) {
  const findings = [];
  const failed = snapshot.failedRequests || [];
  const consoleMsgs = snapshot.consoleMsgs || [];
  const text = (snapshot.text || '').replace(/\s+/g, ' ').trim();

  if (snapshot.error) findings.push({ severity: 'infra', reason: snapshot.error });
  if (snapshot.statusCode >= 500) findings.push({ severity: 'red', reason: `HTTP ${snapshot.statusCode}` });
  if (snapshot.statusCode >= 400 && snapshot.statusCode < 500) {
    findings.push({ severity: 'red', reason: `HTTP ${snapshot.statusCode}` });
  }
  const authRedirect = snapshot.expectedAuthed && isAuthRedirect(snapshot.finalUrl || snapshot.url);
  if (authRedirect) {
    findings.push({ severity: 'infra', reason: 'saved persona session landed on login/auth' });
  }
  if (!snapshot.error && !authRedirect && text.length < 80) {
    findings.push({ severity: 'red', reason: 'page rendered nearly blank text' });
  }

  const hardFailures = failed.filter((item) => item.status >= 500 || item.error);
  const softFailures = failed.filter((item) => item.status >= 400 && item.status < 500);
  if (hardFailures.length > 0) {
    findings.push({ severity: 'red', reason: `${hardFailures.length} failed/5xx browser request(s)` });
  } else if (softFailures.length > 0) {
    findings.push({ severity: 'yellow', reason: `${softFailures.length} 4xx browser request(s)` });
  }

  const pageErrors = consoleMsgs.filter((item) => item.type === 'pageerror');
  if (pageErrors.length > 0) {
    findings.push({ severity: 'red', reason: `${pageErrors.length} browser page error(s)` });
  }

  if (snapshot.expect?.length) {
    const expectedHit = snapshot.expect.some((regex) => regex.test(text));
    if (!expectedHit) {
      findings.push({ severity: 'yellow', reason: 'expected page language was missing' });
    }
  }

  const rank = { red: 3, infra: 2, yellow: 1, green: 0 };
  const status = findings.reduce(
    (worst, finding) => (rank[finding.severity] > rank[worst] ? finding.severity : worst),
    'green',
  );
  return {
    persona: snapshot.persona,
    page: snapshot.page,
    path: snapshot.path,
    url: snapshot.url,
    finalUrl: snapshot.finalUrl,
    status,
    reason: findings.map((finding) => finding.reason).join('; ') || 'loaded expected customer surface',
    screenshot: snapshot.screenshot || '',
    consoleErrors: pageErrors.length,
    failedRequests: failed.length,
  };
}

export function summarizeObservations(observations) {
  const counts = { red: 0, yellow: 0, green: 0, infra: 0 };
  for (const observation of observations) {
    counts[observation.status] = (counts[observation.status] || 0) + 1;
  }
  let status = 'green';
  if (counts.red > 0) status = 'red';
  else if (counts.infra > 0) status = 'infra';
  else if (counts.yellow > 0) status = 'yellow';
  return { status, counts };
}

export function ledgerEventForResult({ observations, outDir, base, startedAt, finishedAt }) {
  const summary = summarizeObservations(observations);
  const personas = [...new Set(observations.map((item) => item.persona).filter(Boolean))];
  const unableSources = observations
    .filter((item) => item.status === 'infra')
    .map((item) => `${item.persona}:${item.path}`);
  return {
    runner: 'customer_use_browser',
    status: summary.status,
    checked: observations.map((item) => `${item.persona}:${item.path}`),
    evidence_path: outDir,
    counts: summary.counts,
    personas,
    unable_sources: unableSources,
    next_action: nextAction(summary.status),
    run_id: basename(outDir),
    started_at: startedAt,
    finished_at: finishedAt,
    base_url: base,
  };
}

function nextAction(status) {
  if (status === 'red') return 'Review customer-use report and reproduce the first RED page manually';
  if (status === 'yellow') return 'Triage degraded customer-use pages and decide whether to add a deterministic check';
  if (status === 'infra') return 'Restore persona auth or staging reachability before trusting browser dogfood';
  return '';
}

function isoNow() {
  return new Date().toISOString();
}

function absoluteUrl(base, path) {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

async function inspectPage({ page, workPack, pageSpec, outDir, base }) {
  const url = absoluteUrl(base, pageSpec.path);
  const screenshot = join(outDir, `${workPack.persona}-${pageSpec.name}.png`);
  const snapshot = {
    persona: workPack.persona,
    page: pageSpec.name,
    path: pageSpec.path,
    url,
    finalUrl: url,
    statusCode: 0,
    text: '',
    consoleMsgs: [],
    failedRequests: [],
    expect: pageSpec.expect,
    expectedAuthed: true,
    screenshot,
  };

  const observed = instrument(page);
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    snapshot.statusCode = response?.status() || 0;
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, Math.max(document.body.scrollHeight, 0))).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    snapshot.finalUrl = page.url();
    snapshot.text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  } catch (error) {
    snapshot.error = String(error?.message || error);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  } finally {
    snapshot.consoleMsgs = observed.consoleMsgs;
    snapshot.failedRequests = observed.failedRequests;
  }
  return observationFromSnapshot(snapshot);
}

async function runWorkPack({ browser, workPack, authDir, outDir, base }) {
  const authState = join(authDir, workPack.authState);
  if (!existsSync(authState)) {
    return [missingAuthObservation(workPack, authState)];
  }

  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const observations = [];
  for (const pageSpec of workPack.pages) {
    observations.push(await inspectPage({ page, workPack, pageSpec, outDir, base }));
  }
  await context.close();
  return observations;
}

function missingAuthObservation(workPack, authState) {
  return {
    persona: workPack.persona,
    page: 'auth',
    path: authState,
    url: '',
    finalUrl: '',
    status: 'infra',
    reason: `saved auth state not found: ${authState}`,
    screenshot: '',
    consoleErrors: 0,
    failedRequests: 0,
  };
}

function writeReport({ observations, outDir, base, startedAt, finishedAt }) {
  const summary = summarizeObservations(observations);
  const lines = [
    '# Customer-Use Browser Dogfood',
    '',
    `Started: ${startedAt}`,
    `Finished: ${finishedAt}`,
    `Base URL: ${base}`,
    '',
    `## Overall: ${summary.status.toUpperCase()}`,
    `_${summary.counts.red} red / ${summary.counts.yellow} yellow / ${summary.counts.green} green / ${summary.counts.infra} infra across ${observations.length} customer-use checks._`,
    '',
    '## Observations',
    '| Persona | Page | Verdict | What happened | Evidence |',
    '|---|---|---|---|---|',
  ];
  for (const item of observations) {
    const evidence = item.screenshot ? basename(item.screenshot) : '';
    lines.push(`| ${item.persona} | ${item.page} | ${item.status.toUpperCase()} | ${item.reason.replace(/\|/g, '/')} | ${evidence} |`);
  }
  lines.push('', '## Next Action', nextAction(summary.status) || 'No customer-use blockers found.');

  writeFileSync(join(outDir, 'observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(join(outDir, 'report.md'), `${lines.join('\n')}\n`);
}

function appendLedger(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export async function runCustomerUse(args) {
  const selected =
    args.persona === 'all'
      ? Object.keys(WORK_PACKS)
      : args.persona.split(',').map((name) => name.trim()).filter(Boolean);
  for (const persona of selected) {
    if (!WORK_PACKS[persona]) {
      throw new Error(`unknown persona: ${persona}`);
    }
  }

  const outDir = args.outDir ? resolve(args.outDir) : newRunDir('customer-use');
  mkdirSync(outDir, { recursive: true });
  const startedAt = isoNow();
  const missingOnly = selected.every((persona) => {
    const workPack = WORK_PACKS[persona];
    return !existsSync(join(args.authDir, workPack.authState));
  });

  if (missingOnly) {
    const observations = selected.map((persona) => {
      const workPack = WORK_PACKS[persona];
      return missingAuthObservation(workPack, join(args.authDir, workPack.authState));
    });
    const finishedAt = isoNow();
    writeReport({ observations, outDir, base: args.base, startedAt, finishedAt });
    const event = ledgerEventForResult({ observations, outDir, base: args.base, startedAt, finishedAt });
    appendLedger(args.ledger, event);
    return { outDir, observations, event };
  }

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: !args.headful });
  const observations = [];
  try {
    for (const persona of selected) {
      const workPack = WORK_PACKS[persona];
      observations.push(...(await runWorkPack({ browser, workPack, authDir: args.authDir, outDir, base: args.base })));
    }
  } finally {
    await browser.close();
  }

  const finishedAt = isoNow();
  writeReport({ observations, outDir, base: args.base, startedAt, finishedAt });
  const event = ledgerEventForResult({ observations, outDir, base: args.base, startedAt, finishedAt });
  appendLedger(args.ledger, event);
  return { outDir, observations, event };
}

function printHelp() {
  console.log(`usage: node tools/crew/customer-use/runner.mjs [options]

Options:
  --persona <name|all>   carlos, dana, or comma-separated list (default: all)
  --base <url>           Hub base URL (default: QA_BASE_URL or staging)
  --auth-dir <dir>       saved Playwright auth states
  --out-dir <dir>        artifact directory
  --ledger <path>        runner ledger JSONL path
  --strict               exit nonzero on RED/YELLOW/INFRA
  --headful              show browser
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const result = await runCustomerUse(args);
  console.log(`customer-use ${result.event.status.toUpperCase()} report=${join(result.outDir, 'report.md')}`);
  if (args.strict && result.event.status !== 'green') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`customer-use ERROR: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
