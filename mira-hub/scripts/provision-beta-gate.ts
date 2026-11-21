/**
 * Provision a real "stranger" run for the beta release gate, end-to-end over HTTP.
 *
 * The gate `tests/beta/beta_ready_upload_retrieval_citation.py` needs a LIVE Hub
 * NodeChat surface + a real next-auth session cookie + a self-served node. This
 * script produces exactly that against a locally-running Hub, with no hand-seeded
 * data — the stranger registers, gets a node, and the gate then uploads a manual
 * through the real door and asks for a cited answer.
 *
 * Steps: register (auth-side tenant) → mirror tenant into the DATA-side `tenants`
 * (UUID FK that knowledge_entries / kg_entities reference) → mint the next-auth
 * cookie (csrf → credentials callback) → create a namespace node via the real
 * route. Emits `BETA_GATE_*` env lines on stdout (prefixed `ENV:`); progress on
 * stderr.
 *
 * Full recipe (build the Hub at basePath='' on dev, run the gate):
 *   cd mira-hub
 *   NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' NODE_ENV=production \
 *     doppler run -p factorylm -c dev -- ./node_modules/.bin/next build
 *   NEXT_PUBLIC_BASE_PATH='' NODE_ENV=production \
 *     doppler run -p factorylm -c dev -- env NEXTAUTH_URL=http://localhost:3100 \
 *     AUTH_TRUST_HOST=true ./node_modules/.bin/next start -p 3100 &
 *   doppler run -p factorylm -c dev -- bun run scripts/provision-beta-gate.ts > /tmp/env.out
 *   cd .. && set -a; . <(grep '^ENV:' /tmp/env.out | sed 's/^ENV://'); set +a
 *   .venv/bin/python -m pytest tests/beta/beta_ready_upload_retrieval_citation.py -v -rX
 *   # XPASS(strict) == the gate is MET.
 *
 * HUB defaults to http://localhost:3100 (override with HUB_BASE).
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const HUB = process.env.HUB_BASE ?? "http://localhost:3100";
// Codex F32: a clock reading alone collides across runs that start in the same
// millisecond; the random part makes each run's fixture identity its own.
const SUFFIX = `${Date.now()}${randomBytes(6).toString("hex")}`;
// Cryptographically fresh per run. Never logged, never emitted on stdout/stderr:
// the gate authenticates with the minted session cookie, not the password, and
// the run's auth rows are swept afterwards (--cleanup).
const CREDS = {
  email: `betagate-${SUFFIX}@factorylm.com`,
  password: `${randomBytes(24).toString("base64url")}!Aa1`,
  name: "Beta Gate Stranger",
};

function extractSession(raw: string): string | null {
  const matches = [...raw.matchAll(/next-auth\.session-token=([^;,\s]+)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

// Delete every row a provisioned run created for a tenant. Used by the CI job
// (`--cleanup <tenantId>`) so dev Neon doesn't accumulate gate fixtures.
async function cleanup(tenantId: string) {
  if (!tenantId) throw new Error("--cleanup requires a tenant id");
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // Every table a provisioned run can write, dependents first. All deletes
    // are tenant-scoped by construction (the run's OWN tenant id) — this is the
    // staging sweep only; the production probe cleans through public APIs.
    // Notebook-lane tables (Workstream B) may be absent on an older branch:
    // a missing table is skipped, never fatal.
    const tables = [
      "equipment_notebook_turns",
      "equipment_notebook_sources",
      "equipment_notebooks",
      "workspace_file_links",
      "namespace_direct_uploads",
      "decision_traces",
      // 093. The sweep deletes this tenant's `decision_traces`, so leaving its
      // arrivals behind makes every swept acceptance run look like permanent
      // capture loss: an ingress row with no ledger row behind it is exactly
      // what `lost_starts` counts. Measured on staging 2026-09-23 — four swept
      // attempts scored `lost_starts: 3` and cost an hour to explain.
      "turn_ingress",
      "knowledge_entries",
      "hub_uploads",
      "kg_entities",
    ];
    for (const tbl of tables) {
      try {
        await c.query(`DELETE FROM ${tbl} WHERE tenant_id::text = $1`, [tenantId]);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "42P01" || code === "42703") continue; // undefined_table / undefined_column
        throw err;
      }
    }
    await c.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    // Auth side (users.ts): hub_users.tenant_id REFERENCES hub_tenants(id), and
    // hub_tenants.owner_user_id is a plain TEXT column — so users first, then
    // the tenant. Both keyed on THIS run's tenant id only.
    // This run's single-use sign-in tokens (verified-setup path), keyed through
    // its own users before they are deleted. Pre-116 schema may lack columns.
    try {
      await c.query(
        `DELETE FROM hub_magic_tokens WHERE LOWER(email) IN (SELECT LOWER(email) FROM hub_users WHERE tenant_id = $1)`,
        [tenantId],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "42P01" && code !== "42703") throw err;
    }
    await c.query(`DELETE FROM hub_users WHERE tenant_id = $1`, [tenantId]);
    await c.query(`DELETE FROM hub_tenants WHERE id = $1`, [tenantId]);
  } finally {
    await c.end();
  }
  // Proof, not observation: the run's auth + data rows must be GONE.
  const left = await (async () => {
    const c2 = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c2.connect();
    try {
      const r = await c2.query(
        `SELECT (SELECT count(*) FROM hub_users WHERE tenant_id = $1)::int AS users,
                (SELECT count(*) FROM hub_tenants WHERE id = $1)::int AS auth_tenants,
                (SELECT count(*) FROM tenants WHERE id::text = $1)::int AS tenants`,
        [tenantId],
      );
      return r.rows[0] as { users: number; auth_tenants: number; tenants: number };
    } finally {
      await c2.end();
    }
  })();
  if (left.users || left.auth_tenants || left.tenants) {
    throw new Error(`cleanup incomplete for ${tenantId}: ${JSON.stringify(left)}`);
  }
  console.error(`cleaned tenant ${tenantId} (auth + data rows verified gone)`);
}

/** Test hook: BETA_GATE_FAIL_AFTER=mirror|signin|node forces a failure at that
 *  stage so the self-clean path is provable. Never set in CI. */
function failAfter(stage: "mirror" | "signin" | "node") {
  if (process.env.BETA_GATE_FAIL_AFTER === stage) {
    throw new Error(`forced failure after ${stage} (BETA_GATE_FAIL_AFTER)`);
  }
}

/** Seed one single-use sign-in token straight into the DB — the provisioner's
 *  stand-in for the stranger clicking the emailed link. The magic-link REQUEST
 *  endpoint is deliberately not used: staging has a live mail key, so it would
 *  send real email every run. The token is never printed. */
async function seedMagicToken(purpose: "onboarding" | "login", onboarding: object | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(
      `INSERT INTO hub_magic_tokens (token, email, expires_at, purpose, onboarding)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes', $3, $4::jsonb)`,
      [token, CREDS.email, purpose, onboarding ? JSON.stringify(onboarding) : null],
    );
  } finally {
    await c.end();
  }
  return token;
}

/** csrf → credentials callback for a next-auth provider; returns the session cookie header. */
async function mintSession(provider: "credentials" | "magic-token", fields: Record<string, string>): Promise<string> {
  const csrfRes = await fetch(`${HUB}/api/auth/csrf/`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const form = new URLSearchParams(fields);
  form.set("csrfToken", csrfToken);
  form.set("redirect", "false");
  form.set("json", "true");
  form.set("callbackUrl", HUB);
  const signIn = await fetch(`${HUB}/api/auth/callback/${provider}/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie1 },
    body: form.toString(),
    redirect: "manual",
  });
  const sessionToken = extractSession([cookie1, signIn.headers.get("set-cookie") ?? ""].join(", "));
  if (!sessionToken) throw new Error(`no session cookie (${provider} signin ${signIn.status})`);
  console.error(`minted session cookie (${provider} signin ${signIn.status})`);
  return `next-auth.session-token=${sessionToken}`;
}

/** The workspace THIS run's exact setup token created, read from the receipt
 * the redemption transaction writes onto the spent token (Codex F32). No
 * receipt means no proof of ownership, so nothing is ever adopted or deleted. */
async function tenantCreatedByToken(token: string): Promise<string | null> {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT onboarding->>'createdTenantId' AS tenant_id FROM hub_magic_tokens WHERE token = $1 AND used_at IS NOT NULL`,
      [token],
    );
    return r.rows[0]?.tenant_id ? String(r.rows[0].tenant_id) : null;
  } finally {
    await c.end();
  }
}

async function deleteSeededToken(token: string): Promise<void> {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(`DELETE FROM hub_magic_tokens WHERE token = $1`, [token]);
  } finally {
    await c.end();
  }
}

/** With pilot review (or free signup) on, register refuses unverified accounts
 *  and points at verified setup. Walk that real path: pick the intent the
 *  server says is open, then redeem a seeded setup token through the real
 *  `magic-token` sign-in, which creates the account. */
async function verifiedOnboarding(): Promise<string> {
  const open: Array<{ intent: "technician" | "pilot"; kind: string }> = [
    { intent: "technician", kind: "free_technician" },
    { intent: "pilot", kind: "pilot_application" },
  ];
  let chosen: { intent: "technician" | "pilot"; agreementVersion: string } | null = null;
  for (const o of open) {
    const res = await fetch(`${HUB}/api/public/signup-policy/${o.intent === "pilot" ? "?intent=pilot" : ""}`);
    const p = (await res.json().catch(() => ({}))) as { kind?: string; agreementVersion?: string };
    if (p.kind === o.kind && p.agreementVersion) {
      chosen = { intent: o.intent, agreementVersion: p.agreementVersion };
      break;
    }
  }
  if (!chosen) throw new Error("register requires verified setup, but no verified signup is open");
  console.error(`register requires verified setup — onboarding as '${chosen.intent}'`);
  let token: string | null = null;
  try {
    token = await seedMagicToken("onboarding", chosen);
    // This session is minted while the account may still be 'pending'; the
    // status rides in the JWT, so it is discarded and re-minted after un-pend.
    await mintSession("magic-token", { token, agreementVersion: chosen.agreementVersion });
    const tenantId = await tenantCreatedByToken(token);
    if (!tenantId) throw new Error("verified setup created no account for this run");
    return tenantId;
  } catch (e) {
    // Delete a tenant only with this token's own creation receipt (Codex F32).
    // Any other account under the address is reported, never touched.
    const orphan = token ? await tenantCreatedByToken(token).catch(() => null) : null;
    if (!orphan) {
      if (token) await deleteSeededToken(token);
      console.error("verified setup created no account attributable to this run; only its seeded token was removed");
    } else {
      try {
        await cleanup(orphan);
      } catch (sweepErr) {
        throw new AggregateError([e, sweepErr], `verified setup failed AND self-clean FAILED for ${orphan}`);
      }
    }
    throw e;
  }
}

export async function main() {
  // 1. Register a fresh stranger tenant (auth side: hub_tenants).
  const reg = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDS),
  });
  const regJson = (await reg.json().catch(() => ({}))) as { tenantId?: string; code?: string };
  let tenantId: string;
  let passwordless = false;
  if (reg.status === 201 && regJson.tenantId) {
    tenantId = regJson.tenantId;
  } else if (reg.status === 403 && regJson.code === "verified_onboarding_required") {
    tenantId = await verifiedOnboarding();
    passwordless = true;
  } else {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(regJson)}`);
  }
  console.error(`registered tenant ${tenantId}`);

  // From here a tenant EXISTS. If anything below fails, the workflow never
  // receives BETA_GATE_TENANT and no job could sweep it — so the provisioner
  // sweeps its own registration before re-throwing (ENV lines are emitted only
  // on full success, at the very end).
  try {
    await provisionAfterRegister(tenantId, passwordless);
  } catch (e) {
    console.error(`provisioning failed after registration — sweeping tenant ${tenantId}`);
    try {
      await cleanup(tenantId);
    } catch (sweepErr) {
      // Cleanup failure must PROPAGATE, not be logged away: the caller sees
      // both the original failure and the fact that rows may remain.
      throw new AggregateError(
        [e, sweepErr],
        `provisioning failed after registration AND self-clean FAILED for ${tenantId} — run-owned staging rows may remain`,
      );
    }
    throw e;
  }
}

async function provisionAfterRegister(tenantId: string, passwordless = false) {
  // 2. Mirror the tenant id into the DATA-side `tenants` (UUID FK). register only
  //    made the auth-side row; without this the upload's chunk INSERT 500s on FK.
  const owner = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await owner.connect();
  try {
    await owner.query(
      `INSERT INTO tenants (id, name, contact_email) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `betagate_${SUFFIX}`, CREDS.email],
    );
    // #4927: with MIRA_PILOT_APPROVAL_REQUIRED on, register makes the stranger
    // 'pending' and middleware 307s every API call to /pending-approval. Put
    // THIS run's own tenant back on the flag-off path (pilot_status NULL,
    // owner on a trial) — exactly what register writes with the flag off, so
    // with the flag off both UPDATEs match nothing. NULL (not 'active') keeps
    // the throwaway tenant out of the 5-org cohort count.
    await owner.query(
      `UPDATE hub_users SET status = 'trial', trial_expires_at = NOW() + INTERVAL '1 day', updated_at = NOW()
       WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
    );
    try {
      await owner.query(`UPDATE hub_tenants SET pilot_status = NULL WHERE id = $1 AND pilot_status = 'pending'`, [
        tenantId,
      ]);
    } catch (err) {
      // Pre-107 schema has no pilot_status column — nothing to undo there.
      if ((err as { code?: string }).code !== "42703") throw err;
    }
  } finally {
    await owner.end();
  }
  console.error("mirrored tenant into data-side `tenants`");
  failAfter("mirror");

  // 3. Mint the next-auth session cookie AFTER the un-pend above (the account
  //    status rides in the JWT). A verified-setup account has no password, so
  //    it signs in with an ordinary single-use login token instead.
  const cookieHeader = passwordless
    ? await mintSession("magic-token", { token: await seedMagicToken("login", null) })
    : await mintSession("credentials", { email: CREDS.email, password: CREDS.password });
  failAfter("signin");

  // 4. Create a namespace node as the stranger (real route).
  const nodeRes = await fetch(`${HUB}/api/namespace/node/`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ name: `Beta Gate Folder ${SUFFIX}` }),
    // A gate redirect (e.g. 307 /pending-approval) must fail here as a 3xx,
    // not be followed into a page that reads as `200 {}` (#4927).
    redirect: "manual",
  });
  const nodeJson = (await nodeRes.json().catch(() => ({}))) as { node?: { id?: string } };
  if (nodeRes.status !== 201 || !nodeJson.node?.id) {
    throw new Error(`node create failed: ${nodeRes.status} ${JSON.stringify(nodeJson)}`);
  }
  const nodeId = nodeJson.node.id;
  console.error(`created node ${nodeId}`);
  failAfter("node");

  // Emit env for the gate (trailing-slash canonical doors; cookie auth).
  console.log(`ENV:BETA_GATE_UPLOAD_URL=${HUB}/api/namespace/node/${nodeId}/files/`);
  console.log(`ENV:BETA_GATE_CHAT_URL=${HUB}/api/namespace/node/${nodeId}/chat/`);
  console.log(`ENV:BETA_GATE_TENANT=${tenantId}`);
  console.log(`ENV:BETA_GATE_COOKIE=${cookieHeader}`);
  console.log(`ENV:BETA_GATE_NODE=${nodeId}`);
  // Workstream B notebook lane (tests/beta/_notebook_probe.py): same stranger,
  // same cookie; the probe creates its OWN notebook + node through the product
  // contract, so only the Hub base and the session are needed.
  console.log(`ENV:BETA_PROBE_HUB_BASE=${HUB}`);
  console.log(`ENV:BETA_PROBE_COOKIE=${cookieHeader}`);
}

export { cleanup };

// Auto-run only when executed as a script (bun run …); under vitest the module
// is imported and `main`/`cleanup` are driven directly.
const isDirectRun =
  Boolean((import.meta as unknown as { main?: boolean }).main) ||
  /provision-beta-gate\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) {
  const cleanupIdx = process.argv.indexOf("--cleanup");
  const run = cleanupIdx !== -1 ? cleanup(process.argv[cleanupIdx + 1]) : main();
  run.catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
