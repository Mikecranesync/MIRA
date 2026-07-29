import { NextResponse } from "next/server";
import { sessionOr401, type SessionContext } from "@/lib/session";

/**
 * Demo bearer-token fallback for the tablet UI.
 *
 * The May 21 demo runs on a public iPad at an expo booth — no Hub login flow.
 * If `Authorization: Bearer ${DEMO_API_TOKEN}` matches, we hydrate a synthetic
 * session pointing at the demo tenant. Otherwise we defer to `sessionOr401`,
 * keeping every endpoint usable from a normal authenticated Hub session.
 *
 * Demo tenant UUID is hard-coded; matches `tools/seeds/demo-conveyor-001.sql`.
 */

export const DEMO_TENANT_ID = "00000000-0000-0000-0000-0000000000d1";
export const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000ff";

function demoToken(): string | null {
  return process.env.DEMO_API_TOKEN?.trim() || null;
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export interface DemoOrSessionContext extends SessionContext {
  isDemo: boolean;
}

/**
 * Resolve a session context that may be either a real next-auth session or a
 * demo bearer token. Returns a 401 NextResponse if neither resolves.
 *
 *   const ctx = await sessionOrDemo(req);
 *   if (ctx instanceof NextResponse) return ctx;
 *   // ctx.tenantId, ctx.userId, ctx.isDemo
 */
export async function sessionOrDemo(
  req: Request,
): Promise<DemoOrSessionContext | NextResponse> {
  const token = demoToken();
  const bearer = extractBearer(req);
  if (token && bearer && bearer === token) {
    return {
      userId: DEMO_USER_ID,
      tenantId: DEMO_TENANT_ID,
      email: "demo@factorylm.com",
      status: "trial",
      trialExpiresAt: null,
      // Public expo-booth session — least-privilege, never tenant-admin (#2360).
      role: "viewer",
      isDemo: true,
    };
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  return { ...ctx, isDemo: false };
}

/**
 * Same shape as `sessionOrDemo` but returns null instead of a 401 — for
 * endpoints that have a public fallback (e.g. demo signals events).
 */
export async function sessionOrDemoOrNull(
  req: Request,
): Promise<DemoOrSessionContext | null> {
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return null;
  return ctx;
}

export function isDemoTenant(tenantId: string): boolean {
  return tenantId === DEMO_TENANT_ID;
}
