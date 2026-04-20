// mira-web/src/lib/cookie-session.ts
/**
 * Cookie read/write helpers for mira-web.
 *
 * Three cookies governed here:
 *   - mira_session: 30-day JWT session cookie, HttpOnly, SameSite=Lax
 *   - mira_pending_scan: 5-min HttpOnly QR-scan correlation cookie
 *   - mira_channel_pref: 30-day HMAC-signed channel preference, HttpOnly, SameSite=Lax
 *
 * All cookies use Domain=.factorylm.com so they travel between mira-web
 * (factorylm.com) and Open WebUI (app.factorylm.com) on the same eTLD+1.
 */
import { SignJWT, jwtVerify } from "jose";

const COOKIE_DOMAIN =
  process.env.COOKIE_DOMAIN ?? ".factorylm.com";
const COOKIE_SECURE = process.env.NODE_ENV !== "development";

export function parseCookies(header: string | undefined | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildSessionCookie(jwt: string): string {
  const attrs = [
    `mira_session=${encodeURIComponent(jwt)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=2592000", // 30 days
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildPendingScanCookie(scanId: string): string {
  const attrs = [
    `mira_pending_scan=${encodeURIComponent(scanId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=300", // 5 minutes
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookie(name: string): string {
  const attrs = [
    `${name}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

function channelPrefSecret(): Uint8Array {
  const secret = process.env.PLG_JWT_SECRET;
  if (!secret) throw new Error("PLG_JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function buildChannelPrefCookie(channel: string): Promise<string> {
  const token = await new SignJWT({ channel })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(channelPrefSecret());

  const attrs = [
    `mira_channel_pref=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=2592000", // 30 days
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export async function readChannelPref(
  cookieHeader: string | undefined | null,
): Promise<string | null> {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies["mira_channel_pref"];
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, channelPrefSecret());
    const channel = (payload as { channel?: string }).channel;
    return typeof channel === "string" ? channel : null;
  } catch {
    return null;
  }
}
