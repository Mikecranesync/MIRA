/**
 * Keep a signed-in session's access state in step with the database (#4362, Codex #4664 F3).
 *
 * The middleware gates on the `status` / `trialExpiresAt` claims inside the session
 * JWT, and those were written once, at sign-in. A buyer who signed in under the old
 * 7-day trial therefore kept a day-8 deadline in their cookie even after the
 * database was moved to the 30-day pilot window, and stayed locked out until they
 * signed in again. NextAuth runs the `jwt` callback on every session read (the
 * client's SessionProvider fetches it on load) and re-issues the cookie, so
 * refreshing the two claims there carries the database's current value into the
 * next request the middleware sees.
 *
 * Fails safe: no user id, a missing row, or a lookup error leaves the token
 * exactly as it was — a refresh can never grant access the stored claims did not.
 */

export interface EntitlementRow {
  status: string;
  trialExpiresAt: Date | null;
}

export type EntitlementLookup = (userId: string) => Promise<EntitlementRow | null>;

export interface EntitlementClaims {
  uid?: unknown;
  status?: unknown;
  trialExpiresAt?: unknown;
}

export async function refreshEntitlementClaims<T extends EntitlementClaims>(
  token: T,
  lookup: EntitlementLookup,
): Promise<T> {
  if (typeof token.uid !== "string" || !token.uid) return token;
  let row: EntitlementRow | null;
  try {
    row = await lookup(token.uid);
  } catch (err) {
    console.warn("[auth] entitlement refresh failed; keeping session claims", err);
    return token;
  }
  if (!row) return token;
  return {
    ...token,
    status: row.status,
    trialExpiresAt: row.trialExpiresAt ? row.trialExpiresAt.toISOString() : null,
  };
}
