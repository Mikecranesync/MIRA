/**
 * Bridge mira-web's Stripe webhook to the mira-hub `hub_users` table.
 *
 * Until this existed, a successful checkout flipped `plg_tenants.tier` to
 * "active" but left the matching `hub_users.status` at "trial" (or, for
 * legacy users, "pending"). The Hub middleware
 * (`mira-hub/src/middleware.ts`) therefore kept routing paying customers
 * to `/pending-approval` or `/upgrade` after their 7-day trial expired.
 *
 * Both apps share the same NeonDB, so we update `hub_users` directly.
 * The UPDATE is idempotent and silently affects 0 rows when the user
 * hasn't registered on the Hub yet (e.g. they paid first, then signed
 * up via magic link). The corresponding hub_users row, when created
 * later via `ensureUserAndTenant`, defaults to "trial" — at that point
 * we'd need a backfill, but for the PLG self-serve flow the user
 * almost always registers first.
 *
 * `status = 'approved'` is in the `UserStatus` enum
 * (`mira-hub/src/lib/users.ts`) and bypasses every middleware gate
 * (no `pending` redirect, no `expired` redirect, no `trial` expiry
 * check). Clearing `trial_expires_at` keeps that gate from re-firing
 * if status ever changes back to `trial`.
 */

import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export interface HubActivationResult {
  matched: number;
}

/**
 * Mark the hub_users row for `email` as approved. Returns the number
 * of rows affected (0 if the user hasn't registered yet on the Hub).
 *
 * Throws only on connection / SQL errors — callers should catch and
 * log so a transient hub-DB blip doesn't cause Stripe to retry the
 * whole webhook (idempotent activation logic upstream handles that).
 */
export async function activateHubUserByEmail(
  email: string,
): Promise<HubActivationResult> {
  const trimmed = email.trim();
  if (!trimmed) return { matched: 0 };
  const db = sql();
  const rows = (await db`
    UPDATE hub_users
       SET status = 'approved',
           trial_expires_at = NULL,
           updated_at = NOW()
     WHERE email_lower = LOWER(${trimmed})
     RETURNING id
  `) as Array<{ id: string }>;
  return { matched: rows.length };
}

/**
 * Inverse of activateHubUserByEmail — flip back to 'expired' so the
 * Hub middleware redirects the user to /upgrade. Used on
 * `customer.subscription.deleted` so churned customers can resubscribe
 * but lose access until they do.
 */
export async function expireHubUserByEmail(
  email: string,
): Promise<HubActivationResult> {
  const trimmed = email.trim();
  if (!trimmed) return { matched: 0 };
  const db = sql();
  const rows = (await db`
    UPDATE hub_users
       SET status = 'expired',
           updated_at = NOW()
     WHERE email_lower = LOWER(${trimmed})
     RETURNING id
  `) as Array<{ id: string }>;
  return { matched: rows.length };
}
