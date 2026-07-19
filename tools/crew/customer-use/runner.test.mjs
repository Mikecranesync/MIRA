import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isAuthRedirect,
  ledgerEventForResult,
  observationFromSnapshot,
  parseArgs,
  runCustomerUse,
  summarizeObservations,
} from './runner.mjs';

test('auth redirects with saved sessions are infra, not green', () => {
  const observation = observationFromSnapshot({
    persona: 'carlos',
    page: 'feed',
    path: '/feed',
    url: 'http://hub/feed',
    finalUrl: 'http://hub/login',
    statusCode: 200,
    text: 'Sign in',
    expectedAuthed: true,
    failedRequests: [],
    consoleMsgs: [],
  });
  assert.equal(isAuthRedirect(observation.finalUrl), true);
  assert.equal(observation.status, 'infra');
  assert.match(observation.reason, /login\/auth/);
});

test('blank or failing customer pages are red', () => {
  const observation = observationFromSnapshot({
    persona: 'dana',
    page: 'workorders',
    path: '/workorders',
    url: 'http://hub/workorders',
    finalUrl: 'http://hub/workorders',
    statusCode: 500,
    text: '',
    expectedAuthed: true,
    failedRequests: [{ url: 'http://hub/api/workorders', status: 500 }],
    consoleMsgs: [],
  });
  assert.equal(observation.status, 'red');
  assert.match(observation.reason, /HTTP 500/);
});

test('summary preserves the worst customer-use status', () => {
  assert.deepEqual(
    summarizeObservations([
      { status: 'green' },
      { status: 'yellow' },
      { status: 'infra' },
      { status: 'red' },
    ]),
    { status: 'red', counts: { red: 1, yellow: 1, green: 1, infra: 1 } },
  );
});

test('ledger events include checked pages and unable sources', () => {
  const event = ledgerEventForResult({
    outDir: '/tmp/customer-use-1',
    base: 'http://hub',
    startedAt: '2026-07-19T10:00:00.000Z',
    finishedAt: '2026-07-19T10:01:00.000Z',
    observations: [
      { persona: 'carlos', path: '/feed', status: 'green' },
      { persona: 'dana', path: '/workorders', status: 'infra' },
    ],
  });
  assert.equal(event.runner, 'customer_use_browser');
  assert.equal(event.status, 'infra');
  assert.deepEqual(event.checked, ['carlos:/feed', 'dana:/workorders']);
  assert.deepEqual(event.unable_sources, ['dana:/workorders']);
});

test('argument parsing rejects unknown options', () => {
  assert.throws(() => parseArgs(['--mystery']), /unknown arg/);
});

test('runner writes infra report and ledger when saved auth is missing', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'customer-use-runner-'));
  try {
    const result = await runCustomerUse({
      persona: 'carlos',
      base: 'http://hub',
      outDir: join(tmp, 'out'),
      authDir: join(tmp, 'missing-auth'),
      ledger: join(tmp, 'runner-ledger.jsonl'),
      strict: false,
      headful: false,
    });

    assert.equal(result.event.status, 'infra');
    assert.equal(result.observations[0].page, 'auth');
    assert.equal(existsSync(join(tmp, 'out', 'report.md')), true);
    const ledgerLine = JSON.parse(readFileSync(join(tmp, 'runner-ledger.jsonl'), 'utf8').trim());
    assert.equal(ledgerLine.runner, 'customer_use_browser');
    assert.equal(ledgerLine.status, 'infra');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
