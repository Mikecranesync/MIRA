import type { PoolClient } from "pg";
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
 * F1 — redemption (`admitPilotInvite`, called from `ensureInvitedUser`)
 *      re-reads `hub_tenants.pilot_status` inside the SAME tenant-scoped
 *      `pg_advisory_xact_lock` that `endPilotTenant` takes, so a token
 *      issued while active but redeemed after the admin ends the pilot is
 *      rejected (`PilotTenantNotActiveError`) — it can never create or
 *      restore access, even racing the termination itself.
 * F2 — seat capacity is re-checked AT REDEMPTION (`admitPilotInvite`), not
 *      only at invite-send time (`reservePilotSeat`) — a token issued before
 *      the tenant was ever capacity-checked still gets capacity-checked the
 *      moment it's redeemed. "Is this tenant a pilot" is always read from
 *      `hub_tenants.pilot_status` (durable), never derived from an ephemeral
 *      `hub_users.status='trial'` row that a status change could erase.
 * F3 — `approvePilotTenant` moves EVERY existing non-admin user in the
 *      tenant to the org's trial deadline, not just the owner — pre-existing
 *      'approved' crew would otherwise stay approved forever (middleware
 *      only gates trial/pending/expired). Review round 2: approval also
 *      takes the tenant-scoped seat lock (fixed order: cohort lock, then
 *      tenant lock — see `approvePilotTenant`) and `admitPilotInvite`'s
 *      tenant read is `FOR UPDATE`, so a legacy (NULL pilot_status) tenant's
 *      redemption can never race activation and insert/restore an 'approved'
 *      member after approval's tenant-wide sweep already ran.
 * F4 — `releasePilotSeatReservation` undoes a reservation whose invite
 *      creation failed right after (`team/route.ts`), so a 500 after the
 *      seat was reserved doesn't permanently strand it. `UNIQUE (tenant_id,
 *      email_lower)` also means resending a still-pending invite finds the
 *      existing row instead of reserving a second seat.
 * F5 — `approvePilotTenant` refuses to activate a tenant whose existing
 *      non-admin members + pending reservations already exceed
 *      `PILOT_SEAT_MAX_USERS` (e.g. a legacy tenant with 6 members from the
 *      unrestricted pre-pilot invite flow) — it never silently grants trial
 *      access to more than the cap.
 * Reservation rows are never deleted on redemption — `status` transitions
 * `pending` -> `redeemed` in place, so "redeeming an invite never frees a
 * seat, even temporarily" is true by construction. (A row IS deleted by
 * `releasePilotSeatReservation`, but only while still `pending` and only
 * when the invite that would have redeemed it never came into existence.)
 *
 * Lock order (documented once, binding everywhere): COHORT LOCK
 * (`PILOT_COHORT_LOCK_KEY`) before the TENANT LOCK (`PILOT_SEAT_LOCK_NAMESPACE`
 * + `hashtext(tenantId)`). Only `approvePilotTenant` ever takes the cohort
 * lock, and it always takes it first; `admitPilotInvite`, `reservePilotSeat`,
 * and `endPilotTenant` take only the tenant lock. No code path acquires them
 * in the reverse order, so this cannot deadlock.
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

/** Codex #4664 F1: a pilot tenant that is `pending` or `ended` right now
 *  rejects redemption outright — an invite issued while active (or before
 *  activation) can never create or restore access once the admin has ended
 *  (or not yet started) the pilot. */
export class PilotTenantNotActiveError extends Error {
  constructor() {
    super("This pilot organization is not currently active; the invitation cannot be redeemed.");
    this.name = "PilotTenantNotActiveError";
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
    // Fixed global lock order — documented once, applied everywhere a pilot
    // decision touches more than one scope: COHORT LOCK FIRST, then the
    // TENANT-SCOPED lock. admitPilotInvite and endPilotTenant only ever take
    // the tenant lock (never the cohort lock), so this order can never
    // deadlock against them — there is no second code path that could ever
    // acquire the two locks in the opposite order.
    await client.query("SELECT pg_advisory_xact_lock($1)", [PILOT_COHORT_LOCK_KEY]);
    // F3 (Codex #4664 / #4878 review round 2): the SAME tenant-scoped lock
    // admitPilotInvite/endPilotTenant take, acquired BEFORE reading the
    // tenant row. Without this, a legacy (pilot_status IS NULL) tenant's
    // redemption could read NULL, decide "legacy/non-pilot", and — after
    // approval commits its tenant-wide trial sweep — insert or update the
    // recipient as 'approved' with no expiry, racing the activation. With
    // this lock (plus admitPilotInvite's FOR UPDATE read, above), the two
    // operations always serialize: whichever commits first is fully visible
    // to the other, never a torn read.
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      PILOT_SEAT_LOCK_NAMESPACE,
      tenantId,
    ]);

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

    // F5 (Codex #4664 / #4878 review round 2): a tenant that accumulated
    // members through the unrestricted legacy invite flow (flag off, or
    // never activated) before ever being pilot-tracked may already be over
    // the 5-seat cap. Reject rather than silently admitting all of them —
    // admins are exempt (never converted by any pilot transition, so they
    // never occupy a pilot seat; matches the admin carve-out on the
    // tenant-wide UPDATE below).
    const { rows: seatRows } = await client.query(
      `SELECT COUNT(DISTINCT email_lower)::int AS n FROM (
         SELECT email_lower FROM hub_users WHERE tenant_id = $1 AND status <> 'admin'
         UNION
         SELECT email_lower FROM pilot_seat_reservations WHERE tenant_id = $1
       ) seats`,
      [tenantId],
    );
    if (Number((seatRows[0] as { n: number } | undefined)?.n ?? 0) > PILOT_SEAT_MAX_USERS) {
      throw new PilotSeatCapError();
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

    // F3 (Codex #4664 / #4878 review round 1): EVERY existing non-admin user
    // in the tenant follows the org onto the pilot window, not just the
    // owner — a tenant approved with pre-existing 'approved' crew must not
    // leave them permanently approved with no expiry (middleware only gates
    // 'trial'/'pending'/'expired', so 'approved' crew would otherwise ignore
    // pilot_expires_at forever). Admin carve-out: never downgrade a platform
    // admin's own account (matches ensureInvitedUser/endPilotTenant).
    await client.query(
      `UPDATE hub_users
       SET status = 'trial', trial_expires_at = $2, updated_at = NOW()
       WHERE tenant_id = $1 AND status <> 'admin'`,
      [tenantId, tenantRow.pilot_expires_at],
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
    // F1 (Codex #4664 / #4878 review round 1): the SAME tenant-scoped lock
    // admitPilotInvite/reservePilotSeat take, so a redemption in flight for
    // this tenant can't read a stale 'active' snapshot concurrently with
    // this termination — one of the two transactions always commits first
    // and the other observes its result.
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      PILOT_SEAT_LOCK_NAMESPACE,
      tenantId,
    ]);
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

/** Releases a reservation that never produced a usable invite — e.g. the
 *  magic-token insert failed immediately after the seat was reserved (Codex
 *  #4664 F4 / #4768). Deletes the row ONLY while it is still `pending`; a
 *  `redeemed` row (the invitee already signed in) is never touched. Safe
 *  under a concurrent resend: redemption re-validates capacity itself
 *  (`admitPilotInvite`), so releasing a pending row can never cause
 *  overbooking even if a resend races this call. */
export async function releasePilotSeatReservation(tenantId: string, email: string): Promise<void> {
  const emailLower = email.trim().toLowerCase();
  await pool.query(
    `DELETE FROM pilot_seat_reservations WHERE tenant_id = $1 AND email_lower = $2 AND status = 'pending'`,
    [tenantId, emailLower],
  );
}

export interface PilotInviteAdmission {
  /** False for a tenant with no pilot_status at all — the caller keeps its
   *  legacy (non-pilot) behavior unchanged. */
  isPilotTenant: boolean;
  pilotExpiresAt: Date | null;
}

/**
 * The authoritative, transactional admission check for redeeming an invite
 * (Codex #4664 F1/F2, #4878 review round 1). MUST be called with `client`
 * already inside an open transaction that the CALLER commits/rolls back —
 * the hub_users write that creates or restores the member must happen on
 * the same client, inside the same lock, so the whole admission is atomic.
 *
 * Takes the identical tenant-scoped `pg_advisory_xact_lock` that
 * `reservePilotSeat` and `endPilotTenant` take, so this serializes against:
 *   - a concurrent invite reservation for the same tenant, and
 *   - a concurrent `endPilotTenant` for the same tenant (F1's "redemption
 *     interleaved with termination" race — one transaction's COMMIT is
 *     always fully visible or fully invisible to the other's read, never a
 *     torn snapshot).
 *
 * Behavior:
 *   - `pilot_status IS NULL` (never a pilot tenant) -> `isPilotTenant:
 *     false`. Caller keeps legacy (non-pilot) behavior.
 *   - `pending` or `ended` -> throws `PilotTenantNotActiveError` (F1): an
 *     invite token issued while active, or before activation, is rejected
 *     once the tenant is no longer active. Never creates or restores access.
 *   - `active`, already a member or already holds a live reservation ->
 *     admitted, no new seat consumed.
 *   - `active`, no reservation on record (F2 — e.g. the token predates the
 *     seat-cap/activation entirely) -> re-checks capacity RIGHT NOW rather
 *     than trusting an old token; throws `PilotSeatCapError` if full,
 *     otherwise reserves the seat as part of this same transaction.
 */
export async function admitPilotInvite(
  client: PoolClient,
  tenantId: string,
  email: string,
): Promise<PilotInviteAdmission> {
  await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    PILOT_SEAT_LOCK_NAMESPACE,
    tenantId,
  ]);

  // F3 (Codex #4664 / #4878 review round 2): FOR UPDATE, not a plain SELECT —
  // approvePilotTenant also locks this row (and now also takes this same
  // tenant advisory lock, below), so a concurrent activation can never be
  // "in flight but uncommitted" while this read decides NULL/pending/ended.
  // Either this read commits first (approve then sees the real outcome), or
  // approve's row lock is already held and this blocks until approve commits.
  const { rows: tenantRows } = await client.query(
    `SELECT pilot_status, pilot_expires_at FROM hub_tenants WHERE id = $1 LIMIT 1 FOR UPDATE`,
    [tenantId],
  );
  const tenantRow = tenantRows[0] as
    | { pilot_status?: string | null; pilot_expires_at?: string }
    | undefined;
  const pilotStatus = tenantRow?.pilot_status ?? null;

  if (pilotStatus === null) {
    return { isPilotTenant: false, pilotExpiresAt: null };
  }
  if (pilotStatus !== "active") {
    throw new PilotTenantNotActiveError();
  }

  const pilotExpiresAt = tenantRow?.pilot_expires_at ? new Date(tenantRow.pilot_expires_at) : null;
  const emailLower = email.trim().toLowerCase();

  const { rows: memberRows } = await client.query(
    `SELECT 1 FROM hub_users WHERE tenant_id = $1 AND email_lower = $2 LIMIT 1`,
    [tenantId, emailLower],
  );
  if (memberRows.length > 0) {
    return { isPilotTenant: true, pilotExpiresAt };
  }

  const { rows: existingReservation } = await client.query(
    `SELECT id FROM pilot_seat_reservations WHERE tenant_id = $1 AND email_lower = $2 LIMIT 1`,
    [tenantId, emailLower],
  );
  if (existingReservation.length > 0) {
    return { isPilotTenant: true, pilotExpiresAt };
  }

  // F2: no reservation on record — re-check capacity now rather than
  // trusting a token that may predate the seat cap or the tenant's own
  // activation.
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
  return { isPilotTenant: true, pilotExpiresAt };
}
