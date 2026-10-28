import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { findUserById } from "@/lib/users";

export interface SessionContext {
  userId: string;
  tenantId: string;
  email: string;
  status: string;
  trialExpiresAt: string | null;
  /**
   * The caller's tenant role, derived fresh from `hub_users.role` on every
   * request (issue #2360). Lowercased; "" when it can't be resolved (deleted
   * user or a transient DB error) — authorization treats an unknown/absent
   * role as least-privilege, so an unresolved role can never satisfy a role
   * gate. NOT read from the JWT: a stale token must not keep a demoted user's
   * old privilege, and saved sessions must reflect the current role immediately.
   *
   * Optional only so existing test mocks that build a bare SessionContext keep
   * compiling — every production constructor (`requireSession`, `sessionOrDemo`)
   * always sets it. An omitted role is treated identically to "" (least-priv).
   */
  role?: string;
  /**
   * Platform (cross-tenant, FactoryLM-staff) admin: `hub_users.status = 'admin'`, derived fresh
   * from the DB on every request, exactly like `role` (#4591). This is the ONLY platform-admin
   * authority: public registration creates `trial` rows, invites create `approved`, and only an
   * existing platform admin (the admin users route) or an operator can set `admin`. Never the
   * JWT's copy of `status` (stale/forgeable for this purpose) and never an email match.
   * Absent/false = not a platform admin; a failed lookup resolves to false.
   */
  platformAdmin?: boolean;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * F8 (Mike-authorized post-cap Codex pass, #4882 @ 66f379a90): thrown by
 * `requireSession` when the DB-fresh `status` is `expired` — the pilot ended
 * (`endPilotTenant` moved this user to `expired`) or an admin ended access.
 * A trial whose date merely passed is NOT denied here (see the call site). A SUBCLASS of `UnauthorizedError`, deliberately: every existing route
 * that does `if (err instanceof UnauthorizedError) return 401` already
 * denies this case correctly with zero changes (an `instanceof` check on a
 * subclass is `true`), so introducing this as an unrelated error class would
 * have required touching every one of those call sites to keep them
 * fail-closed. `sessionOr401` — the ~150-caller shared helper — special-cases
 * this subclass to return the friendlier 403 below instead of the generic
 * 401; everywhere else it is caught, this is the same deny-by-default
 * `UnauthorizedError` behavior as before.
 */
export class SessionUpgradeRequiredError extends UnauthorizedError {
  constructor() {
    super();
    this.name = "SessionUpgradeRequiredError";
    this.message = "Your pilot has ended. Contact FactoryLM to continue.";
  }
}

// Decode the next-auth JWT directly from the cookie store.
//
// Why not getServerSession: In Next.js 16+ the headers/cookies APIs are async;
// next-auth v4's getServerSession uses synchronous headers() internally and
// silently returns null in App Router Route Handlers, causing false 401s.
//
// Why not getToken with a synthetic req: getToken derives the decryption key
// using HKDF with the cookie name as salt. It auto-selects the salt based on
// secureCookie, which it infers from NEXTAUTH_URL or req.url — both absent in
// a synthetic req. If it guesses wrong (e.g., picks plain name when HTTPS uses
// __Secure-), the HKDF key mismatches and the token silently decodes as null.
//
// This approach: read the cookie directly from next/headers, detect the correct
// name (and salt) by checking which cookie is actually present, then call
// decode() with that salt explicitly. Works in dev (HTTP) and prod (HTTPS).
export async function requireSession(): Promise<SessionContext> {
  const cookieStore = await cookies();

  const SECURE_NAME = "__Secure-next-auth.session-token";
  const REGULAR_NAME = "next-auth.session-token";

  const secureCookie = cookieStore.get(SECURE_NAME);
  const regularCookie = cookieStore.get(REGULAR_NAME);
  const cookieValue = (secureCookie ?? regularCookie)?.value;

  if (!cookieValue) throw new UnauthorizedError();

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  // v4.24.14 encodes session JWTs with salt="" (the default); passing any
  // other salt derives a different HKDF key and silently fails decryption.
  const token = await decode({ token: cookieValue, secret });

  if (!token?.uid || !token?.tid) {
    throw new UnauthorizedError();
  }

  // hub_tenants.id is TEXT, but most data tables (kg_entities, relationship_proposals,
  // wizard_progress, namespace_versions, etc.) declare tenant_id UUID. A legacy seed
  // ('mike' as a tenant slug) blew up every UUID-cast query with HTTP 500. Treat any
  // non-UUID session tenant as unauthenticated so the user gets a clean 401/redirect
  // instead of a 500 on every API call.
  const tid = token.tid as string;
  if (!UUID_RE.test(tid)) {
    throw new UnauthorizedError();
  }

  // Derive the role fresh from hub_users.role (issue #2360). Deliberately a DB
  // read, not a JWT claim: revocation must be instant and already-issued/saved
  // sessions must reflect the live role. If the lookup fails (DB blip) or the
  // row is gone, fall back to least-privilege ("") rather than failing the
  // whole request — the token-based auth itself stays valid, so read routes
  // keep working while every role gate denies. One indexed PK SELECT per
  // authed request; hub_users is tiny.
  //
  // F8 (Mike-authorized post-cap Codex pass, #4882 @ 66f379a90, related
  // pre-existing #3831): `status`/`trialExpiresAt` below are ALSO now taken
  // from this same already-loaded row, not the JWT claims. The claims are
  // written once at sign-in and refreshed only when NextAuth's own `jwt`
  // callback runs (`refreshEntitlementClaims`, src/auth.ts) — a browser-side
  // session read, not this server-side route path. Without this, ending a
  // pilot (`endPilotTenant` sets every non-admin member to 'expired')
  // doesn't deny an already-issued cookie: the holder keeps whatever
  // status/deadline was in the JWT until their browser happens to refresh
  // it, which can be long after the admin ended the pilot.
  //
  // Deliberately asymmetric fail-safe on lookup failure/missing row: `role`/
  // `platformAdmin` fail CLOSED to least-privilege (as before) because the
  // dangerous direction for an unresolved identity is granting excess
  // capability. `status`/`trialExpiresAt` fail OPEN to the JWT claim — kept
  // exactly as before this fix — because the entitlement decision below is a
  // courtesy deny, not a capability grant: denying it wrongly on a transient
  // DB blip would lock out an otherwise-legitimate, already-authenticated
  // user, which is a worse failure mode than trusting one stale claim for
  // one more request. The DB is retried on every subsequent request, so a
  // blip self-heals; it never compounds into a standing excess grant the way
  // a wrongly-elevated role would.
  let role = "";
  let platformAdmin = false;
  let status = (token.status as string) ?? "trial";
  let trialExpiresAt: string | null = (token.trialExpiresAt as string) ?? null;
  let upgradeRequired = false;
  try {
    const user = await findUserById(token.uid as string);
    role = (user?.role ?? "").toLowerCase().trim();
    platformAdmin = user?.status === "admin";
    if (user) {
      status = user.status;
      trialExpiresAt = user.trialExpiresAt ? user.trialExpiresAt.toISOString() : null;
      // Deny only an EXPLICIT end of access: status 'expired' is written by
      // endPilotTenant (#4882) or by an admin. A trial whose date has merely
      // passed keeps today's behavior (the cookie-based page gate sends it to
      // /upgrade); enforcing the date here would lock every older trial
      // account out of the API on the first deploy, a much wider change than
      // ending a pilot needs.
      upgradeRequired = status === "expired";
    }
  } catch {
    role = "";
    platformAdmin = false;
  }

  // Thrown OUTSIDE the try/catch above on purpose: the catch block exists
  // only to swallow a DB-lookup failure (fail-safe, see above), never to
  // swallow this intentional deny. Only status "expired" is denied, so
  // pending-approval, admin, approved and in-date or past-date trial sessions
  // are unaffected.
  if (upgradeRequired) {
    throw new SessionUpgradeRequiredError();
  }

  return {
    userId: token.uid as string,
    tenantId: tid,
    email: (token.email as string) ?? "",
    status,
    trialExpiresAt,
    role,
    platformAdmin,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the session or return a 401 NextResponse. Use at the top of
 * an API route handler:
 *
 *   const ctx = await sessionOr401();
 *   if (ctx instanceof NextResponse) return ctx;
 *   // ctx.tenantId, ctx.userId, ctx.email
 */
export async function sessionOr401(): Promise<SessionContext | NextResponse> {
  try {
    return await requireSession();
  } catch (err) {
    // F8: the ~150 callers of this shared helper get the friendlier,
    // specific 403 for an ended pilot / lapsed trial without each one
    // needing to know about SessionUpgradeRequiredError. Every other
    // UnauthorizedError (including this subclass, for any of the 9 routes
    // that call requireSession() directly and catch UnauthorizedError
    // themselves) still denies via its own existing instanceof check.
    if (err instanceof SessionUpgradeRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
