/**
 * MFA — TOTP (RFC 6238) + recovery codes for the magic-link login flow.
 *
 * Why hand-rolled instead of `otplib`: RFC 6238 is short, has no exotic
 * primitives, and avoiding a new runtime dep keeps the bun lockfile
 * smaller and the supply-chain surface smaller. All crypto comes from
 * node:crypto (HMAC-SHA1 for the OTP, AES-256-GCM for at-rest secret
 * encryption, randomBytes for secret + recovery code generation).
 *
 * Storage:
 *   - `mfa_secret_enc` (TEXT) — base64(nonce || ciphertext || tag).
 *     Encryption key is derived via HKDF from PLG_JWT_SECRET. A future
 *     hardening step is to switch to a dedicated MFA_ENCRYPTION_KEY
 *     in Doppler so JWT-secret rotation doesn't invalidate enrolled
 *     authenticators.
 *   - `mfa_recovery_codes_hashed` (TEXT[]) — SHA-256(hex) of each
 *     plaintext recovery code. Plaintext is shown ONCE at setup; lost =
 *     account-recovery email flow.
 *
 * What this module does NOT do:
 *   - Persist anything (caller writes to NeonDB).
 *   - Enforce rate limits on TOTP attempts (caller must rate-limit
 *     endpoints — 5/min per tenant is reasonable).
 *   - Integrate with the magic-link login flow. The flow change is in
 *     the route handlers; this module just supplies the primitives.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept current ±N steps to tolerate small clock skew
const SECRET_BYTES = 20; // RFC 4226 recommends 160 bits
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_GROUP_LENGTH = 4;
const RECOVERY_CODE_GROUPS = 3;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — for TOTP secrets and otpauth:// URIs
// ---------------------------------------------------------------------------
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  // No padding — most authenticator apps tolerate unpadded.
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238 / HOTP RFC 4226 with time-based counter)
// ---------------------------------------------------------------------------

function hotp(secret: Buffer, counter: bigint): string {
  const ctrBuf = Buffer.alloc(8);
  ctrBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(ctrBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpAt(secretBase32: string, atSeconds: number): string {
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor(atSeconds / TOTP_PERIOD_SECONDS));
  return hotp(secret, counter);
}

/**
 * Verify a TOTP code with ±TOTP_WINDOW step tolerance. Returns true on
 * any match within the window. Constant-time per candidate to avoid
 * leaking which step matched via timing.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secretBase32 || !/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const center = BigInt(Math.floor(nowSeconds / TOTP_PERIOD_SECONDS));
  let matched = false;
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const candidate = hotp(secret, center + BigInt(i));
    // Always run timingSafeEqual on equal-length buffers; combine via OR
    // so total time is constant regardless of where the match lands.
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      matched = true;
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Provisioning (otpauth:// URI for QR code rendering)
// ---------------------------------------------------------------------------

export function generateSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function provisioningUri(
  secretBase32: string,
  accountLabel: string,
  issuer = "FactoryLM",
): string {
  // Per Google Authenticator docs: the path is `otpauth://totp/<issuer>:<account>`
  // and `issuer` is also a query param so apps can deduplicate on rotation.
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes — single-use, hashed at rest
// ---------------------------------------------------------------------------

function randomGroup(): string {
  // Random base32-style alphabet without ambiguous chars (no 0/O/1/I)
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(RECOVERY_CODE_GROUP_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_GROUP_LENGTH; i++) {
    out += alpha[bytes[i]! % alpha.length];
  }
  return out;
}

export function generateRecoveryCodes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const groups: string[] = [];
    for (let g = 0; g < RECOVERY_CODE_GROUPS; g++) groups.push(randomGroup());
    out.push(groups.join("-"));
  }
  return out;
}

export function hashRecoveryCode(plaintext: string): string {
  // Simple SHA-256 hex. No salt: codes are 60 bits of entropy; rainbow
  // tables aren't a realistic threat at that bit-length. Per-tenant
  // pepper would be cleaner; defer with the broader at-rest encryption
  // hardening pass.
  return createHash("sha256")
    .update(plaintext.replace(/-/g, "").toUpperCase())
    .digest("hex");
}

/**
 * Match a user-provided recovery code against the stored hash list.
 * Returns the index of the matched hash so the caller can remove it
 * (single-use) — or -1 if no match.
 */
export function findRecoveryCodeIndex(
  plaintext: string,
  hashedList: string[],
): number {
  const candidate = hashRecoveryCode(plaintext);
  const candidateBuf = Buffer.from(candidate, "hex");
  let matchedIdx = -1;
  for (let i = 0; i < hashedList.length; i++) {
    const stored = Buffer.from(hashedList[i] || "", "hex");
    if (
      stored.length === candidateBuf.length &&
      timingSafeEqual(stored, candidateBuf)
    ) {
      matchedIdx = i;
    }
  }
  return matchedIdx;
}

// ---------------------------------------------------------------------------
// At-rest encryption for the TOTP secret (AES-256-GCM)
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  // Derive a stable 32-byte key from PLG_JWT_SECRET via HKDF-SHA256.
  // Using HKDF avoids reusing the JWT secret directly as an AES key.
  const baseSecret = process.env.PLG_JWT_SECRET;
  if (!baseSecret) throw new Error("PLG_JWT_SECRET not set; required for MFA");
  const ikm = Buffer.from(baseSecret, "utf8");
  const salt = Buffer.from("factorylm.mfa.v1", "utf8"); // versioned context
  const info = Buffer.from("aes-256-gcm secret", "utf8");
  const okm = hkdfSync("sha256", ikm, salt, info, 32);
  return Buffer.from(okm);
}

export function encryptSecret(secretBase32: string): string {
  const key = encryptionKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]).toString("base64");
}

export function decryptSecret(envelope: string): string {
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < 12 + 16) throw new Error("MFA secret envelope too short");
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const key = encryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
