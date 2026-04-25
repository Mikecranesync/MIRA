import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";

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

export async function requireSession(): Promise<SessionContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    throw new UnauthorizedError();
  }
  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    email: session.user.email,
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
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) return null;
  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    email: session.user.email,
  };
}
