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
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
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
  let role = "";
  try {
    const user = await findUserById(token.uid as string);
    role = (user?.role ?? "").toLowerCase().trim();
  } catch {
    role = "";
  }

  return {
    userId: token.uid as string,
    tenantId: tid,
    email: (token.email as string) ?? "",
    status: (token.status as string) ?? "trial",
    trialExpiresAt: (token.trialExpiresAt as string) ?? null,
    role,
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
  } catch {
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
