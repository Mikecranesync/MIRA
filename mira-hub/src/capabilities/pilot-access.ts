import pool from "@/lib/db";
import { PILOT_COHORT_MAX_ORGS, PILOT_SEAT_MAX_USERS, PILOT_WINDOW_DAYS } from "@/lib/config";

/**
 * Approval-required pilot access (#4878) + the concurrency-safe 5-seat cap
 * fix for Codex #4664 findings F1/F2/F4 (#4768).
 *
 * Entirely gated by `MIRA_PILOT_APPROVAL_REQUIRED` (default OFF — see
 * `isPilotApprovalRequired`). Every function here that reads or writes a
 * `pilot_*` column or `pilot_seat_reservations` is only reachable once a
 * caller has already checked the flag (signup, the admin approve/end
 * routes) or is gated on `hub_tenants.pilot_status` itself (seat reservation,
 * crew expiry) — so with the flag off, or for a tenant that was never
 * approved into the pilot, nothing here runs a query against columns that
 * may not exist yet in an environment this migration hasn't reached.
 *
 * F1 — check-and-reserve inside one transaction, under a tenant-scoped
 *      `pg_advisory_xact_lock`: two concurrent invites can't both observe
 *      the same pre-insert seat count.
 * F2 — "is this tenant a pilot" is read from `hub_tenants.pilot_status`
 *      (durable), never derived from an ephemeral `hub_users.status='trial'`
 *      row that a status change could erase.
 * F4 — `pilot_seat_reservations` has `UNIQUE (tenant_id, email_lower)`, so
 *      resending an invite to the same pending email finds the existing row
 *      instead of reserving a second seat.
 * Reservation rows are never deleted — redeeming an invite transitions
 * `status` from `pending` to `redeemed` in place, so "redeeming an invite
 * never frees a seat, even temporarily" is true by construction.
 */

export function isPilotApprovalRequired(): boolean {
  return process.env.MIRA_PILOT_APPROVAL_REQUIRED === "1";
}

export class PilotSeatCapError extends Error {
  readonly maxUsers: number;
  constructor(maxUsers: number = PILOT_SEAT_MAX_USERS) {
    super(
      `This pilot organization is limited to ${maxUsers} users. A new invite cannot be sent until a seat is free.`,
    );
    this.name = "PilotSeatCapError";
    this.maxUsers = maxUsers;
  }
}

export class PilotCohortCapError extends Error {
  readonly maxOrgs: number;
  constructor(maxOrgs: number = PILOT_COHORT_MAX_ORGS) {
    super(`The pilot cohort is limited to ${maxOrgs} approved organizations.`);
    this.name = "PilotCohortCapError";
    this.maxOrgs = maxOrgs;
  }
}

export class PilotTenantNotFoundError extends Error {
  constructor() {
    super("Tenant not found or has no owner.");
    this.name = "PilotTenantNotFoundError";
  }
}

/** No automatic renewal (owner decision, #4362 and #4878) — an ended pilot
 *  tenant is not re-approved by this route. */
export class PilotCohortRenewalError extends Error {
  constructor() {
    super(
      "This tenant's pilot has already ended. Renewal is a manual decision, not a re-approval.",
    );
    this.name = "PilotCohortRenewalError";
  }
}

export interface PilotTenantRecord {
  id: string;
  pilotStatus: string;
  pilotApprovedAt: string | null;
  pilotExpiresAt: string | null;
  pilotApprovedBy: string | null;
}

function mapPilotTenantRow(row: Record<string, unknown>): PilotTenantRecord {
  return {
    id: String(row.id),
    pilotStatus: String(row.pilot_status),
    pilotApprovedAt: row.pilot_approved_at
      ? new Date(row.pilot_approved_at as string).toISOString()
      : null,
    pilotExpiresAt: row.pilot_expires_at
      ? new Date(row.pilot_expires_at as string).toISOString()
      : null,
    pilotApprovedBy: row.pilot_approved_by ? String(row.pilot_approved_by) : null,
  };
}

// Fixed, arbitrary, distinct advisory-lock keys — one for the 5-org cohort
// decision (approve/end serialize against every other approval), one
// namespace for the per-tenant seat lock (reservations serialize only within
// the same tenant; a hashtext collision between two different tenants only
// ever over-serializes, never under-serializes).
const PILOT_COHORT_LOCK_KEY = 778899001;
const PILOT_SEAT_LOCK_NAMESPACE = 778899002;

export interface PilotApproveResult {
  status: "activated" | "already_active";
  tenant: PilotTenantRecord;
}

/**
 * Admin approval of a pilot tenant. One transaction, holding
 * `pg_advisory_xact_lock(PILOT_COHORT_LOCK_KEY)` for the whole decision, so
 * two concurrent approvals with 4 orgs already active resolve to exactly one
 * winner. Approving an already-active tenant is a no-op (does not extend the
 * date). Approving an `ended` tenant is rejected — no automatic renewal.
 */
export async function approvePilotTenant(
  tenantId: string,
  adminUserId: string,
): Promise<PilotApproveResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [PILOT_COHORT_LOCK_KEY]);

    const { rows } = await client.query(
      `SELECT id, owner_user_id, pilot_status, pilot_approved_at, pilot_expires_at, pilot_approved_by
       FROM hub_tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const tenant = rows[0] as Record<string, unknown> | undefined;
    if (!tenant || !tenant.owner_user_id) {
      throw new PilotTenantNotFoundError();
    }
    if (tenant.pilot_status === "active") {
      await client.query("COMMIT");
      return { status: "already_active", tenant: mapPilotTenantRow(tenant) };
    }
    if (tenant.pilot_status === "ended") {
      throw new PilotCohortRenewalError();
    }

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM hub_tenants WHERE pilot_status = 'active'`,
    );
    if (Number((countRows[0] as { n: number } | undefined)?.n ?? 0) >= PILOT_COHORT_MAX_ORGS) {
      throw new PilotCohortCapError();
    }

    const { rows: updated } = await client.query(
      `UPDATE hub_tenants
       SET pilot_status = 'active',
           pilot_approved_at = NOW(),
           pilot_expires_at = NOW() + ($2::int * INTERVAL '1 day'),
           pilot_approved_by = $3
       WHERE id = $1
       RETURNING id, pilot_status, pilot_approved_at, pilot_expires_at, pilot_approved_by`,
      [tenantId, PILOT_WINDOW_DAYS, adminUserId],
    );
    const tenantRow = updated[0] as Record<string, unknown>;

    // Owner follows the org onto the pilot window. Admin carve-out matches
    // the existing ensureInvitedUser pattern (users.ts) — never downgrade a
    // platform admin's own account.
    await client.query(
      `UPDATE hub_users
       SET status = 'trial', trial_expires_at = $2, updated_at = NOW()
       WHERE id = $1 AND status <> 'admin'`,
      [tenant.owner_user_id, tenantRow.pilot_expires_at],
    );

    await client.query("COMMIT");
    return { status: "activated", tenant: mapPilotTenantRow(tenantRow) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Admin ends a pilot tenant: `pilot_status='ended'` and every non-admin user
 *  in the tenant moves to `expired`. No-op (returns `ended: false`) if the
 *  tenant isn't currently `active`. */
export async function endPilotTenant(tenantId: string): Promise<{ ended: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE hub_tenants SET pilot_status = 'ended' WHERE id = $1 AND pilot_status = 'active'
       RETURNING id`,
      [tenantId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ended: false };
    }
    await client.query(
      `UPDATE hub_users SET status = 'expired', updated_at = NOW()
       WHERE tenant_id = $1 AND status <> 'admin'`,
      [tenantId],
    );
    await client.query("COMMIT");
    return { ended: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Durable pilot state for a tenant (F2) — never derived from `hub_users`. */
export async function getPilotTenantStatus(
  tenantId: string,
): Promise<{ pilotStatus: string | null; pilotExpiresAt: Date | null }> {
  const { rows } = await pool.query(
    `SELECT pilot_status, pilot_expires_at FROM hub_tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  const row = rows[0] as { pilot_status?: string; pilot_expires_at?: string } | undefined;
  return {
    pilotStatus: row?.pilot_status ?? null,
    pilotExpiresAt: row?.pilot_expires_at ? new Date(row.pilot_expires_at) : null,
  };
}

/**
 * Reserve a pilot seat for an invite (F1/F2/F4). No-op (`reserved: false`)
 * when the flag is off or the tenant isn't an active pilot — the cap only
 * applies to tenants an admin has explicitly approved. Throws
 * `PilotSeatCapError` (caller maps to 409) when the tenant already holds
 * `PILOT_SEAT_MAX_USERS` seats (members + live reservations).
 */
export async function reservePilotSeat(
  tenantId: string,
  email: string,
): Promise<{ reserved: boolean }> {
  if (!isPilotApprovalRequired()) return { reserved: false };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Tenant-scoped lock: serializes every seat decision for this tenant,
    // never contends with a different tenant's invites or the cohort lock.
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      PILOT_SEAT_LOCK_NAMESPACE,
      tenantId,
    ]);

    const { rows: tenantRows } = await client.query(
      `SELECT pilot_status FROM hub_tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    const pilotStatus = (tenantRows[0] as { pilot_status?: string } | undefined)?.pilot_status;
    if (pilotStatus !== "active") {
      await client.query("COMMIT");
      return { reserved: false };
    }

    const emailLower = email.trim().toLowerCase();

    const { rows: memberRows } = await client.query(
      `SELECT 1 FROM hub_users WHERE tenant_id = $1 AND email_lower = $2 LIMIT 1`,
      [tenantId, emailLower],
    );
    if (memberRows.length > 0) {
      // Already a seat-holding member — re-inviting them needs no reservation.
      await client.query("COMMIT");
      return { reserved: false };
    }

    const { rows: existingReservation } = await client.query(
      `SELECT id FROM pilot_seat_reservations WHERE tenant_id = $1 AND email_lower = $2 LIMIT 1`,
      [tenantId, emailLower],
    );
    if (existingReservation.length > 0) {
      // F4: a live reservation for this email already holds the seat —
      // resending the invite must not reserve a second one.
      await client.query("COMMIT");
      return { reserved: true };
    }

    const { rows: occupiedRows } = await client.query(
      `SELECT COUNT(DISTINCT email_lower)::int AS n FROM (
         SELECT email_lower FROM hub_users WHERE tenant_id = $1
         UNION
         SELECT email_lower FROM pilot_seat_reservations WHERE tenant_id = $1
       ) seats`,
      [tenantId],
    );
    const occupied = Number((occupiedRows[0] as { n: number } | undefined)?.n ?? 0);
    if (occupied >= PILOT_SEAT_MAX_USERS) {
      throw new PilotSeatCapError();
    }

    await client.query(
      `INSERT INTO pilot_seat_reservations (tenant_id, email_lower)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id, email_lower) DO NOTHING`,
      [tenantId, emailLower],
    );
    await client.query("COMMIT");
    return { reserved: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Marks a pending reservation redeemed when an invited user actually signs
 *  in. Idempotent no-op if there is no matching pending row (flag off, no
 *  reservation, or already redeemed) — never frees or re-reserves a seat. */
export async function redeemPilotSeat(tenantId: string, email: string): Promise<void> {
  const emailLower = email.trim().toLowerCase();
  await pool.query(
    `UPDATE pilot_seat_reservations
     SET status = 'redeemed', redeemed_at = NOW()
     WHERE tenant_id = $1 AND email_lower = $2 AND status = 'pending'`,
    [tenantId, emailLower],
  );
}
