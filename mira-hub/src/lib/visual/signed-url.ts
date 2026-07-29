// mira-hub/src/lib/visual/signed-url.ts
//
// Short-lived, tenant-bound signed tokens for evidence delivery (PRD
// docs/prd/2026-07-20-printsense-visual-focus-workspace.md §15: "signed URLs
// are short-lived and tenant-bound"). The Hub page itself rides the session
// cookie on same-origin <img> loads — this helper exists for delivery to
// surfaces that cannot carry the cookie, and is the seam PR V3's Telegram
// launch token will reuse.
//
// Token shape: `v1.<base64url payload>.<hmac-sha256 hex>`
//   payload = JSON { e: evidenceId, t: tenantId, x: expiresEpochSeconds }
//
// Fail-closed: with no VISUAL_EVIDENCE_SIGNING_SECRET configured, minting
// returns null and verification always fails — the cookie path is unaffected.
// Verification uses timingSafeEqual (constant-time compare idiom from
// src/lib/oauth-state.ts).

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
export const DEFAULT_TOKEN_TTL_SECONDS = 300;

interface TokenPayload {
  e: string; // evidenceId
  t: string; // tenantId
  x: number; // expires (epoch seconds)
}

function signingSecret(): string | null {
  const secret = process.env.VISUAL_EVIDENCE_SIGNING_SECRET ?? "";
  return secret.length >= 16 ? secret : null;
}

function hmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Mint a short-lived signed token binding one evidence item to one tenant.
 * Returns null when no signing secret is configured (fail-closed — callers
 * fall back to cookie-authenticated delivery).
 */
export function mintEvidenceToken(
  evidenceId: string,
  tenantId: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  // ttlSeconds <= 0 mints an already-expired token — harmless (verification
  // rejects it) and deliberate, so expiry handling stays testable.
  const payload: TokenPayload = {
    e: evidenceId,
    t: tenantId,
    x: Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${encoded}.${hmacHex(encoded, secret)}`;
}

/**
 * Verify a token against the evidence id the caller is requesting. Returns the
 * tenant the token is bound to, or null on ANY failure (missing secret, bad
 * structure, tampered signature, expired, or evidence-id mismatch). Callers
 * must treat null as "not found" — never distinguish failure modes to clients.
 */
export function verifyEvidenceToken(
  token: string,
  evidenceId: string,
): { tenantId: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, encoded, sigHex] = parts;
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return null;

  const expected = Buffer.from(hmacHex(encoded, secret), "hex");
  const provided = Buffer.from(sigHex, "hex");
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload?.e !== "string" ||
    typeof payload?.t !== "string" ||
    typeof payload?.x !== "number"
  ) {
    return null;
  }
  if (payload.e !== evidenceId) return null;
  if (payload.x <= Math.floor(Date.now() / 1000)) return null;
  return { tenantId: payload.t };
}
