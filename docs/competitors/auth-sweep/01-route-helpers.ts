// mira-hub/src/lib/auth/route-helpers.ts
//
// Auth-sweep PR (post-#578) — the route-handler wrapper referenced as TODO
// in src/lib/auth/session.ts:43. Catches HttpAuthError and returns a typed
// NextResponse so route bodies stay focused on domain logic.
//
// Usage in a Next.js Route Handler:
//
//   import { withSession } from "@/lib/auth/route-helpers";
//   import { withTenant } from "@/lib/auth/session";
//
//   export const GET = withSession(async (req, session) => {
//     return withTenant(session, async (client) => {
//       const { rows } = await client.query("SELECT * FROM cmms_equipment");
//       return NextResponse.json(rows);
//     });
//   });
//
// For routes that don't need a session (login, public landing redirects),
// import requireSession / getSession directly and skip this wrapper.

import { NextResponse } from "next/server";
import {
  getSession,
  requireSession,
  requireRole,
  HttpAuthError,
  type Session,
  type Role,
} from "./session";

/**
 * Wrap a Route Handler so that:
 *   1. requireSession() is called before fn runs.
 *   2. HttpAuthError is translated to the right NextResponse.
 *   3. Unhandled errors return 500 with a stable shape.
 *
 * fn receives the validated session as its second argument.
 */
export function withSession<C = Record<string, never>>(
  fn: (req: Request, session: Session, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    let session: Session;
    try {
      session = await requireSession(req);
    } catch (err) {
      return authErrorToResponse(err);
    }

    try {
      return await fn(req, session, ctx);
    } catch (err) {
      if (err instanceof HttpAuthError) return authErrorToResponse(err);
      // Surface request id from a header for grep-able logs.
      const requestId = req.headers.get("x-request-id") ?? cryptoRandomId();
      console.error(`[route ${requestId}]`, err);
      return NextResponse.json(
        {
          error: {
            code: "internal_error",
            message: "internal error",
            requestId,
          },
        },
        { status: 500 },
      );
    }
  };
}

/**
 * withSession + role gate. Use for admin / owner endpoints.
 *
 *   export const POST = withSessionAndRole(["owner", "admin"], async (req, session) => { ... });
 */
export function withSessionAndRole<C = Record<string, never>>(
  allowed: Role[],
  fn: (req: Request, session: Session, ctx: C) => Promise<Response>,
) {
  return withSession<C>(async (req, session, ctx) => {
    requireRole(session, ...allowed);
    return fn(req, session, ctx);
  });
}

/**
 * Optional-session variant for routes that change behavior based on
 * auth state but don't require it (e.g. public marketing landing).
 */
export function withOptionalSession<C = Record<string, never>>(
  fn: (req: Request, session: Session | null, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    let session: Session | null = null;
    try {
      session = await getSession(req);
    } catch {
      // Treat malformed token as anonymous — caller decides if that's ok.
      session = null;
    }

    try {
      return await fn(req, session, ctx);
    } catch (err) {
      if (err instanceof HttpAuthError) return authErrorToResponse(err);
      const requestId = req.headers.get("x-request-id") ?? cryptoRandomId();
      console.error(`[route ${requestId}]`, err);
      return NextResponse.json(
        {
          error: {
            code: "internal_error",
            message: "internal error",
            requestId,
          },
        },
        { status: 500 },
      );
    }
  };
}

// ---------------------------------------------------------------------------

function authErrorToResponse(err: unknown): NextResponse {
  if (err instanceof HttpAuthError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.code } },
      { status: err.status },
    );
  }
  // Last-ditch: treat unknown auth-path errors as 401 to avoid leaking 500s.
  return NextResponse.json(
    { error: { code: "unauthorized", message: "unauthorized" } },
    { status: 401 },
  );
}

function cryptoRandomId(): string {
  // Web Crypto on the edge runtime; falls back to Math.random in node test envs.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
