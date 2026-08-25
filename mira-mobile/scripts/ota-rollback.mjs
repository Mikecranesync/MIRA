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
 * The signature is regenerated over those existing bytes with the same private
 * key, so a rolled-back manifest is as verifiable as the original.
 *
 * Usage:
 *   node scripts/ota-rollback.mjs --channel production --list
 *   doppler run --project factorylm --config prd -- \
 *     node scripts/ota-rollback.mjs --channel production --to 1.0.1/ab12cd34ef567890.zip
 */
import { createHash, createSign } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFingerprint } from "./native-fingerprint.mjs";

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

const target = available().find((r) => r.rel === to);
if (!target) {
  console.error(`no such release: ${to}\nrun with --list to see what exists`);
  process.exit(1);
}

const privateKey = process.env.OTA_SIGNING_PRIVATE_KEY;
if (!privateKey || !privateKey.includes("PRIVATE KEY")) {
  console.error("OTA_SIGNING_PRIVATE_KEY missing — run under `doppler run`.");
  process.exit(2);
}

// Read the artifact that ALREADY EXISTS. Nothing is rebuilt.
const bytes = readFileSync(target.path);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const checksumB64 = createHash("sha256").update(bytes).digest("base64");

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

const signer = createSign("RSA-SHA256");
signer.update(bytes);
const signature = signer.sign(privateKey, "base64");

const baseUrl = arg("base-url", "https://updates.factorylm.com");
const manifest = {
  bundleId: `${target.version}-${sha256.slice(0, 8)}`,
  version: target.version,
  channel,
  downloadUrl: `${baseUrl}/releases/${target.rel}`,
  checksum: checksumB64,
  signature,
  nativeFingerprint: nativeFingerprint(),
  releaseSha: "rollback",
  releasedAt: new Date().toISOString(),
  artifactSha256: sha256,
  rolledBackTo: target.rel,
};

writeFileSync(join(OUT, `manifest.${channel}.json`), JSON.stringify(manifest, null, 2) + "\n");

console.log(`
rolled back (staged locally — nothing uploaded yet)
  channel   ${channel}
  now       ${target.rel}
  bundleId  ${manifest.bundleId}

next: node scripts/ota-deploy.mjs --channel ${channel}
`);
