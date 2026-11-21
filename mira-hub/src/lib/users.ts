import pool from "@/lib/db";
import type { Pool, PoolClient } from "pg";
import { assertAuthMigrationReady } from "@/capabilities/auth-schema";
import type { OnboardingReceipt } from "@/capabilities/verified-onboarding";
import { PILOT_WINDOW_DAYS } from "@/lib/config";
import { magicTokenTtlMinutes } from "@/capabilities/trial-access";
import { admitPilotInvite, isPilotApprovalRequired } from "@/capabilities/pilot-access";
import { publicSignupPolicy, type SignupIntent } from "@/capabilities/free-technician-signup";
import { claimVerifiedEmail, CredentialReviewRequiredError, EmailVerificationRequiredError } from "@/capabilities/verified-identity";
import { assertTeamInvitesAllowed } from "@/capabilities/free-workspace";

export type UserStatus = "pending" | "trial" | "approved" | "expired" | "admin";

export interface HubUser {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  tenantId: string;
  name: string | null;
  role: string;
  status: UserStatus;
  trialExpiresAt: Date | null;
  plan: string | null;
  preferences: Record<string, unknown>;
  credentialEpoch?: number;
  emailVerifiedAt?: Date | null;
  passwordProvenance?: string;
}

export interface MagicTokenResult {
  email: string;
  tenantId: string | null;
  role: string | null;
  invitedBy: string | null;
  purpose: string;
  onboarding: OnboardingReceipt | null;
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await assertAuthMigrationReady();
    // #4362: the trial account IS the 30-day pilot. Stretch any still-short window
    // (the old 7-day default caused the day-8 lockout) up to created_at + 30 days.
    // Already-longer or already-elapsed 30-day clocks are left alone.
    // #4878: a pilot-active tenant's crew expiry tracks the ORG's
    // pilot_expires_at (set once at approval), not created_at + 30d. Without
    // excluding pilot tenants, this backfill — which re-runs on every
    // process boot — would stretch a crew member invited on pilot day 10
    // from (approved + 30d) back out to (created_at + 30d), silently undoing
    // "crew follow the organization" on the next deploy.
    //
    // This runs on EVERY boot in EVERY environment regardless of the flag, so
    // the exclusion clause (which reads hub_tenants.pilot_status) is only
    // added when the flag is on — a deploy that reaches a pilot-approval-off
    // environment where migration 107 hasn't landed yet must not 500 every
    // signup/login by querying a column that may not exist there yet.
    await pool.query(
      isPilotApprovalRequired()
        ? `UPDATE hub_users
       SET trial_expires_at = created_at + ($1::int * INTERVAL '1 day')
       WHERE status = 'trial'
         AND (
           trial_expires_at IS NULL
           OR trial_expires_at < created_at + ($1::int * INTERVAL '1 day')
         )
         AND NOT EXISTS (
           SELECT 1 FROM hub_tenants t
           WHERE t.id = hub_users.tenant_id AND t.pilot_status IS NOT NULL
         )`
        : `UPDATE hub_users
       SET trial_expires_at = created_at + ($1::int * INTERVAL '1 day')
       WHERE status = 'trial'
         AND (
           trial_expires_at IS NULL
           OR trial_expires_at < created_at + ($1::int * INTERVAL '1 day')
         )`,
      [PILOT_WINDOW_DAYS],
    );
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

function rowToUser(r: Record<string, unknown>): HubUser {
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: (r.password_hash as string) ?? null,
    googleSub: (r.google_sub as string) ?? null,
    tenantId: String(r.tenant_id),
    name: (r.name as string) ?? null,
    // hub_users.role is NOT NULL DEFAULT 'owner' (signup creator). A row that
    // somehow lacks it maps to "" — least privilege — never to owner (#2360).
    role: typeof r.role === "string" ? r.role : "",
    status: (r.status as UserStatus) ?? "trial",
    trialExpiresAt: r.trial_expires_at ? new Date(r.trial_expires_at as string) : null,
    plan: (r.plan as string) ?? null,
    preferences: (r.preferences as Record<string, unknown>) ?? {},
    credentialEpoch: Number(r.credential_epoch ?? 0),
    emailVerifiedAt: r.email_verified_at ? new Date(String(r.email_verified_at)) : null,
    passwordProvenance: String(r.password_provenance ?? 'unknown'),
  };
}

const USER_COLS = "id, email, password_hash, google_sub, tenant_id, name, role, status, trial_expires_at, plan, preferences, credential_epoch, email_verified_at, password_provenance";

export async function findUserByEmail(email: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1`,
    [email],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM hub_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function listAllUsers(): Promise<HubUser[]> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, created_at FROM hub_users ORDER BY created_at DESC`,
  );
  return rows.map(rowToUser);
}

// Synthetic accounts created by Playwright probes, e2e suites, and DB canaries.
// They pollute the admin user list (Hub QA 2026-05-28 #8). The admin route hides
// them by default and exposes them via ?includeSystem=1, so nothing is lost — the
// classifier only decides default visibility, never deletes.
const SYSTEM_ACCOUNT_EMAIL_PATTERNS: RegExp[] = [
  /playwright/i, // playwright-probe@…, playwright@…
  /\be2e[-_]/i, // e2e-trial-*, e2e_audit@…
  /(^|[-_.+])test[-_.@]/i, // drawer-test-*, *-test@, +test@
  /\bprobe\b/i, // *-probe@…
  // Disposable prod-verification accounts (mobile notebook loop, adversarial
  // suite). Deleted periodically by qa-cleanup.yml; hidden here meanwhile.
  /^(notebook-qa-|notebook-live-|adversarial-)/i,
];
const SYSTEM_ACCOUNT_NAME_PATTERNS: RegExp[] = [
  /\bplaywright\b/i,
  /\be2e\b/i,
  /^neondb proof$/i,
  /^e2e audit$/i,
];

export function isSystemAccount(user: { email: string; name: string | null }): boolean {
  if (SYSTEM_ACCOUNT_EMAIL_PATTERNS.some((re) => re.test(user.email ?? ""))) return true;
  const name = user.name ?? "";
  return name !== "" && SYSTEM_ACCOUNT_NAME_PATTERNS.some((re) => re.test(name));
}

export async function updateUserStatus(id: string, status: UserStatus): Promise<void> {
  await ensureSchema();
  await pool.query(
    `UPDATE hub_users SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );
}

// ── Magic link tokens ──────────────────────────────────────────

let magicSchemaReady: Promise<void> | null = null;

function ensureMagicSchema(): Promise<void> {
  if (magicSchemaReady) return magicSchemaReady;
  magicSchemaReady = (async () => {
    await ensureSchema();
  })().catch(error => { magicSchemaReady = null; throw error; });
  return magicSchemaReady;
}

export async function createMagicToken(
  email: string,
  opts: { tenantId?: string; role?: string; invitedBy?: string; onboarding?: OnboardingReceipt } = {},
): Promise<string> {
  await ensureMagicSchema();
  const { randomUUID } = await import("crypto");
  const token = randomUUID();
  const kind = opts.tenantId ? "invite" : "login";
  const ttlMinutes = magicTokenTtlMinutes(kind);
  await pool.query(
    `INSERT INTO hub_magic_tokens (token, email, tenant_id, role, invited_by, expires_at, purpose, onboarding)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * INTERVAL '1 minute'), $7, $8::jsonb)
     ON CONFLICT (token) DO NOTHING`,
    [
      token,
      email.toLowerCase(),
      opts.tenantId ?? null,
      opts.role ?? null,
      opts.invitedBy ?? null,
      ttlMinutes,
      opts.tenantId ? "invite" : opts.onboarding ? "onboarding" : "login",
      opts.onboarding ? JSON.stringify(opts.onboarding) : null,
    ],
  );
  return token;
}

export async function validateMagicToken(token: string): Promise<MagicTokenResult | null> {
  await ensureMagicSchema();
  const { rows } = await pool.query(
    `UPDATE hub_magic_tokens
     SET used_at = NOW()
     WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL
     RETURNING email, tenant_id, role, invited_by, purpose, onboarding`,
    [token],
  );
  return rows[0]
    ? {
        email: String(rows[0].email),
        tenantId: rows[0].tenant_id ? String(rows[0].tenant_id) : null,
        role: rows[0].role ? String(rows[0].role) : null,
        invitedBy: rows[0].invited_by ? String(rows[0].invited_by) : null,
        purpose: String(rows[0].purpose ?? "login"),
        onboarding: (rows[0].onboarding as OnboardingReceipt) ?? null,
      }
    : null;
}

/** Non-consuming check: the token's address belongs to a row whose password has
 * unknown provenance, so redemption must refuse WITHOUT spending the token (F28). */
export async function magicTokenNeedsCredentialReview(token: string): Promise<boolean> {
  await ensureMagicSchema();
  const result = await pool.query(
    `SELECT 1 FROM hub_magic_tokens t JOIN hub_users u ON u.email_lower = LOWER(t.email)
     WHERE t.token=$1 AND t.expires_at>NOW() AND t.used_at IS NULL
       AND u.password_hash IS NOT NULL
       AND u.password_provenance NOT IN ('public_unverified','operator','verified')
     LIMIT 1`,
    [token],
  );
  return Boolean(result.rows[0]);
}

export async function magicTokenPurpose(token: string): Promise<string | null> {
  await ensureMagicSchema();
  const result = await pool.query("SELECT purpose FROM hub_magic_tokens WHERE token=$1 AND expires_at>NOW() AND used_at IS NULL",[token]);
  return result.rows[0] ? String(result.rows[0].purpose) : null;
}

export interface EnsureUserAndTenantInput {
  email: string;
  googleSub?: string;
  name?: string;
  passwordHash?: string;
  signupIntent?: SignupIntent;
  /** Internal proof from a consumed email token or verified identity provider. Never accepted from registration JSON. */
  verifiedEmail?: boolean;
}

export async function ensureUserAndTenant(
  input: EnsureUserAndTenantInput,
): Promise<{ id: string; tenantId: string; email: string }> {
  await ensureSchema();

  if (input.googleSub) {
    const { rows } = await pool.query(
      `SELECT id, email, tenant_id FROM hub_users WHERE google_sub = $1 LIMIT 1`,
      [input.googleSub],
    );
    if (rows[0]) {
      // Authenticating through an ALREADY-linked Google subject is not a new claim
      // on the row (Codex F24): an unknown-provenance password stays untouched and
      // isolated, and this returning sign-in still works. A NEW subject reaching the
      // same row by email (below) still requires operator review.
      // Codex F27: only claim the mailbox Google just verified. If the stored
      // address differs (renamed account), sign in without stamping the old one.
      const sameAddress = String(rows[0].email).trim().toLowerCase() === input.email.trim().toLowerCase();
      if (input.verifiedEmail && sameAddress) {
        try {
          await claimVerifiedEmail(pool, String(rows[0].id));
        } catch (err) {
          if (!(err instanceof CredentialReviewRequiredError)) throw err;
        }
      }
      return { id: String(rows[0].id), tenantId: String(rows[0].tenant_id), email: String(rows[0].email) };
    }
  }

  const existingByEmail = await findUserByEmail(input.email);
  if (existingByEmail) {
    if (input.verifiedEmail) await claimVerifiedEmail(pool, existingByEmail.id);
    if (input.googleSub && !existingByEmail.googleSub) {
      await pool.query(
        `UPDATE hub_users SET google_sub = $1, updated_at = NOW() WHERE id = $2`,
        [input.googleSub, existingByEmail.id],
      );
    }
    return { id: existingByEmail.id, tenantId: existingByEmail.tenantId, email: existingByEmail.email };
  }

  const policy = publicSignupPolicy(input.signupIntent);
  if (policy.kind === "free_technician") {
    throw new EmailVerificationRequiredError();
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantName = input.name?.trim() || input.email;
    const {
      rows: [tenant],
    } = await client.query(
      `INSERT INTO hub_tenants (name) VALUES ($1) RETURNING id`,
      [tenantName],
    );
    const tenantId = String(tenant.id);
    // #1899b: the data-side `tenants` table (FK target of knowledge_entries.tenant_id)
    // is separate from auth-side hub_tenants. Mirror the new tenant id here in the same
    // transaction, so this tenant's first manual/document upload doesn't 23503 on
    // knowledge_entries_tenant_id_fkey ("Server storage error" / folder-upload 500).
    // tenants.name + contact_email are NOT NULL (no default); everything else defaults.
    await client.query(
      `INSERT INTO tenants (id, name, contact_email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, tenantName, input.email],
    );
    // #4878: approval-required pilot access, behind MIRA_PILOT_APPROVAL_REQUIRED
    // (default off — flag off is this block's `else`, byte-for-byte the prior
    // query). On: the new owner is 'pending' with no trial clock running yet
    // (the admin approve route starts it), and the tenant is marked a pilot
    // applicant so the admin cohort view can find it.
    const pilotMode = policy.kind === "pilot_application";
    const {
      rows: [user],
    } = await client.query(
      pilotMode
        ? `INSERT INTO hub_users (email, password_hash, google_sub, tenant_id, name, status, trial_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NULL)
       RETURNING id, email`
        : `INSERT INTO hub_users (email, password_hash, google_sub, tenant_id, name, status, trial_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'trial', NOW() + ($6::int * INTERVAL '1 day'))
       RETURNING id, email`,
      pilotMode
        ? [input.email, input.passwordHash ?? null, input.googleSub ?? null, tenantId, input.name ?? null]
        : [input.email, input.passwordHash ?? null, input.googleSub ?? null, tenantId, input.name ?? null, PILOT_WINDOW_DAYS],
    );
    if (pilotMode) {
      await client.query(`UPDATE hub_tenants SET pilot_status = 'pending' WHERE id = $1`, [tenantId]);
    }
    await client.query("UPDATE hub_users SET password_provenance=$2,email_verified_at=CASE WHEN $3::boolean THEN NOW() ELSE NULL END WHERE id=$1",[String(user.id),input.passwordHash ? (input.verifiedEmail ? "verified" : "public_unverified") : "none",Boolean(input.verifiedEmail)]);
    await client.query(
      `UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`,
      [String(user.id), tenantId],
    );
    await client.query("COMMIT");
    return { id: String(user.id), tenantId, email: String(user.email) };
  } catch (err) {
    await client.query("ROLLBACK");
    const conflict = await findUserByEmail(input.email);
    if (conflict) {
      if (input.verifiedEmail) await claimVerifiedEmail(pool, conflict.id);
      return { id: conflict.id, tenantId: conflict.tenantId, email: conflict.email };
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureInvitedUser(input: {
  email: string;
  tenantId: string;
  role: string;
}): Promise<{ id: string; tenantId: string; email: string }> {
  await ensureSchema();
  const email = input.email.trim().toLowerCase();
  const role = input.role.trim() || "technician";
  await assertTeamInvitesAllowed(pool, input.tenantId);

  // Flag off: the exact pre-#4878 code path — no transaction, no pilot_*
  // query, zero overhead, and safe in any environment migration 107 hasn't
  // reached yet.
  if (!isPilotApprovalRequired()) {
    const existing = await findUserByEmail(email);
    if (existing) {
      if (existing.tenantId !== input.tenantId) {
        throw new Error("email already belongs to another workspace");
      }
      // Codex F28: establish the identity BEFORE changing access. An
      // unknown-provenance password throws here, so role/status stay unchanged.
      await claimVerifiedEmail(pool, existing.id);
      await pool.query(
        `UPDATE hub_users
         SET role = $1,
             status = CASE WHEN status = 'admin' THEN status ELSE 'approved' END,
             updated_at = NOW()
         WHERE id = $2`,
        [role, existing.id],
      );
      return { id: existing.id, tenantId: existing.tenantId, email: existing.email };
    }
    const { rows } = await pool.query(
      `INSERT INTO hub_users (email, tenant_id, name, role, status)
       VALUES ($1, $2, NULL, $3, 'approved')
       RETURNING id, email, tenant_id`,
      [email, input.tenantId, role],
    );
    return {
      id: String(rows[0].id),
      tenantId: String(rows[0].tenant_id),
      email: String(rows[0].email),
    };
  }

  // #4878 pilot mode (Codex #4664 F1/F2, review round 1): the admission
  // decision and the hub_users write happen inside ONE transaction, under
  // the SAME tenant-scoped lock `endPilotTenant` takes — a redemption can't
  // race a termination and act on a stale 'active' snapshot (F1), and a
  // token with no reservation on record is capacity-checked right now, not
  // trusted on faith (F2). `admitPilotInvite` throws `PilotTenantNotActiveError`
  // for a pending/ended tenant and `PilotSeatCapError` at capacity; both
  // propagate to the caller (the magic-token credentials provider in
  // auth.ts), so neither redemption creates or restores access.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await applyInviteOnClient(client, email, input.tenantId, role, true);
    await client.query("COMMIT");
    return account;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The invite's admission, identity claim and membership write, on a client the
 * caller has already put in a transaction. Nothing here commits. */
async function applyInviteOnClient(
  client: PoolClient,
  email: string,
  tenantId: string,
  role: string,
  pilotMode: boolean,
): Promise<{ id: string; tenantId: string; email: string }> {
  const admission = pilotMode ? await admitPilotInvite(client, tenantId, email) : null;
  const pilotActive = Boolean(admission?.isPilotTenant);

  const { rows: existingRows } = await client.query(
    `SELECT id, tenant_id, email FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1 FOR UPDATE`,
    [email],
  );
  const existing = existingRows[0] as { id: string; tenant_id: string; email: string } | undefined;

  if (existing) {
    if (String(existing.tenant_id) !== tenantId) {
      throw new Error("email already belongs to another workspace");
    }
    // Codex F28: identity claim in the SAME transaction as the access change;
    // a rejection rolls back role, status, deadline and reservation together.
    await claimVerifiedEmail(client, String(existing.id));
    await client.query(
      pilotActive
        ? `UPDATE hub_users
         SET role = $1,
             status = CASE WHEN status = 'admin' THEN status ELSE 'trial' END,
             trial_expires_at = CASE WHEN status = 'admin' THEN trial_expires_at ELSE $3 END,
             updated_at = NOW()
         WHERE id = $2`
        : `UPDATE hub_users
         SET role = $1,
             status = CASE WHEN status = 'admin' THEN status ELSE 'approved' END,
             updated_at = NOW()
         WHERE id = $2`,
      pilotActive ? [role, existing.id, admission!.pilotExpiresAt] : [role, existing.id],
    );
    return { id: String(existing.id), tenantId: String(existing.tenant_id), email: String(existing.email) };
  }

  const { rows } = await client.query(
    pilotActive
      ? `INSERT INTO hub_users (email, tenant_id, name, role, status, trial_expires_at)
       VALUES ($1, $2, NULL, $3, 'trial', $4)
       RETURNING id, email, tenant_id`
      : `INSERT INTO hub_users (email, tenant_id, name, role, status)
       VALUES ($1, $2, NULL, $3, 'approved')
       RETURNING id, email, tenant_id`,
    pilotActive ? [email, tenantId, role, admission!.pilotExpiresAt] : [email, tenantId, role],
  );
  if (pilotActive) {
    // Inlined (not the pool-based redeemPilotSeat helper): this MUST run
    // on `client`, inside the same transaction/lock admitPilotInvite used,
    // or the reservation and the membership row could commit on different
    // snapshots. Idempotent no-op if no matching pending row exists.
    await client.query(
      `UPDATE pilot_seat_reservations
         SET status = 'redeemed', redeemed_at = NOW()
         WHERE tenant_id = $1 AND email_lower = $2 AND status = 'pending'`,
      [tenantId, email],
    );
  }
  return { id: String(rows[0].id), tenantId: String(rows[0].tenant_id), email: String(rows[0].email) };
}

/** Everything a session is minted from, read as ONE row snapshot (Codex F34):
 * workspace and credential epoch can never come from two different reads. */
export interface SessionSnapshot {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  status: string;
  credentialEpoch: number;
  trialExpiresAt: string | null;
}

export async function readSessionSnapshot(db: Pick<Pool, "query">, userId: string): Promise<SessionSnapshot | null> {
  const { rows } = await db.query(
    `SELECT id, email, name, tenant_id, status, credential_epoch, trial_expires_at FROM hub_users WHERE id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    email: String(r.email),
    name: r.name == null ? null : String(r.name),
    tenantId: String(r.tenant_id),
    status: String(r.status ?? "trial"),
    credentialEpoch: Number(r.credential_epoch ?? 0),
    trialExpiresAt: r.trial_expires_at ? new Date(r.trial_expires_at).toISOString() : null,
  };
}

/** Invite redemption as ONE transaction (Codex F28): lock the unused token,
 * admit, claim the identity, change membership, then spend the token. Any
 * refusal rolls all of it back, so the token stays usable and access is
 * unchanged. Returns `undefined` for a token that is not an invitation. */
export async function redeemInviteToken(token: string): Promise<SessionSnapshot | null | undefined> {
  await ensureSchema();
  await ensureMagicSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT email, tenant_id, role FROM hub_magic_tokens
       WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL FOR UPDATE`,
      [token],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    if (!rows[0].tenant_id) {
      await client.query("ROLLBACK");
      return undefined;
    }
    const tenantId = String(rows[0].tenant_id);
    const role = String(rows[0].role ?? "").trim() || "technician";
    await assertTeamInvitesAllowed(client, tenantId);
    const account = await applyInviteOnClient(
      client,
      String(rows[0].email).trim().toLowerCase(),
      tenantId,
      role,
      isPilotApprovalRequired(),
    );
    await client.query("UPDATE hub_magic_tokens SET used_at = NOW() WHERE token = $1", [token]);
    // Codex F34/F35: the session is built from this in-transaction snapshot, so
    // nothing after COMMIT can strand the spent link or mix two reads.
    const snapshot = await readSessionSnapshot(client, account.id);
    if (!snapshot) throw new Error("invited account vanished inside its own transaction");
    await client.query("COMMIT");
    return snapshot;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof CredentialReviewRequiredError) return null;
    throw err;
  } finally {
    client.release();
  }
}

// ── User preferences ─────────────────────────────────────────

export async function getUserPreferences(userId: string): Promise<Record<string, unknown>> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT preferences FROM hub_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? {};
}

export async function setUserPreferences(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE hub_users
     SET preferences = preferences || $1::jsonb, updated_at = NOW()
     WHERE id = $2
     RETURNING preferences`,
    [JSON.stringify(patch), userId],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? {};
}
