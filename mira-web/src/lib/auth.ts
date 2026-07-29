/**
 * JWT authentication — sign/verify tokens for PLG funnel sessions.
 *
 * Uses `jose` (MIT) for JWT operations. Tokens are 30-day sessions
 * containing tenant_id, email, tier, and atlas company/user IDs.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Context, Next } from "hono";
import { findTenantById } from "./quota.js";
import { parseCookies } from "./cookie-session.js";

export interface MiraTokenPayload extends JWTPayload {
  sub: string; // tenant_id (UUID)
  email: string;
  tier: string; // "pending" | "active" | "churned"
  atlasCompanyId: number;
  atlasUserId: number;
  atlasRole: "ADMIN" | "USER"; // NEW
}

// P0.2 (#890): short-lived sessions. Existing 30d tokens keep their original
// expiry; only newly-issued tokens are 7d.
const JWT_EXPIRY = "7d";

function getSecret(): Uint8Array {
  const secret = process.env.PLG_JWT_SECRET;
  if (!secret) throw new Error("PLG_JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: {
  tenantId: string;
  email: string;
  tier: string;
  atlasCompanyId: number;
  atlasUserId: number;
  atlasRole: "ADMIN" | "USER";
}): Promise<string> {
  return new SignJWT({
    email: payload.email,
    tier: payload.tier,
    atlasCompanyId: payload.atlasCompanyId,
    atlasUserId: payload.atlasUserId,
    atlasRole: payload.atlasRole,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.tenantId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyToken(
  token: string
): Promise<MiraTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as MiraTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Hono middleware — reads JWT from Authorization header or `mira_session`
 * cookie (lowest precedence so programmatic integrations aren't affected).
 * ?token= query auth was removed (#890 P0.1).
 * Sets c.set("user", payload) on success, returns 401 on failure.
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  // P0.1 (#890): no ?token= query auth — tokens in URLs leak via logs,
  // referrers, and browser history. Header or cookie only.
  const cookie = parseCookies(c.req.header("cookie"))["mira_session"];
  const raw = header ? header.replace("Bearer ", "") : cookie;

  if (!raw) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(raw);
  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("user", payload);
  await next();
}

/**
 * Hono middleware — requireAuth + verify tenant tier is 'active' in NeonDB.
 * Returns 403 if tier is not active. Use for product routes (chat, CMMS).
 * Use requireAuth (not requireActive) for routes any authenticated user needs
 * (e.g., billing portal).
 *
 * Reads JWT from Authorization header or `mira_session` cookie (lowest
 * precedence). ?token= query auth was removed (#890 P0.1).
 */
export async function requireActive(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  // P0.1 (#890): no ?token= query auth — tokens in URLs leak via logs,
  // referrers, and browser history. Header or cookie only.
  const cookie = parseCookies(c.req.header("cookie"))["mira_session"];
  const raw = header ? header.replace("Bearer ", "") : cookie;

  if (!raw) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(raw);
  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const tenant = await findTenantById(payload.sub);
  if (!tenant || tenant.tier !== "active") {
    return c.json(
      { error: "Subscription required", tier: tenant?.tier || "unknown" },
      403
    );
  }

  // Soft-deleted accounts (within 30-day grace window) lose product access
  // immediately even though the tenant row still exists for audit + Stripe
  // reconciliation. 410 Gone is the precise status — clients should treat
  // it as terminal and not retry.
  if ((tenant as { deleted_at?: string | null }).deleted_at) {
    return c.json({ error: "Account deleted" }, 410);
  }

  c.set("user", payload);
  await next();
}

/**
 * Hono middleware — requireActive + check atlasRole === "ADMIN".
 * Returns 403 if the user is authed but not an admin.
 */
export async function requireAdmin(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  // P0.1 (#890): no ?token= query auth — tokens in URLs leak via logs,
  // referrers, and browser history. Header or cookie only.
  const cookie = parseCookies(c.req.header("cookie"))["mira_session"];
  const raw = header ? header.replace("Bearer ", "") : cookie;

  if (!raw) return c.json({ error: "Unauthorized" }, 401);

  const payload = await verifyToken(raw);
  if (!payload) return c.json({ error: "Invalid or expired token" }, 401);

  if (payload.atlasRole !== "ADMIN") {
    return c.json({ error: "Admin role required" }, 403);
  }

  c.set("user", payload);
  await next();
}
