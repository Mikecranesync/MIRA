/**
 * JWT authentication — sign/verify tokens for PLG funnel sessions.
 *
 * Uses `jose` (MIT) for JWT operations. Tokens are 30-day sessions
 * containing tenant_id, email, tier, and atlas company/user IDs.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Context, Next } from "hono";

export interface MiraTokenPayload extends JWTPayload {
  sub: string; // tenant_id (UUID)
  email: string;
  tier: string; // "free" | "pro" | "enterprise"
  atlasCompanyId: number;
  atlasUserId: number;
}

const JWT_EXPIRY = "30d";

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
}): Promise<string> {
  return new SignJWT({
    email: payload.email,
    tier: payload.tier,
    atlasCompanyId: payload.atlasCompanyId,
    atlasUserId: payload.atlasUserId,
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
 * Hono middleware — reads JWT from Authorization header or ?token= query param.
 * Sets c.set("user", payload) on success, returns 401 on failure.
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const query = c.req.query("token");
  const raw = header ? header.replace("Bearer ", "") : query;

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
