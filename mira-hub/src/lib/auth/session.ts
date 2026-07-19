// mira-hub/src/lib/auth/session.ts
//
// Phase 1 auth-sweep foundation (post-#578).
//
// Bridges the existing next-auth cookie session (src/lib/session.ts) to the
// typed interface that route-helpers and the codemod-converted routes expect.
// Exposes withTenant (RLS-enforced) and withServiceRole (bypass, cron/workers).

import type { PoolClient } from "pg";
import { withTenantContext } from "@/lib/tenant-context";
import { requireSession as cookieSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Types

// The real hub_users.role vocabulary (issue #2360). Any unrecognized string
// normalizes to least-privilege so it can never satisfy a role gate.
export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "scheduler"
  | "technician"
  | "operator"
  | "viewer";

const KNOWN_ROLES: ReadonlySet<string> = new Set<Role>([
  "owner",
  "admin",
  "manager",
  "scheduler",
  "technician",
  "operator",
  "viewer",
]);

/** Map a raw hub_users.role string to a known Role; unknown → least-privilege. */
export function normalizeRole(raw: string | null | undefined): Role {
  const r = (raw ?? "").toLowerCase().trim();
  return KNOWN_ROLES.has(r) ? (r as Role) : "viewer";
}

export interface Session {
  userId: string;
  tenantId: string;
  role: Role;
  exp: number;
}

// ---------------------------------------------------------------------------
// Error

export class HttpAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "HttpAuthError";
  }
}

// ---------------------------------------------------------------------------
// Session helpers

/**
 * Require an authenticated session. Throws HttpAuthError(401) if not present.
 * The `req` param is accepted for API compatibility with the codemod output
 * but is not used — next-auth reads cookies from next/headers globally.
 */
export async function requireSession(_req?: Request): Promise<Session> {
  void _req;
  try {
    const ctx = await cookieSession();
    return {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      // Derived fresh from hub_users.role by cookieSession() (issue #2360).
      role: normalizeRole(ctx.role),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  } catch {
    throw new HttpAuthError(401, "unauthorized");
  }
}

/** Return session or null — never throws. For optional-auth routes. */
export async function getSession(_req?: Request): Promise<Session | null> {
  void _req;
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

/** Throw HttpAuthError(403) if session.role is not in the allowed list. */
export function requireRole(session: Session, ...allowed: Role[]): void {
  if (!allowed.includes(session.role)) {
    throw new HttpAuthError(403, "forbidden");
  }
}

// ---------------------------------------------------------------------------
// DB helpers

/**
 * Run fn inside a transaction that sets the RLS tenant context.
 * This is the primary wrapper for every Hub API route handler.
 */
export async function withTenant<T>(
  session: Session,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantContext(session.tenantId, fn);
}

/**
 * Run fn as the service role — BYPASSRLS, no tenant context set.
 * For use in cron handlers and internal workers only.
 * The `_req` param is null by convention so callsites are obviously distinct.
 */
export async function withServiceRole<T>(
  _req: null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { default: pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
