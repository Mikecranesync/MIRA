import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";

export interface SessionContext {
  userId: string;
  tenantId: string;
  email: string;
  status: string;
  trialExpiresAt: string | null;
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

  return {
    userId: token.uid as string,
    tenantId: token.tid as string,
    email: (token.email as string) ?? "",
    status: (token.status as string) ?? "trial",
    trialExpiresAt: (token.trialExpiresAt as string) ?? null,
  };
}

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
