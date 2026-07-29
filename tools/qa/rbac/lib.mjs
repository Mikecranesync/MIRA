// Shared helpers for the RBAC synthetic-worker QA module.
//
// These drive the 7 seeded personas (mira-hub/scripts/seed-synthetic-users.ts)
// at the real Hub API to test the boundaries that ARE enforced today (auth,
// tenant isolation, platform-capability gates) and to record the per-role deny
// grid that is forward-looking (#578 — role:"member" is hardcoded, so per-role
// permissions fail open until that lands). Playwright is reused from
// mira-hub/node_modules via tools/qa/lib.mjs — nothing new is installed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadPlaywright } from '../lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export const BASE_URL = (process.env.QA_BASE_URL || 'https://app.factorylm.com').replace(/\/+$/, '');

export const registry = JSON.parse(
  readFileSync(join(__dirname, 'personas.json'), 'utf8'),
);

export function personaByKey(key) {
  const p = registry.personas.find((x) => x.key === key);
  if (!p) throw new Error(`unknown persona "${key}" (have: ${registry.personas.map((x) => x.key).join(', ')})`);
  return p;
}

// Saved-session path for a persona — matches the default the login helper writes
// (dogfood-output/.auth/<local-part>-state.json). Override-able via QA_AUTH_DIR.
export function authStatePath(persona) {
  const dir = process.env.QA_AUTH_DIR
    ? resolve(process.env.QA_AUTH_DIR)
    : join(REPO_ROOT, 'dogfood-output', '.auth');
  const localPart = persona.email.split('@')[0].replace(/[^a-z0-9._+-]/gi, '_');
  return join(dir, `${localPart}-state.json`);
}

// Resolve {knownId} placeholders in a path against personas.json knownIds.
export function resolvePath(path) {
  return path.replace(/\{([^}]+)\}/g, (_m, key) => {
    const id = registry.knownIds[key];
    if (!id) throw new Error(`unknown knownId "${key}" in path "${path}"`);
    return id;
  });
}

// An authenticated Playwright APIRequestContext for a persona (sends the saved
// NextAuth session cookies). Throws a clear setup error if the session is absent.
export async function apiContextFor(persona) {
  const pw = loadPlaywright();
  const statePath = authStatePath(persona);
  let storageState;
  try {
    storageState = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    throw new Error(
      `no saved session for ${persona.email} at ${statePath}. Mint it first:\n` +
      `  QA_BASE_URL=${BASE_URL} node dogfood-output/qa-login-save-state.mjs "${persona.email}" "$${persona.passwordEnv}"`,
    );
  }
  return pw.request.newContext({ baseURL: BASE_URL, storageState, ignoreHTTPSErrors: true });
}

// Issue one request and return {status, bodySnippet}. Never throws on HTTP status.
export async function probe(ctx, method, path, body) {
  const opts = body !== undefined ? { data: body } : {};
  const res = await ctx.fetch(path, { method, ...opts });
  let bodySnippet = '';
  try { bodySnippet = (await res.text()).slice(0, 240); } catch { /* ignore */ }
  return { status: res.status(), bodySnippet };
}

// Classify a deny-grid outcome. Pure function — unit-tested.
//   verdict, isFinding (a real problem to surface), isSetupError, enforced
export function classify(intent, status) {
  if (status === 401) {
    return { verdict: 'NOT_AUTHENTICATED', isSetupError: true, isFinding: false, enforced: false };
  }
  if (intent === 'deny') {
    if (status === 403) return { verdict: 'DENIED', enforced: true, isFinding: false };
    if (status === 404 || status === 405) {
      return { verdict: 'DENIED_BY_ABSENCE', enforced: false, isFinding: false };
    }
    // 2xx (created) or 400/422 (passed authz, failed validation) or 5xx → the gate let it through.
    return { verdict: 'AUTH_NOT_ENFORCED', enforced: false, isFinding: true };
  }
  // intent === 'allow'
  if (status >= 200 && status < 300) return { verdict: 'ALLOWED', enforced: true, isFinding: false };
  if (status === 400 || status === 422) {
    return { verdict: 'ALLOWED_PASSED_AUTHZ', enforced: true, isFinding: false };
  }
  if (status === 403) return { verdict: 'OVER_BLOCKED', enforced: false, isFinding: true };
  if (status === 404 || status === 405) return { verdict: 'ROUTE_ABSENT', enforced: false, isFinding: false };
  return { verdict: 'SERVER_ERROR', enforced: false, isFinding: false };
}

export { REPO_ROOT };
