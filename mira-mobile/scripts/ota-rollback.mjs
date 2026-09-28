/**
 * OTA rollback — repoint a channel's signed manifest at an earlier release.
 *
 * Rollback NEVER rebuilds and NEVER modifies an existing artifact. The bundle
 * you are rolling back to is still on disk exactly as it was verified when it
 * was published; this rewrites only the pointer. That is the whole reason
 * artifacts are immutable and content-addressed — "the thing that worked
 * yesterday" has to still be the same bytes, or rollback is just another deploy
 * with the same risk of being wrong.
 *
 * The original immutable metadata supplies the signature and native
 * fingerprint. Rollback never invents compatibility for historical bytes.
 *
 * Usage:
 *   node scripts/ota-rollback.mjs --channel production --list
 *   # Production pointer changes use the isolated OTA workflow, which fetches
 *   # only the signing key on a fresh runner before invoking this script.
 *   # Every production rollback must first be the exact signed canary pointer:
 *   node scripts/ota-rollback.mjs --channel production --require-source-channel canary \
 *     --to 1.0.0/0011223344556677.zip
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFingerprint } from "./native-fingerprint.mjs";
import {
  PROVENANCE_FIELDS,
  signManifestPointer,
  validatePromotionSource,
  verifyArtifactSignature,
  verifyManifestPointer,
  verifyProvenance,
} from "./ota-provenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "ota-out");
const RELEASES = join(OUT, "releases");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const channel = arg("channel", "production");
const wantList = process.argv.includes("--list");
const to = arg("to");
const requireSourceChannel = arg("require-source-channel");
if (!["canary", "production"].includes(channel)) {
  console.error(`--channel must be canary|production (got ${channel})`);
  process.exit(2);
}
if (requireSourceChannel && requireSourceChannel !== "canary") {
  console.error("--require-source-channel currently supports only canary promotion.");
  process.exit(2);
}
if (!wantList && channel === "production" && requireSourceChannel !== "canary") {
  console.error(
    "Production pointer changes require --require-source-channel canary; " +
      "there is no direct or break-glass bypass.",
  );
  process.exit(2);
}
if (requireSourceChannel && channel !== "production") {
  console.error("--require-source-channel is only valid when targeting production.");
  process.exit(2);
}

/** Every immutable artifact still on disk, newest version last. */
function available() {
  if (!existsSync(RELEASES)) return [];
  const out = [];
  for (const version of readdirSync(RELEASES).sort()) {
    const dir = join(RELEASES, version);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".zip"))) {
      out.push({ version, file: f, rel: `${version}/${f}`, path: join(dir, f) });
    }
  }
  return out;
}

if (wantList) {
  const rows = available();
  const current = join(OUT, `manifest.${channel}.json`);
  const active = existsSync(current) ? JSON.parse(readFileSync(current, "utf8")) : null;
  console.log(`available releases (channel: ${channel})\n`);
  for (const r of rows) {
    const isActive = active && active.downloadUrl.endsWith(r.rel);
    console.log(`  ${isActive ? "*" : " "} ${r.rel}`);
  }
  console.log(`\n* = currently pointed to by manifest.${channel}.json`);
  process.exit(0);
}

if (!to) {
  console.error("--to <version>/<file>.zip is required (see --list)");
  process.exit(2);
}

const privateKey = process.env.OTA_SIGNING_PRIVATE_KEY;
if (!privateKey || !privateKey.includes("PRIVATE KEY")) {
  console.error("OTA_SIGNING_PRIVATE_KEY is required to authorize a channel pointer change.");
  process.exit(2);
}

let promotionSource = null;
if (requireSourceChannel) {
  const sourcePath = join(OUT, `manifest.${requireSourceChannel}.json`);
  try {
    promotionSource = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch {
    console.error(
      `PROMOTION FAILURE: current signed ${requireSourceChannel} pointer is missing or unreadable.`,
    );
    process.exit(1);
  }
  const sourceCheck = validatePromotionSource(promotionSource, {
    sourceChannel: requireSourceChannel,
    target: to,
  });
  if (!sourceCheck.ok) {
    console.error(
      `PROMOTION FAILURE: ${requireSourceChannel} cannot authorize ${to} (${sourceCheck.reason}).`,
    );
    process.exit(1);
  }
}

const target = available().find((r) => r.rel === to);
if (!target) {
  console.error(`no such release: ${to}\nrun with --list to see what exists`);
  process.exit(1);
}

// Read the artifact that ALREADY EXISTS. Nothing is rebuilt.
const bytes = readFileSync(target.path);
const sha256 = createHash("sha256").update(bytes).digest("hex");

// Content-addressed: if these disagree the file on disk is not the file that
// was published under that name, which means something has tampered with the
// artifact store. Refuse rather than sign whatever is there now.
if (!target.file.startsWith(sha256.slice(0, 16))) {
  console.error(
    `INTEGRITY FAILURE: ${target.rel} does not hash to its own name.\n` +
      `  expected prefix ${target.file.replace(".zip", "")}\n` +
      `  actual sha256   ${sha256.slice(0, 16)}\n` +
      "Refusing to sign a mutated artifact.",
  );
  process.exit(1);
}

const artifactMetadataPath = target.path.replace(/\.zip$/, ".json");
if (!existsSync(artifactMetadataPath)) {
  console.error(`PROVENANCE FAILURE: immutable metadata missing for ${target.rel}.`);
  process.exit(1);
}

let metadata;
try {
  metadata = JSON.parse(readFileSync(artifactMetadataPath, "utf8"));
} catch {
  console.error(`PROVENANCE FAILURE: unreadable metadata for ${target.rel}.`);
  process.exit(1);
}

if (
  metadata.version !== target.version ||
  metadata.artifact !== target.file ||
  metadata.checksum !== sha256 ||
  metadata.artifactSha256 !== sha256 ||
  typeof metadata.signature !== "string" ||
  !metadata.signature ||
  typeof metadata.provenanceSignature !== "string" ||
  !metadata.provenanceSignature ||
  typeof metadata.nativeFingerprint !== "string" ||
  !metadata.nativeFingerprint
) {
  console.error(`PROVENANCE FAILURE: metadata does not bind exactly to ${target.rel}.`);
  process.exit(1);
}

if (
  promotionSource &&
  (PROVENANCE_FIELDS.some((field) => promotionSource[field] !== metadata[field]) ||
    promotionSource.provenanceSignature !== metadata.provenanceSignature)
) {
  console.error(
    `PROMOTION FAILURE: local provenance for ${target.rel} differs from the signed ${requireSourceChannel} pointer.`,
  );
  process.exit(1);
}

if (
  !verifyArtifactSignature(bytes, metadata.signature) ||
  !verifyProvenance(metadata, metadata.provenanceSignature)
) {
  console.error(`PROVENANCE FAILURE: signatures do not authenticate ${target.rel}.`);
  process.exit(1);
}

if (metadata.nativeFingerprint !== nativeFingerprint()) {
  console.error(
    `COMPATIBILITY FAILURE: ${target.rel} was built for native fingerprint ` +
      `${metadata.nativeFingerprint}, not the current shell ${nativeFingerprint()}.`,
  );
  process.exit(1);
}

const baseUrl = arg("base-url", "https://updates.factorylm.com");
const manifest = {
  bundleId: metadata.bundleId,
  version: target.version,
  channel,
  downloadUrl: `${baseUrl}/releases/${target.rel}`,
  checksum: sha256,
  artifact: metadata.artifact,
  signature: metadata.signature,
  provenanceSignature: metadata.provenanceSignature,
  nativeFingerprint: metadata.nativeFingerprint,
  releaseSha: metadata.releaseSha,
  // `releasedAt` is immutable artifact provenance and is covered by its
  // signature. Do not restamp it while moving the channel pointer.
  releasedAt: metadata.releasedAt,
  pointerChangedAt: new Date().toISOString(),
  artifactSha256: sha256,
  rolledBackTo: target.rel,
};
manifest.manifestSignature = signManifestPointer(manifest, privateKey);
if (!verifyManifestPointer(manifest, manifest.manifestSignature)) {
  console.error("SIGNING FAILURE: OTA manifest-pointer signature did not verify.");
  process.exit(1);
}

writeFileSync(join(OUT, `manifest.${channel}.json`), JSON.stringify(manifest, null, 2) + "\n");

console.log(`
${promotionSource ? "promoted from canary" : "rolled back"} (staged locally — nothing uploaded yet)
  channel   ${channel}
  now       ${target.rel}
  bundleId  ${manifest.bundleId}

next: node scripts/ota-deploy.mjs --channel ${channel}
`);
