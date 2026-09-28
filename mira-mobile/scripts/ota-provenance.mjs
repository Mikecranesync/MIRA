/**
 * Cryptographic trust helpers shared by OTA publish and rollback.
 *
 * The LiveUpdate plugin authenticates the ZIP bytes. This second signature
 * authenticates the immutable claims ABOUT those bytes, most importantly the
 * native compatibility fingerprint. Without it, a release-store attacker
 * could replay an older legitimately signed ZIP while rewriting its unsigned
 * fingerprint to match a newer shell.
 */
import { createHash, createSign, createVerify } from "node:crypto";

// Keep byte-for-byte identical to `plugins.LiveUpdate.publicKey` in
// capacitor.config.ts and OTA_PUBLIC_KEY in
// mira-hub/src/capabilities/ota-provenance.ts.
// The lifecycle tests pin all three copies together because each module has a
// separate production build context.
const OTA_PUBLIC_KEY_COMPACT =
  "-----BEGIN PUBLIC KEY-----MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAuLU3ebXbdfu76Jpfc6rLCMU0kOsPEcrTj/0hQUrEyThtXJBsEh7Hr2Up058ibAt1lQkikjft+ilf8CMeQ/K4dZeKSuxxiOVkAiDVGKh1PLplSI6RRYT2mK1RzD3KeMaM2Dd42IJ4ql/VSEnCgvhjpEAyTxYQKrecgE3YCLxeOFIP1q06mspdipsoegx3N8znyfWvdhamvxIoXKV+PIQv0AsZdczG8sNOUq+tauVuhIocl0RXyOXw60M5L7N+u81hj1xfDtGHGkjd+8tO+W3SA6EKYqENE9YUs4Zth2gDqLmG9cmdr4AoRjmiq+51aHKiht/g7ots/nILeeUYnnyyb1c4Ga1wphzWrDSi71GH16+WQOqeA3nL2r5TRB4XHFFRA9WoT8diA0hP6gl/rYVvPFNgHaVXD/1UB1MsVC3xZLdkaVkXfqhFvNb15/e/4blcFc3LJPtNpn8w9KxA1o4BDpOmwH2aOWEc4muxESy6ekgzJ9GcbhOyz+f6K6y+CwaTAQpX2HFuVZCxY/YgVUt419k9+vOWqLnbV9rG56UdEy5JzA+lcFcO8/qVPVg6j0WbORDbYkywDfxRO6GNJYtomSB1ow6aU1SBty7EOMzsmCyQhd5K9Gw2J1sl+RybneV6/YqvHkd7gTCySOrMjKA+gaScinwgbKAkSt7vXATKyRECAwEAAQ==-----END PUBLIC KEY-----";

export const OTA_PUBLIC_KEY = OTA_PUBLIC_KEY_COMPACT
  .replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN PUBLIC KEY-----\n")
  .replace("-----END PUBLIC KEY-----", "\n-----END PUBLIC KEY-----\n");

export const PROVENANCE_FIELDS = Object.freeze([
  "bundleId",
  "version",
  "artifact",
  "checksum",
  "signature",
  "nativeFingerprint",
  "releaseSha",
  "releasedAt",
  "artifactSha256",
]);

export const MANIFEST_POINTER_FIELDS = Object.freeze([
  ...PROVENANCE_FIELDS,
  "provenanceSignature",
  "channel",
  "downloadUrl",
  "pointerChangedAt",
]);

const CANONICAL_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const CANONICAL_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const CANONICAL_ARTIFACT_RE = /^[0-9a-f]{16}\.zip$/;
const CANONICAL_FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/** Exact UTC-millisecond form prevents equivalent spellings from bypassing ordering. */
export function isCanonicalPointerTimestamp(value) {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_RE.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

/** Stable immutable provenance time derived from the governed build attempt. */
export function releasedAtFromBuildEpoch(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("governed build epoch must be whole UTC seconds");
  }
  const millis = Number(value) * 1_000;
  if (!Number.isSafeInteger(millis)) {
    throw new TypeError("governed build epoch is outside the safe date range");
  }
  try {
    return new Date(millis).toISOString();
  } catch {
    throw new TypeError("governed build epoch is outside the supported date range");
  }
}

function signedPayload(protocol, fields, value) {
  const lines = [protocol];
  for (const field of fields) {
    const item = value?.[field];
    if (typeof item !== "string" || !item || /[\r\n]/.test(item)) {
      throw new TypeError(`invalid OTA signed field: ${field}`);
    }
    lines.push(`${field}=${item}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Stable, line-oriented encoding; field names and order are protocol data. */
export function provenancePayload(metadata) {
  if (!CANONICAL_RELEASE_SHA_RE.test(metadata?.releaseSha ?? "")) {
    throw new TypeError("invalid OTA signed field: releaseSha");
  }
  return signedPayload("factorylm-ota-provenance-v1", PROVENANCE_FIELDS, metadata);
}

export function manifestPointerPayload(manifest) {
  if (!isCanonicalPointerTimestamp(manifest?.pointerChangedAt)) {
    throw new TypeError("invalid OTA signed field: pointerChangedAt");
  }
  if (!isCanonicalPointerTimestamp(manifest?.releasedAt)) {
    throw new TypeError("invalid OTA signed field: releasedAt");
  }
  if (Date.parse(manifest.pointerChangedAt) < Date.parse(manifest.releasedAt)) {
    throw new TypeError("OTA pointer timestamp predates its authenticated release");
  }
  return signedPayload(
    "factorylm-ota-manifest-pointer-v1",
    MANIFEST_POINTER_FIELDS,
    manifest,
  );
}

export function signProvenance(metadata, privateKey) {
  const signer = createSign("RSA-SHA256");
  signer.update(provenancePayload(metadata), "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

export function verifyProvenance(
  metadata,
  provenanceSignature,
  publicKey = OTA_PUBLIC_KEY,
) {
  try {
    if (typeof provenanceSignature !== "string" || !provenanceSignature) return false;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(provenancePayload(metadata), "utf8");
    verifier.end();
    return verifier.verify(publicKey, provenanceSignature, "base64");
  } catch {
    return false;
  }
}

export function verifyArtifactSignature(bytes, signature, publicKey = OTA_PUBLIC_KEY) {
  try {
    if (typeof signature !== "string" || !signature) return false;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(bytes);
    verifier.end();
    return verifier.verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

/** Refuse truncated-name collisions or corruption before reusing an immutable path. */
export function assertArtifactDigest(bytes, expectedSha256) {
  if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new TypeError("expected artifact SHA-256 must be lowercase hex");
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `immutable artifact digest mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return actualSha256;
}

/** Authenticate every local input before a deploy process is allowed to upload. */
export function validateStagedRelease({
  artifactBytes,
  metadata,
  manifest,
  channel,
  currentNativeFingerprint,
  publicKey = OTA_PUBLIC_KEY,
} = {}) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "invalid_manifest" };
  }
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, reason: "invalid_metadata" };
  }
  if (manifest.channel !== channel) {
    return { ok: false, reason: "channel_mismatch" };
  }
  if (!CANONICAL_VERSION_RE.test(manifest.version ?? "")) {
    return { ok: false, reason: "invalid_version" };
  }
  if (!CANONICAL_ARTIFACT_RE.test(manifest.artifact ?? "")) {
    return { ok: false, reason: "invalid_artifact" };
  }
  if (!CANONICAL_RELEASE_SHA_RE.test(manifest.releaseSha ?? "")) {
    return { ok: false, reason: "invalid_release_sha" };
  }
  if (!isCanonicalPointerTimestamp(manifest.releasedAt)) {
    return { ok: false, reason: "invalid_release_timestamp" };
  }
  if (!isCanonicalPointerTimestamp(manifest.pointerChangedAt)) {
    return { ok: false, reason: "invalid_pointer_timestamp" };
  }
  if (Date.parse(manifest.pointerChangedAt) < Date.parse(manifest.releasedAt)) {
    return { ok: false, reason: "pointer_predates_release" };
  }
  if (
    !CANONICAL_FINGERPRINT_RE.test(currentNativeFingerprint ?? "") ||
    manifest.nativeFingerprint !== currentNativeFingerprint
  ) {
    return { ok: false, reason: "native_fingerprint_mismatch" };
  }

  let artifactSha256;
  try {
    artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  } catch {
    return { ok: false, reason: "invalid_artifact_bytes" };
  }
  if (
    manifest.checksum !== artifactSha256 ||
    manifest.artifactSha256 !== artifactSha256 ||
    manifest.artifact !== `${artifactSha256.slice(0, 16)}.zip`
  ) {
    return { ok: false, reason: "artifact_digest_mismatch" };
  }
  if (manifest.bundleId !== `${manifest.version}-${artifactSha256.slice(0, 8)}`) {
    return { ok: false, reason: "invalid_bundle_id" };
  }
  if (
    manifest.downloadUrl !==
    `https://updates.factorylm.com/releases/${manifest.version}/${manifest.artifact}`
  ) {
    return { ok: false, reason: "invalid_download_url" };
  }
  if (
    PROVENANCE_FIELDS.some((field) => metadata[field] !== manifest[field]) ||
    metadata.provenanceSignature !== manifest.provenanceSignature
  ) {
    return { ok: false, reason: "metadata_mismatch" };
  }
  if (!verifyArtifactSignature(artifactBytes, manifest.signature, publicKey)) {
    return { ok: false, reason: "invalid_artifact_signature" };
  }
  if (!verifyProvenance(metadata, metadata.provenanceSignature, publicKey)) {
    return { ok: false, reason: "invalid_provenance_signature" };
  }
  if (!verifyManifestPointer(manifest, manifest.manifestSignature, publicKey)) {
    return { ok: false, reason: "invalid_pointer_signature" };
  }
  return { ok: true, artifactSha256 };
}

function isAuthenticatedChannelPointer(value, channel, publicKey) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.channel === channel &&
    CANONICAL_RELEASE_SHA_RE.test(value.releaseSha ?? "") &&
    isCanonicalPointerTimestamp(value.releasedAt) &&
    isCanonicalPointerTimestamp(value.pointerChangedAt) &&
    verifyProvenance(value, value.provenanceSignature, publicKey) &&
    verifyManifestPointer(value, value.manifestSignature, publicKey)
  );
}

function bytesDescribeValue(bytes, value) {
  try {
    return (
      JSON.stringify(JSON.parse(Buffer.from(bytes).toString("utf8"))) ===
      JSON.stringify(value)
    );
  } catch {
    return false;
  }
}

/** Enforce monotonic channel pointers while permitting a byte-identical retry. */
export function validatePointerTransition({
  liveManifest,
  liveBytes,
  candidateManifest,
  candidateBytes,
  channel,
  publicKey = OTA_PUBLIC_KEY,
} = {}) {
  if (
    !isAuthenticatedChannelPointer(candidateManifest, channel, publicKey) ||
    !bytesDescribeValue(candidateBytes, candidateManifest)
  ) {
    return { ok: false, reason: "invalid_candidate_pointer" };
  }
  if (liveManifest === null && liveBytes === null) {
    return { ok: true, idempotent: false, expectedLiveSha256: null };
  }
  if (
    !isAuthenticatedChannelPointer(liveManifest, channel, publicKey) ||
    !bytesDescribeValue(liveBytes, liveManifest)
  ) {
    return { ok: false, reason: "invalid_live_pointer" };
  }

  const liveBuffer = Buffer.from(liveBytes);
  const candidateBuffer = Buffer.from(candidateBytes);
  const expectedLiveSha256 = createHash("sha256").update(liveBuffer).digest("hex");
  const liveMillis = Date.parse(liveManifest.pointerChangedAt);
  const candidateMillis = Date.parse(candidateManifest.pointerChangedAt);
  if (candidateMillis > liveMillis) {
    return { ok: true, idempotent: false, expectedLiveSha256 };
  }
  if (candidateMillis === liveMillis && candidateBuffer.equals(liveBuffer)) {
    return { ok: true, idempotent: true, expectedLiveSha256 };
  }
  return { ok: false, reason: "pointer_not_advanced" };
}

export function signManifestPointer(manifest, privateKey) {
  const signer = createSign("RSA-SHA256");
  signer.update(manifestPointerPayload(manifest), "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

export function verifyManifestPointer(
  manifest,
  manifestSignature,
  publicKey = OTA_PUBLIC_KEY,
) {
  try {
    if (typeof manifestSignature !== "string" || !manifestSignature) return false;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(manifestPointerPayload(manifest), "utf8");
    verifier.end();
    return verifier.verify(publicKey, manifestSignature, "base64");
  } catch {
    return false;
  }
}

/** Verify an authenticated channel pointer names exactly the release being promoted. */
export function validatePromotionSource(
  manifest,
  { sourceChannel, target, publicKey = OTA_PUBLIC_KEY },
) {
  if (manifest?.channel !== sourceChannel) {
    return { ok: false, reason: "source_channel_mismatch" };
  }
  if (!CANONICAL_RELEASE_SHA_RE.test(manifest?.releaseSha ?? "")) {
    return { ok: false, reason: "invalid_source_release_sha" };
  }
  if (
    !verifyProvenance(manifest, manifest?.provenanceSignature, publicKey) ||
    !verifyManifestPointer(manifest, manifest?.manifestSignature, publicKey)
  ) {
    return { ok: false, reason: "invalid_source_signature" };
  }
  if (`${manifest.version}/${manifest.artifact}` !== target) {
    return { ok: false, reason: "source_target_mismatch" };
  }
  return { ok: true };
}
