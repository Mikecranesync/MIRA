import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";

export interface SessionContext {
  userId: string;
  tenantId: string;
  email: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

// Use getToken + next/headers cookies instead of getServerSession.
// In Next.js 16+ the headers/cookies APIs are async; getServerSession from
// next-auth v4 was written for synchronous headers() and can silently return
// null in App Router Route Handlers on Next.js 16, causing false 401s for
// authenticated users.  getToken with the raw cookie store is the same
// mechanism the middleware already uses reliably.
//
// Cookie name: next-auth v4 uses __Secure- prefix on HTTPS. Detect which
// cookie is actually present rather than relying on NEXTAUTH_URL or req.url
// (both absent when constructing a fake req from next/headers cookies).
export async function requireSession(): Promise<SessionContext> {
  const cookieStore = await cookies();

  const SECURE_NAME = "__Secure-next-auth.session-token";
  const REGULAR_NAME = "next-auth.session-token";
  const cookieName = cookieStore.get(SECURE_NAME) ? SECURE_NAME : REGULAR_NAME;

  const cookieHeader = cookieStore.getAll()
    .map(c => `${c.name}=${c.value}`)
    .join("; ");

  const token = await getToken({
    req: { headers: { cookie: cookieHeader } } as Parameters<typeof getToken>[0]["req"],
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "",
    cookieName,
  });

  if (!token?.uid || !token?.tid) {
    throw new UnauthorizedError();
  }

  return {
    userId: token.uid as string,
    tenantId: token.tid as string,
    email: (token.email as string) ?? "",
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
