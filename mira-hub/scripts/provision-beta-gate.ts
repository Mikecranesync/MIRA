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
const SUFFIX = Date.now().toString();
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

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The address every run of this script registers with (CREDS.email). Registration writes it to
// hub_users.email and to tenants.contact_email, so it is what marks a tenant as one of ours.
const THROWAWAY_EMAIL = "^betagate-[0-9]+@factorylm\\.com$";

// Delete every row a provisioned run created for a tenant. Used by the CI job
// (`--cleanup <tenantId>`) so dev Neon doesn't accumulate gate fixtures.
async function cleanup(given: string) {
  return sweep(given, false);
}

// `ownRun`: the id is one this process registered itself, a moment ago (main's self-clean). The run
// is then the proof that the tenant is ours, so the sweep goes ahead even where no user or tenant
// row is found under the id; rows that belong to anyone else are refused either way.
async function sweep(given: string, ownRun: boolean) {
  if (!given) throw new Error("--cleanup requires a tenant id");
  // One spelling of the id for every statement (#5663 review F3). Some of the columns below are
  // uuid and some are text holding a lower-case uuid; an upper-case id matched only the first kind,
  // so part of a tenant went and the proof, which compares text, still counted nothing left.
  const tenantId = given.trim().toLowerCase();
  if (!TENANT_ID.test(tenantId)) throw new Error("--cleanup requires a tenant id in UUID form");
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // One transaction (#5663 review F2): a sweep that fails part-way leaves the tenant whole, so it
    // can be run again and nothing is lost that a later statement was meant to remove with it.
    await c.query("BEGIN");
    try {
      // Only a tenant this script provisioned (#5663 review F2). The id is whatever the caller
      // passed, and one of the tables below is an audit trail (021), so before anything is deleted
      // every user and the data-side tenant row must carry this script's own address.
      const who = (
        await c.query(
          `SELECT (SELECT count(*) FROM hub_users WHERE tenant_id = $1)::int AS users,
                (SELECT count(*) FROM hub_users WHERE tenant_id = $1 AND (lower(email) ~ $2) IS NOT TRUE)::int AS other_users,
                (SELECT count(*) FROM hub_tenants WHERE id = $1)::int AS auth_tenants,
                (SELECT count(*) FROM tenants WHERE id::text = $1)::int AS tenants,
                (SELECT count(*) FROM tenants WHERE id::text = $1 AND (lower(contact_email) ~ $2) IS NOT TRUE)::int AS other_tenants`,
          [tenantId, THROWAWAY_EMAIL],
        )
      ).rows[0] as { users: number; other_users: number; auth_tenants: number; tenants: number; other_tenants: number };
      const none = !who.users && !who.auth_tenants && !who.tenants;
      if (none && !ownRun) {
        // No such tenant (already swept, or never registered): nothing says whose rows any others
        // under this id would be, so none are touched.
        await c.query("ROLLBACK");
        console.error(`no tenant ${tenantId}: nothing to clean, nothing deleted`);
        return;
      }
      if (who.other_users || who.other_tenants || (!none && !(who.users || who.tenants))) {
        throw new Error(`refusing to clean ${tenantId}: it is not a tenant this script provisioned (nothing was deleted)`);
      }
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
        // 021. The node this run creates (step 4, POST /api/namespace/node/) writes one audit row here.
        // It has no foreign key, so nothing removed it: every swept tenant left one behind (#5662).
        "namespace_versions",
        "kg_entities",
      ];
      for (const tbl of tables) {
        // A statement that fails ends the whole transaction unless it is undone to a savepoint.
        await c.query("SAVEPOINT sweep_table");
        try {
          await c.query(`DELETE FROM ${tbl} WHERE tenant_id::text = $1`, [tenantId]);
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== "42P01" && code !== "42703") throw err; // undefined_table / undefined_column
          await c.query("ROLLBACK TO SAVEPOINT sweep_table");
        }
        await c.query("RELEASE SAVEPOINT sweep_table");
      }
      await c.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      // Auth side (users.ts): hub_users.tenant_id REFERENCES hub_tenants(id), and
      // hub_tenants.owner_user_id is a plain TEXT column — so users first, then
      // the tenant. Both keyed on THIS run's tenant id only.
      await c.query(`DELETE FROM hub_users WHERE tenant_id = $1`, [tenantId]);
      await c.query(`DELETE FROM hub_tenants WHERE id = $1`, [tenantId]);
      await c.query("COMMIT");
    } catch (err) {
      // Undo everything. The first failure is the one reported, whatever the undo itself does.
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    await c.end();
  }
  // Proof, not observation: the run's auth + data rows must be GONE.
  const left = await (async () => {
    const c2 = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c2.connect();
    try {
      const count = (audit: boolean) =>
        c2.query(
          `SELECT (SELECT count(*) FROM hub_users WHERE tenant_id = $1)::int AS users,
                (SELECT count(*) FROM hub_tenants WHERE id = $1)::int AS auth_tenants,
                (SELECT count(*) FROM tenants WHERE id::text = $1)::int AS tenants${
                  audit ? `,
                (SELECT count(*) FROM namespace_versions WHERE tenant_id::text = $1)::int AS namespace_versions` : ""
                }`,
          [tenantId],
        );
      let r;
      try {
        r = await count(true);
      } catch (err) {
        // A database older than 021 has no audit table, so it holds no audit rows: count the other
        // three without it. Only "no such table" is read that way; if one of the other three is the
        // table that is missing, the second count fails too and the sweep is not called clean.
        if ((err as { code?: string }).code !== "42P01") throw err;
        r = await count(false);
      }
      return r.rows[0] as { users: number; auth_tenants: number; tenants: number; namespace_versions?: number };
    } finally {
      await c2.end();
    }
  })();
  if (left.users || left.auth_tenants || left.tenants || left.namespace_versions) {
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

export async function main() {
  // 1. Register a fresh stranger tenant (auth side: hub_tenants).
  const reg = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDS),
  });
  const regJson = (await reg.json().catch(() => ({}))) as { tenantId?: string };
  if (reg.status !== 201 || !regJson.tenantId) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(regJson)}`);
  }
  const tenantId = regJson.tenantId;
  console.error(`registered tenant ${tenantId}`);

  // From here a tenant EXISTS. If anything below fails, the workflow never
  // receives BETA_GATE_TENANT and no job could sweep it — so the provisioner
  // sweeps its own registration before re-throwing (ENV lines are emitted only
  // on full success, at the very end).
  try {
    await provisionAfterRegister(tenantId);
  } catch (e) {
    console.error(`provisioning failed after registration — sweeping tenant ${tenantId}`);
    try {
      await sweep(tenantId, true);
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

async function provisionAfterRegister(tenantId: string) {
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

  // 3. Mint the next-auth session cookie (csrf → credentials callback).
  const csrfRes = await fetch(`${HUB}/api/auth/csrf/`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const form = new URLSearchParams();
  form.set("email", CREDS.email);
  form.set("password", CREDS.password);
  form.set("csrfToken", csrfToken);
  form.set("redirect", "false");
  form.set("json", "true");
  form.set("callbackUrl", HUB);
  const signIn = await fetch(`${HUB}/api/auth/callback/credentials/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie1 },
    body: form.toString(),
    redirect: "manual",
  });
  const sessionToken = extractSession([cookie1, signIn.headers.get("set-cookie") ?? ""].join(", "));
  if (!sessionToken) throw new Error(`no session cookie (signin ${signIn.status})`);
  const cookieHeader = `next-auth.session-token=${sessionToken}`;
  console.error(`minted session cookie (signin ${signIn.status})`);
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
