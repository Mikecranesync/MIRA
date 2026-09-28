/**
 * OTA publish — build, sign, and stage an immutable web bundle for the VPS.
 *
 * Produces, under `ota-out/`:
 *   releases/<version>/<sha256-prefix>.zip   immutable artifact, never overwritten
 *   releases/<version>/<sha256-prefix>.json  immutable provenance for rollback
 *   manifest.<channel>.json                  the signed pointer
 *
 * IMMUTABILITY IS THE WHOLE DESIGN. The artifact path contains the content
 * hash, so republishing identical content is a no-op and republishing changed
 * content necessarily lands somewhere new. Rollback is therefore never a
 * rebuild: it repoints the manifest at a release that is still sitting there,
 * byte-for-byte as it was verified. `ota-rollback.mjs` does exactly that and
 * nothing else.
 *
 * WHAT SIGNS WHAT. The artifact signature covers the zip bytes and is verified
 * by the native plugin. A separate provenance signature covers the immutable
 * artifact digest, artifact signature, and native compatibility fingerprint;
 * rollback and the Hub verify that envelope before selecting or serving it.
 * Both are required: authentic bytes alone do not authenticate a mutable
 * manifest's claim that those bytes are compatible with this native shell.
 *
 * Production use goes through the isolated OTA workflow: a secret-free runner
 * builds the ZIP, then a fresh signing runner fetches only the private key,
 * drops Doppler access, and invokes this script with `--bundle`.
 */
import { createHash, createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFingerprint } from "./native-fingerprint.mjs";
import {
  PROVENANCE_FIELDS,
  assertArtifactDigest,
  releasedAtFromBuildEpoch,
  signManifestPointer,
  signProvenance,
  verifyArtifactSignature,
  verifyManifestPointer,
  verifyProvenance,
} from "./ota-provenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "ota-out");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const channel = arg("channel", "canary");
const version = arg("version");
const requestedBundle = arg("bundle");
const releaseSha = process.env.GITHUB_SHA;
const buildEpoch = process.env.BUILD_EPOCH;
if (channel !== "canary") {
  console.error(
    `--channel must be canary (got ${channel}); promote to production with ` +
      "ota-rollback.mjs --channel production --require-source-channel canary --to <release>",
  );
  process.exit(2);
}
if (!version) {
  console.error("--version is required, e.g. --version 1.0.1");
  process.exit(2);
}
if (!requestedBundle) {
  console.error("--bundle <deterministic.zip> is required; build/package in a secret-free job");
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(releaseSha ?? "")) {
  console.error("GITHUB_SHA must be the canonical lowercase 40-character release commit.");
  process.exit(2);
}
let releasedAt;
try {
  releasedAt = releasedAtFromBuildEpoch(buildEpoch);
} catch (error) {
  console.error(`BUILD_EPOCH is invalid: ${error.message}`);
  process.exit(2);
}

const privateKey = process.env.OTA_SIGNING_PRIVATE_KEY;
if (!privateKey || !privateKey.includes("PRIVATE KEY")) {
  console.error(
    "OTA_SIGNING_PRIVATE_KEY is not present in the environment.\n" +
      "Use the isolated OTA release workflow; do not run repository build code under Doppler.",
  );
  process.exit(2);
}

// The build and dependency graph ran on a separate secret-free runner. This
// process only reads and signs its immutable artifact.
const bundlePath = isAbsolute(requestedBundle)
  ? requestedBundle
  : resolve(root, requestedBundle);
if (!existsSync(bundlePath)) {
  console.error(`bundle not found: ${bundlePath}`);
  process.exit(1);
}
const zipBytes = readFileSync(bundlePath);
// The plugin parses `checksum` as a SHA-256 in HEX (capacitor-live-update
// README, downloadBundle options); only `signature` is base64. Publishing the
// checksum as base64 made every bundle fail the phone's integrity check
// ("Refused — the update failed its integrity check") — proven on a Pixel 9a
// against canary 1.1.2 on 2026-09-06, and equally true of 1.1.1.
const sha256 = createHash("sha256").update(zipBytes).digest("hex");

// 3. Immutable destination, keyed by content. Same bytes → same path.
const relDir = join(OUT, "releases", version);
mkdirSync(relDir, { recursive: true });
const artifactName = `${sha256.slice(0, 16)}.zip`;
const artifactPath = join(relDir, artifactName);
let artifactAlreadyExisted = false;
try {
  writeFileSync(artifactPath, zipBytes, { flag: "wx" });
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  artifactAlreadyExisted = true;
}

try {
  // Always authenticate the bytes at the staged path, including after a
  // successful write. Signing only the in-memory input would otherwise permit
  // a colliding/truncated path to diverge from the signed release metadata.
  assertArtifactDigest(readFileSync(artifactPath), sha256);
} catch (error) {
  console.error(`INTEGRITY FAILURE: ${error.message}`);
  process.exit(1);
}
if (artifactAlreadyExisted) {
  console.log(`artifact already exists (identical content): ${version}/${artifactName}`);
}

// 4. Sign the ARTIFACT DIGEST, not the manifest.
const signer = createSign("RSA-SHA256");
signer.update(zipBytes);
const signature = signer.sign(privateKey, "base64");
if (!verifyArtifactSignature(zipBytes, signature)) {
  console.error("SIGNING FAILURE: OTA private key does not match the public key compiled into the app.");
  process.exit(1);
}

const bundleId = `${version}-${sha256.slice(0, 8)}`;
const baseUrl = arg("base-url", "https://updates.factorylm.com");
const artifactMetadataPath = join(relDir, `${sha256.slice(0, 16)}.json`);
let artifactMetadata = {
  bundleId,
  version,
  artifact: artifactName,
  checksum: sha256,
  signature,
  // The compatibility gate: the shell refuses a bundle whose fingerprint is not
  // its own, so a bundle needing a plugin the installed APK lacks can never be
  // applied — it is rejected before download.
  nativeFingerprint: nativeFingerprint(),
  releaseSha,
  releasedAt,
  artifactSha256: sha256,
};
artifactMetadata.provenanceSignature = signProvenance(artifactMetadata, privateKey);
if (!verifyProvenance(artifactMetadata, artifactMetadata.provenanceSignature)) {
  console.error("SIGNING FAILURE: OTA provenance signature did not verify");
  process.exit(1);
}

let metadataAlreadyExisted = false;
try {
  writeFileSync(
    artifactMetadataPath,
    JSON.stringify(artifactMetadata, null, 2) + "\n",
    { flag: "wx" },
  );
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  metadataAlreadyExisted = true;
}
if (metadataAlreadyExisted) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(artifactMetadataPath, "utf8"));
  } catch {
    console.error("INTEGRITY FAILURE: immutable artifact metadata is not valid JSON");
    process.exit(1);
  }
  for (const key of PROVENANCE_FIELDS) {
    if (existing[key] !== artifactMetadata[key]) {
      console.error(`INTEGRITY FAILURE: immutable artifact metadata differs at ${key}`);
      process.exit(1);
    }
  }
  if (
    !verifyArtifactSignature(zipBytes, existing.signature) ||
    !verifyProvenance(existing, existing.provenanceSignature)
  ) {
    console.error("INTEGRITY FAILURE: immutable artifact or provenance signature is invalid");
    process.exit(1);
  }
  artifactMetadata = existing;
}

const manifest = {
  ...artifactMetadata,
  channel,
  downloadUrl: `${baseUrl}/releases/${version}/${artifactName}`,
  pointerChangedAt: new Date().toISOString(),
};
manifest.manifestSignature = signManifestPointer(manifest, privateKey);
if (!verifyManifestPointer(manifest, manifest.manifestSignature)) {
  console.error("SIGNING FAILURE: OTA manifest-pointer signature did not verify");
  process.exit(1);
}

writeFileSync(join(OUT, `manifest.${channel}.json`), JSON.stringify(manifest, null, 2) + "\n");

console.log(`
published (staged locally — nothing uploaded yet)
  channel       ${channel}
  bundleId      ${bundleId}
  artifact      releases/${version}/${artifactName}
  sha256        ${sha256}
  fingerprint   ${manifest.nativeFingerprint}
  manifest      ota-out/manifest.${channel}.json

next: node scripts/ota-deploy.mjs --channel ${channel}
`);
