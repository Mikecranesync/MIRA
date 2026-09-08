import { createVerify, type KeyLike } from "node:crypto";

// Byte-for-byte identical to the native LiveUpdate key and the release-script
// verifier. The three production build contexts cannot share a source file;
// lifecycle tests fail if these constants drift.
const OTA_PUBLIC_KEY_COMPACT =
  "-----BEGIN PUBLIC KEY-----MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAuLU3ebXbdfu76Jpfc6rLCMU0kOsPEcrTj/0hQUrEyThtXJBsEh7Hr2Up058ibAt1lQkikjft+ilf8CMeQ/K4dZeKSuxxiOVkAiDVGKh1PLplSI6RRYT2mK1RzD3KeMaM2Dd42IJ4ql/VSEnCgvhjpEAyTxYQKrecgE3YCLxeOFIP1q06mspdipsoegx3N8znyfWvdhamvxIoXKV+PIQv0AsZdczG8sNOUq+tauVuhIocl0RXyOXw60M5L7N+u81hj1xfDtGHGkjd+8tO+W3SA6EKYqENE9YUs4Zth2gDqLmG9cmdr4AoRjmiq+51aHKiht/g7ots/nILeeUYnnyyb1c4Ga1wphzWrDSi71GH16+WQOqeA3nL2r5TRB4XHFFRA9WoT8diA0hP6gl/rYVvPFNgHaVXD/1UB1MsVC3xZLdkaVkXfqhFvNb15/e/4blcFc3LJPtNpn8w9KxA1o4BDpOmwH2aOWEc4muxESy6ekgzJ9GcbhOyz+f6K6y+CwaTAQpX2HFuVZCxY/YgVUt419k9+vOWqLnbV9rG56UdEy5JzA+lcFcO8/qVPVg6j0WbORDbYkywDfxRO6GNJYtomSB1ow6aU1SBty7EOMzsmCyQhd5K9Gw2J1sl+RybneV6/YqvHkd7gTCySOrMjKA+gaScinwgbKAkSt7vXATKyRECAwEAAQ==-----END PUBLIC KEY-----";

export const OTA_PUBLIC_KEY = OTA_PUBLIC_KEY_COMPACT
  .replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN PUBLIC KEY-----\n")
  .replace("-----END PUBLIC KEY-----", "\n-----END PUBLIC KEY-----\n");

const PROVENANCE_FIELDS = [
  "bundleId",
  "version",
  "artifact",
  "checksum",
  "signature",
  "nativeFingerprint",
  "releaseSha",
  "releasedAt",
  "artifactSha256",
] as const;

const MANIFEST_POINTER_FIELDS = [
  ...PROVENANCE_FIELDS,
  "provenanceSignature",
  "channel",
  "downloadUrl",
  "pointerChangedAt",
] as const;

const CANONICAL_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_RELEASE_SHA_RE = /^[0-9a-f]{40}$/;

export function isCanonicalPointerTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_RE.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function signedPayload(
  protocol: string,
  fields: readonly string[],
  value: Record<string, unknown>,
): string {
  const lines = [protocol];
  for (const field of fields) {
    const item = value[field];
    if (typeof item !== "string" || !item || /[\r\n]/.test(item)) {
      throw new TypeError(`invalid OTA signed field: ${field}`);
    }
    lines.push(`${field}=${item}`);
  }
  return `${lines.join("\n")}\n`;
}

export function provenancePayload(value: Record<string, unknown>): string {
  if (
    typeof value.releaseSha !== "string" ||
    !CANONICAL_RELEASE_SHA_RE.test(value.releaseSha)
  ) {
    throw new TypeError("invalid OTA signed field: releaseSha");
  }
  return signedPayload("factorylm-ota-provenance-v1", PROVENANCE_FIELDS, value);
}

export function manifestPointerPayload(value: Record<string, unknown>): string {
  if (!isCanonicalPointerTimestamp(value.pointerChangedAt)) {
    throw new TypeError("invalid OTA signed field: pointerChangedAt");
  }
  if (!isCanonicalPointerTimestamp(value.releasedAt)) {
    throw new TypeError("invalid OTA signed field: releasedAt");
  }
  if (Date.parse(value.pointerChangedAt) < Date.parse(value.releasedAt)) {
    throw new TypeError("OTA pointer timestamp predates its authenticated release");
  }
  return signedPayload(
    "factorylm-ota-manifest-pointer-v1",
    MANIFEST_POINTER_FIELDS,
    value,
  );
}

function verifies(payload: string, signature: unknown, publicKey: KeyLike | string): boolean {
  if (typeof signature !== "string" || !signature) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(payload, "utf8");
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
}

/** Authenticate both immutable artifact claims and the mutable channel pointer. */
export function verifyPublishedManifestProvenance(
  value: Record<string, unknown>,
  publicKey: KeyLike | string = OTA_PUBLIC_KEY,
): boolean {
  try {
    return (
      verifies(provenancePayload(value), value.provenanceSignature, publicKey) &&
      verifies(manifestPointerPayload(value), value.manifestSignature, publicKey)
    );
  } catch {
    return false;
  }
}
