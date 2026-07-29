/**
 * Durable Stripe → Hub provisioning queue.
 *
 * The Stripe webhook bridges checkout events into mira-hub's `hub_users`
 * table (see hub-user-activation.ts). That bridge was best-effort: if the
 * customer hadn't registered on the Hub yet when the webhook fired
 * (UPDATE matched 0 rows), or the hub DB call threw, the paying customer
 * stayed unprovisioned forever — nothing retried.
 *
 * This module makes the link durable:
 *
 *   1. The webhook records a `plg_pending_hub_provisioning` row whenever
 *      activation/expiry didn't land (matched=0 or threw). The row is
 *      keyed on the Stripe event id, so Stripe redelivering the same
 *      event inserts nothing new (ON CONFLICT DO NOTHING).
 *   2. `reconcilePendingHubProvisioning()` retries pending rows. It runs
 *      (a) fire-and-forget on the mira-web login paths, and (b) from the
 *      admin reconcile endpoint (`POST /api/admin/hub-provisioning/
 *      reconcile`), suitable for cron.
 *
 * Double-provisioning is impossible by construction: the underlying
 * hub_users UPDATEs are idempotent (setting status='approved' twice is a
 * no-op), and a row flips to 'done' the first time its UPDATE matches,
 * so it is never retried again.
 */

import { neon } from "@neondatabase/serverless";
import {
  activateHubUserByEmail,
  expireHubUserByEmail,
} from "./hub-user-activation.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export type HubProvisioningKind = "activate" | "expire";

export interface PendingHubProvisioning {
  stripe_event_id: string;
  email: string;
  tenant_id: string | null;
  kind: HubProvisioningKind;
  status: string; // 'pending' | 'done'
  attempts: number;
  last_error: string | null;
}

export interface ReconcileResult {
  scanned: number;
  completed: number;
  stillPending: number;
  errors: number;
}

/**
 * Record that a Stripe event's Hub provisioning didn't land yet.
 * Idempotent on stripe_event_id — Stripe redelivering the same event
 * (its retry mechanism reuses the event id) inserts nothing new.
 * Returns whether a new row was created.
 */
export async function recordPendingHubProvisioning(input: {
  stripeEventId: string;
  email: string;
  tenantId?: string | null;
  kind: HubProvisioningKind;
  lastError?: string | null;
}): Promise<boolean> {
  const email = input.email.trim();
  if (!input.stripeEventId || !email) return false;
  const db = sql();
  const rows = (await db`
    INSERT INTO plg_pending_hub_provisioning
      (stripe_event_id, email, tenant_id, kind, last_error)
    VALUES
      (${input.stripeEventId}, ${email}, ${input.tenantId ?? null},
       ${input.kind}, ${input.lastError ?? null})
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING stripe_event_id
  `) as Array<{ stripe_event_id: string }>;
  return rows.length > 0;
}

/**
 * Mark every pending row for an email+kind as done. Called when a later
 * delivery of the event (or a manual fix) provisioned the user, so
 * reconcile doesn't keep retrying a solved problem.
 */
export async function markHubProvisioningDoneByEmail(
  email: string,
  kind: HubProvisioningKind,
): Promise<number> {
  const trimmed = email.trim();
  if (!trimmed) return 0;
  const db = sql();
  const rows = (await db`
    UPDATE plg_pending_hub_provisioning
       SET status = 'done',
           completed_at = NOW(),
           updated_at = NOW()
     WHERE LOWER(email) = LOWER(${trimmed})
       AND kind = ${kind}
       AND status = 'pending'
    RETURNING stripe_event_id
  `) as Array<{ stripe_event_id: string }>;
  return rows.length;
}

/**
 * Retry pending Hub provisioning records. Optionally scoped to one email
 * (the login-path hook); unscoped it sweeps the oldest `limit` rows (the
 * cron/admin path). Safe to run concurrently and repeatedly: completed
 * rows leave the queue, unmatched rows just bump `attempts`.
 */
export async function reconcilePendingHubProvisioning(options?: {
  email?: string;
  limit?: number;
}): Promise<ReconcileResult> {
  const limit = options?.limit ?? 50;
  const emailFilter = options?.email?.trim() || null;
  const db = sql();

  const pending = (
    emailFilter
      ? await db`
          SELECT stripe_event_id, email, tenant_id, kind, status, attempts, last_error
            FROM plg_pending_hub_provisioning
           WHERE status = 'pending' AND LOWER(email) = LOWER(${emailFilter})
           ORDER BY created_at ASC
           LIMIT ${limit}`
      : await db`
          SELECT stripe_event_id, email, tenant_id, kind, status, attempts, last_error
            FROM plg_pending_hub_provisioning
           WHERE status = 'pending'
           ORDER BY created_at ASC
           LIMIT ${limit}`
  ) as PendingHubProvisioning[];

  const result: ReconcileResult = {
    scanned: pending.length,
    completed: 0,
    stillPending: 0,
    errors: 0,
  };

  for (const row of pending) {
    try {
      const outcome =
        row.kind === "expire"
          ? await expireHubUserByEmail(row.email)
          : await activateHubUserByEmail(row.email);
      if (outcome.matched > 0) {
        await db`
          UPDATE plg_pending_hub_provisioning
             SET status = 'done',
                 attempts = attempts + 1,
                 last_error = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
           WHERE stripe_event_id = ${row.stripe_event_id}`;
        result.completed++;
      } else {
        // Hub user still doesn't exist — stays pending for the next pass.
        await db`
          UPDATE plg_pending_hub_provisioning
             SET attempts = attempts + 1,
                 last_error = 'hub_user_not_found',
                 updated_at = NOW()
           WHERE stripe_event_id = ${row.stripe_event_id}`;
        result.stillPending++;
      }
    } catch (err) {
      result.errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[hub-provisioning] Reconcile failed for %s (%s): %s",
        row.email,
        row.stripe_event_id,
        message,
      );
      try {
        await db`
          UPDATE plg_pending_hub_provisioning
             SET attempts = attempts + 1,
                 last_error = ${message.slice(0, 500)},
                 updated_at = NOW()
           WHERE stripe_event_id = ${row.stripe_event_id}`;
      } catch {
        // Bookkeeping failure is non-fatal; next pass retries anyway.
      }
    }
  }

  return result;
}
