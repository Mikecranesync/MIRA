#!/usr/bin/env node
// Layer-A tenant-isolation / RLS probe.
//
// This is the boundary that IS enforced today (withTenant → RLS tenant context),
// so it is the highest-value synthetic-worker test we can run with certainty.
// Drives the second-tenant `isolation` persona at the PRIMARY tenant's known
// object IDs and asserts it can never read them. A 200 that returns a foreign
// row is a P0 cross-tenant leak.
//
// A reverse control (`carlos`, primary tenant) reads the same IDs and MUST get
// 200 — proving the objects exist and the probe can tell allow from deny. If the
// control fails, the seed or the session is wrong and we exit loud (not "no leak").
//
// Usage:
//   QA_BASE_URL=http://localhost:4101 node tools/qa/rbac/isolation_probe.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newRunDir } from '../lib.mjs';
import { BASE_URL, registry, personaByKey, apiContextFor, resolvePath } from './lib.mjs';

const outDir = newRunDir('rbac-isolation');
const VFD07 = registry.knownIds.equipment_vfd07;

const checks = [];
function record(c) { checks.push(c); }

async function getStatusAndBody(ctx, path) {
  const res = await ctx.fetch(path, { method: 'GET' });
  let body = '';
  try { body = await res.text(); } catch { /* ignore */ }
  return { status: res.status(), body };
}

let isoCtx, carlosCtx;
try {
  isoCtx = await apiContextFor(personaByKey('isolation'));
  carlosCtx = await apiContextFor(personaByKey('carlos'));

  // ── Reverse control: primary-tenant persona MUST see the object ───────────
  {
    const { status } = await getStatusAndBody(carlosCtx, resolvePath('/api/assets/{equipment_vfd07}'));
    record({
      name: 'control: carlos (primary tenant) reads VFD-07',
      kind: 'control', expect: '200', status,
      ok: status === 200,
      detail: status === 200 ? 'object readable in-tenant' : 'CONTROL FAILED — seed missing or session bad; isolation result is NOT trustworthy',
    });
  }

  // ── Cross-tenant object reads: isolation persona MUST be denied ───────────
  for (const [label, tmpl] of [
    ['asset detail', '/api/assets/{equipment_vfd07}'],
    ['work-order detail', '/api/work-orders/{work_order_001}'],
  ]) {
    const { status, body } = await getStatusAndBody(isoCtx, resolvePath(tmpl));
    const leaked = status === 200 && (body.includes(VFD07) || body.includes('VFD-07'));
    record({
      name: `isolation reads primary ${label}`,
      kind: 'isolation', expect: '404/403 (never the row)', status,
      ok: status !== 200 && !leaked,
      leak: leaked,
      detail: leaked ? 'P0 LEAK — foreign row returned' : (status === 200 ? 'P0 LEAK — 200 cross-tenant' : 'denied'),
    });
  }

  // ── Cross-tenant list read: isolation list MUST NOT contain primary rows ──
  {
    const { status, body } = await getStatusAndBody(isoCtx, '/api/assets');
    const leaked = status === 200 && (body.includes(VFD07) || body.includes('VFD-07'));
    record({
      name: 'isolation asset list excludes primary tenant rows',
      kind: 'isolation', expect: 'list without VFD-07', status,
      ok: !leaked,
      leak: leaked,
      detail: leaked ? 'P0 LEAK — primary equipment visible in second-tenant list' : 'list clean',
    });
  }
} catch (e) {
  record({ name: 'probe setup', kind: 'setup', ok: false, detail: String(e?.message || e) });
} finally {
  await isoCtx?.dispose().catch(() => {});
  await carlosCtx?.dispose().catch(() => {});
}

const control = checks.find((c) => c.kind === 'control');
const controlOk = control?.ok ?? false;
const leaks = checks.filter((c) => c.leak);
const setupBad = checks.some((c) => c.kind === 'setup') || !controlOk;

const summary = { base_url: BASE_URL, ran_at: new Date().toISOString(), control_ok: controlOk, leaks: leaks.length, checks };
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

const md = `# Tenant-isolation probe — ${BASE_URL}

Ran: ${summary.ran_at} · Control OK: ${controlOk} · Leaks: ${leaks.length}

| | Check | Expect | HTTP | Result |
|---|---|---|---|---|
${checks.map((c) => `| ${c.ok ? '🟢' : (c.leak ? '🔴' : '🟠')} | ${c.name} | ${c.expect ?? '—'} | ${c.status ?? '—'} | ${c.detail} |`).join('\n')}

${leaks.length ? `## 🔴 P0 cross-tenant leaks\n${leaks.map((c) => `- ${c.name}: ${c.detail}`).join('\n')}` : '_No cross-tenant leak detected._'}
`;
writeFileSync(join(outDir, 'summary.md'), md);
console.log(md);
console.log(`\n[isolation] artifacts → ${outDir}`);

if (setupBad) {
  console.error('\n[isolation] ✗ control failed / setup error — result is NOT trustworthy. Fix seed/session before trusting.');
  process.exit(2);
}
if (leaks.length) {
  console.error(`\n[isolation] ✗ ${leaks.length} P0 cross-tenant leak(s).`);
  process.exit(1);
}
console.log('\n[isolation] ✓ tenant isolation holds.');
process.exit(0);
