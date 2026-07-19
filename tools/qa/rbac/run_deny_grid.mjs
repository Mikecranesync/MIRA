#!/usr/bin/env node
// RBAC deny-grid runner (Layer C).
//
// Drives each persona's saved session at the real Hub API and records, per
// probe, whether the AUTHZ gate denied / allowed / failed open. Most per-role
// deny probes fail open TODAY (#578: role:"member" hardcoded) — that's the
// finding this run documents, not a red build. The two "currentlyEnforced"
// controls (review-queue deny, usage allow) self-validate the runner: if they
// misbehave, the session/runner is broken and we exit loud.
//
// Usage:
//   QA_BASE_URL=http://localhost:4101 node tools/qa/rbac/run_deny_grid.mjs [--strict]
//
//   --strict  exit non-zero if any deny probe is NOT enforced or any allow
//             probe is OVER_BLOCKED. Flip this on once #578 lands → the grid
//             becomes a hard CI gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newRunDir } from '../lib.mjs';
import { BASE_URL, personaByKey, apiContextFor, resolvePath, probe, classify } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRICT = process.argv.includes('--strict');
const grid = JSON.parse(readFileSync(join(__dirname, 'deny-grid.json'), 'utf8'));

const outDir = newRunDir('rbac-deny-grid');
const ctxCache = new Map();
const results = [];

async function ctxFor(personaKey) {
  if (!ctxCache.has(personaKey)) {
    ctxCache.set(personaKey, await apiContextFor(personaByKey(personaKey)));
  }
  return ctxCache.get(personaKey);
}

try {
  for (const pr of grid.probes) {
    const persona = personaByKey(pr.persona);
    const path = resolvePath(pr.path);
    let status, bodySnippet, errored;
    try {
      const ctx = await ctxFor(pr.persona);
      ({ status, bodySnippet } = await probe(ctx, pr.method, path, pr.body));
    } catch (e) {
      errored = String(e?.message || e);
      status = 0;
    }
    const cls = errored ? { verdict: 'PROBE_ERROR', isSetupError: true, isFinding: false, enforced: false } : classify(pr.intent, status);
    results.push({
      id: pr.id, persona: pr.persona, role: persona.role, action: pr.action,
      intent: pr.intent, currentlyEnforced: pr.currentlyEnforced,
      method: pr.method, path, status, ...cls, note: pr.note, bodySnippet, errored,
    });
  }
} finally {
  for (const ctx of ctxCache.values()) await ctx.dispose().catch(() => {});
}

// ── Self-validation: the controls must behave, else the runner is untrustworthy.
const controls = results.filter((r) => r.currentlyEnforced);
const controlsBroken = controls.filter((r) => r.isSetupError || (r.intent === 'deny' && !r.enforced) || (r.intent === 'allow' && !r.enforced));
const setupErrors = results.filter((r) => r.isSetupError);
const findings = results.filter((r) => r.isFinding);

const summary = {
  base_url: BASE_URL,
  ran_at: new Date().toISOString(),
  total: results.length,
  controls: { total: controls.length, broken: controlsBroken.length },
  findings: findings.length,
  setup_errors: setupErrors.length,
  forward_looking_failopen: results.filter((r) => !r.currentlyEnforced && r.verdict === 'AUTH_NOT_ENFORCED').length,
  results,
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

const rows = results.map((r) => {
  const flag = r.isSetupError ? '🟠' : r.isFinding ? '🔴' : '🟢';
  return `| ${flag} | \`${r.persona}\` (${r.role}) | ${r.action} | ${r.method} ${r.path.replace('/api', '')} | ${r.status} | ${r.verdict} |`;
}).join('\n');
const md = `# RBAC deny-grid — ${BASE_URL}

Ran: ${summary.ran_at}
Controls: ${controls.length} (broken: ${controlsBroken.length}) · Findings: ${findings.length} · Setup errors: ${setupErrors.length}

| | Persona | Action | Route | HTTP | Verdict |
|---|---|---|---|---|---|
${rows}

## Findings (privilege not enforced — track under #578)
${findings.length === 0 ? '_none this run_' : findings.map((r) => `- \`${r.persona}\` (${r.role}) → **${r.action}** returned ${r.status} (${r.verdict}). ${r.note}`).join('\n')}
${setupErrors.length ? `\n## Setup errors (session/runner — fix before trusting this run)\n${setupErrors.map((r) => `- \`${r.persona}\` ${r.action}: ${r.errored || r.verdict} (status ${r.status})`).join('\n')}` : ''}
`;
writeFileSync(join(outDir, 'summary.md'), md);

console.log(md);
console.log(`\n[deny-grid] artifacts → ${outDir}`);

// ── Exit codes
if (controlsBroken.length || setupErrors.length) {
  console.error(`\n[deny-grid] ✗ ${controlsBroken.length} control(s) broken, ${setupErrors.length} setup error(s) — run is UNTRUSTWORTHY (bad/missing session or wrong base URL).`);
  process.exit(2);
}
if (STRICT && findings.length) {
  console.error(`\n[deny-grid] ✗ --strict: ${findings.length} unenforced privilege boundary(ies).`);
  process.exit(1);
}
console.log(`\n[deny-grid] ✓ controls valid. ${findings.length} forward-looking fail-open(s) recorded (expected until #578).`);
process.exit(0);
