#!/usr/bin/env node
/**
 * provision_subordinate.mjs — add ONE subordinate user to an EXISTING Hub tenant.
 *
 * The durable, human-run replacement for the not-yet-built "Invite" feature (the
 * Settings → Users invite button is disabled, "coming soon"; there is no
 * POST /api/team). It inserts a single `hub_users` row pointing at the owner's
 * tenant, so the new account logs into app.factorylm.com as a member of the
 * owner's factory workspace (RLS scopes it to the same data). Modeled on
 * mira-hub/scripts/seed-synthetic-users.ts; matches the schema in
 * mira-hub/src/lib/users.ts (cols: email, password_hash, tenant_id, name, role,
 * status, trial_expires_at). Idempotent via ON CONFLICT (email_lower).
 *
 * ── ENVIRONMENT DOCTRINE ────────────────────────────────────────────────────
 * Run this YOURSELF (a human), staging FIRST, then prod. Never from a code
 * session, never raw psql. It writes to whatever NEON_DATABASE_URL the Doppler
 * config points at, so pick the config deliberately:
 *
 *   # 1) prod (or staging) — let it resolve your tenant from your Hub login email:
 *   doppler run --project factorylm --config prd -- \
 *     node tools/crew/provision_subordinate.mjs \
 *       --owner-email 'harperhousebuyers@gmail.com' \
 *       --email 'harperhousebuyers+carlos@gmail.com' \
 *       --name 'Carlos Mendez' --role technician
 *
 * The preflight prints the resolved tenant + owner BEFORE inserting, and refuses
 * if nothing matches — so a typo can't write to the wrong place.
 *
 * Tenant selection (first that is set wins): --tenant <uuid>  >  CREW_TENANT_ID
 *   >  --owner-email <your Hub login>  >  CREW_OWNER_EMAIL. The owner-email form
 *   needs no UUID hunting; it is NOT the string 'mike'.
 * Required env (from Doppler): NEON_DATABASE_URL.
 * Password: pass --password, or set CREW_SUBORDINATE_PASSWORD, else a strong
 *   random one is generated and PRINTED ONCE (store it in Doppler, never git).
 *
 * Run from the repo root; pg + bcryptjs are resolved from mira-hub/node_modules
 * (nothing new is installed), the same trick tools/qa/lib.mjs uses.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Resolve pg + bcryptjs from mira-hub's node_modules regardless of CWD.
const hubRequire = createRequire(join(REPO_ROOT, "mira-hub", "node_modules", "noop.js"));
const { Pool } = hubRequire("pg");
const bcrypt = hubRequire("bcryptjs");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

const email = arg("email");
const name = arg("name") ?? email;
const role = arg("role") ?? "technician";
// Tenant can be given directly (--tenant / CREW_TENANT_ID), or looked up from the
// owner's email (--owner-email) so you never have to hunt down the UUID by hand.
const tenantArg = arg("tenant") ?? process.env.CREW_TENANT_ID;
const ownerEmail = arg("owner-email") ?? process.env.CREW_OWNER_EMAIL;
const passwordExplicit = arg("password") ?? process.env.CREW_SUBORDINATE_PASSWORD;
const password = passwordExplicit ?? randomBytes(12).toString("base64url");
const dbUrl = process.env.NEON_DATABASE_URL;

if (!email) die("--email is required (e.g. harperhousebuyers+carlos@gmail.com)");
if (!tenantArg && !ownerEmail) {
  die("provide --tenant <uuid> (or CREW_TENANT_ID), or --owner-email <your Hub login> to auto-resolve it");
}
if (!dbUrl) die("NEON_DATABASE_URL is required — run under `doppler run ... --`");

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  // Resolve the tenant by the owner's email when no UUID was given.
  let tenantId = tenantArg;
  if (!tenantId) {
    const { rows } = await pool.query(
      `SELECT tenant_id FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1`,
      [ownerEmail],
    );
    if (!rows[0]) die(`no Hub user found for owner-email '${ownerEmail}' in this env — wrong email or wrong --config?`);
    tenantId = String(rows[0].tenant_id);
    console.log(`Resolved tenant from owner ${ownerEmail}: ${tenantId}`);
  }

  // Preflight: confirm the target tenant exists and show whose it is, so a typo
  // can't silently create an orphan / cross-tenant account.
  const { rows: tRows } = await pool.query(
    `SELECT t.id, t.name, u.email AS owner_email
       FROM hub_tenants t
       LEFT JOIN hub_users u ON u.id = t.owner_user_id
      WHERE t.id = $1`,
    [tenantId],
  );
  if (!tRows[0]) die(`tenant ${tenantId} not found in hub_tenants — wrong CREW_TENANT_ID or wrong env?`);
  console.log(`Target tenant: ${tRows[0].id}  (name="${tRows[0].name}", owner=${tRows[0].owner_email ?? "?"})`);

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows } = await pool.query(
    `INSERT INTO hub_users (email, password_hash, tenant_id, name, role, status, trial_expires_at)
     VALUES ($1, $2, $3, $4, $5, 'approved', NOW() + INTERVAL '10 years')
     ON CONFLICT (email_lower) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       tenant_id     = EXCLUDED.tenant_id,
       name          = EXCLUDED.name,
       role          = EXCLUDED.role,
       status        = 'approved',
       updated_at    = NOW()
     RETURNING id, email, tenant_id, role, status`,
    [email, passwordHash, tenantId, name, role],
  );

  const u = rows[0];
  console.log(`✓ subordinate ready: ${u.email}  (role=${u.role}, status=${u.status}, tenant=${u.tenant_id})`);
  if (!passwordExplicit) {
    const slug = String(name).split(" ")[0].toUpperCase();
    console.log(`\n  GENERATED PASSWORD (store in Doppler as CREW_PW_${slug}; shown once):`);
    console.log(`    ${password}\n`);
  }
  console.log("Next: log in at https://app.factorylm.com with this email + password and confirm you see the owner's factory data.");
} finally {
  await pool.end();
}
