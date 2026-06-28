import { headers } from "next/headers";
import { createHash } from "crypto";

/**
 * In-memory, per-IP-hash sliding-window rate limiter for public / shared-token
 * LLM endpoints (e.g. the unauthenticated /api/quickstart/ask and the
 * demo-token-reachable /api/mira/ask). These fire the Groq → Cerebras → Gemini
 * cascade on shared free-tier quota, so an unthrottled door lets one caller
 * drain the whole beta cohort's quota / run up cost.
 *
 * In-memory means per-instance. This is sufficient while the hub runs as a
 * SINGLE container (see root CLAUDE.md Container Map). If the hub scales
 * horizontally, port to a shared store / DB-backed counter (a `quickstart_rate`
 * table), mirroring /api/public/report's DB-backed IP-hash limiter.
 *
 * We never store raw IPs — only their SHA-256 hash — to honor the PII rule in
 * .claude/rules/security-boundaries.md.
 */

// One named bucket per endpoint, each mapping ipHash -> recent request timestamps.
const buckets = new Map<string, Map<string, number[]>>();

/**
 * SHA-256 hash of the caller's IP.
 *
 * Prefers `x-real-ip`: our nginx sets `X-Real-IP $remote_addr` (the real TCP
 * peer — see nginx-oracle.conf), which a client CANNOT spoof. We only fall back
 * to the LEFTMOST `x-forwarded-for` value when `x-real-ip` is absent — note
 * that value is client-controlled (nginx APPENDS the real IP to any
 * client-sent XFF via `$proxy_add_x_forwarded_for`), so it's a weak,
 * spoofable last resort, used only when there's no trusted proxy header.
 *
 * Returns a hash of "unknown" when no header is present (e.g. a direct local
 * request) so the limiter still applies a single shared bucket.
 */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const rawIp =
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return createHash("sha256").update(rawIp).digest("hex");
}

/**
 * Returns true if `key` (typically an IP hash) has exceeded `max` requests in
 * the trailing `windowMs` for the named `bucket`. Records the current request
 * either way (so callers should treat a `true` result as "reject this one").
 */
export function rateLimited(
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  let b = buckets.get(bucket);
  if (!b) {
    b = new Map();
    buckets.set(bucket, b);
  }
  const hits = (b.get(key) ?? []).filter((t) => t > cutoff);
  hits.push(now);
  b.set(key, hits);
  // Opportunistic cleanup so the map can't grow unbounded under IP churn.
  if (b.size > 5000) {
    for (const [k, v] of b) {
      if (v.every((t) => t <= cutoff)) b.delete(k);
    }
  }
  return hits.length > max;
}
