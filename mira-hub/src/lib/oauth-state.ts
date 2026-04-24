import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function stateCookieName(provider: string): string {
  return `oauth_state_${provider}`;
}

/**
 * Validate the `state` query param against the cookie set at OAuth start.
 * Returns true iff both are present, equal length, and match in constant time.
 */
export function validateState(req: NextRequest, provider: string, stateFromQuery: string | null): boolean {
  if (!stateFromQuery) return false;
  const cookie = req.cookies.get(stateCookieName(provider))?.value;
  if (!cookie) return false;
  const a = Buffer.from(stateFromQuery);
  const b = Buffer.from(cookie);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
