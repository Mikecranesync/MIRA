/**
 * OTA publish — build, sign, and stage an immutable web bundle for the VPS.
 *
 * Produces, under `ota-out/`:
 *   releases/<version>/<sha256-prefix>.zip   immutable artifact, never overwritten
 *   manifest.<channel>.json                  the signed pointer
 *
 * IMMUTABILITY IS THE WHOLE DESIGN. The artifact path contains the content
 * hash, so republishing identical content is a no-op and republishing changed
 * content necessarily lands somewhere new. Rollback is therefore never a
 * rebuild: it repoints the manifest at a release that is still sitting there,
 * byte-for-byte as it was verified. `ota-rollback.mjs` does exactly that and
 * nothing else.
 *
 * WHAT SIGNS WHAT. The signature covers the SHA-256 digest of the zip, which is
 * what the plugin verifies on-device against the public key compiled into the
 * APK. Signing the manifest JSON instead would be weaker: a manifest is only a
 * pointer, and an attacker who can swap the artifact underneath a signed
 * pointer wins. Signing the artifact digest means the bytes themselves are what
 * carry the proof.
 *
 * Usage (private key never touches the command line — it comes from Doppler):
 *   doppler run --project factorylm --config prd -- \
 *     node scripts/ota-publish.mjs --channel canary --version 1.0.1
 */
import { execFileSync } from "node:child_process";
import { createHash, createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFingerprint } from "./native-fingerprint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "ota-out");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", cwd: root, ...opts });
}

const channel = arg("channel", "canary");
const version = arg("version");
if (!["canary", "production"].includes(channel)) {
  console.error(`--channel must be canary|production (got ${channel})`);
  process.exit(2);
}
if (!version) {
  console.error("--version is required, e.g. --version 1.0.1");
  process.exit(2);
}

const privateKey = process.env.OTA_SIGNING_PRIVATE_KEY;
if (!privateKey || !privateKey.includes("PRIVATE KEY")) {
  console.error(
    "OTA_SIGNING_PRIVATE_KEY is not present in the environment.\n" +
      "Run under Doppler:\n" +
      "  doppler run --project factorylm --config prd -- node scripts/ota-publish.mjs ...",
  );
  process.exit(2);
}

// 1. Build. `bun run build` runs tsc --noEmit first, so a type error stops the
//    publish rather than shipping a bundle that fails at runtime on a phone.
console.log("building web bundle…");
sh("bun", ["run", "build"], { stdio: "inherit" });
if (!existsSync(join(root, "dist", "index.html"))) {
  console.error("dist/index.html missing — the bundle root must be index.html");
  process.exit(1);
}

// 2. Zip with index.html AT THE ROOT. A zip that contains `dist/index.html`
//    installs "successfully" and then shows a blank screen, because the plugin
//    serves the archive root.
const staging = join(OUT, ".staging");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const zipTmp = join(staging, "bundle.zip");
console.log("packaging…");
sh("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path '${join(root, "dist")}\\*' -DestinationPath '${zipTmp}' -Force`,
]);

const zipBytes = readFileSync(zipTmp);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const checksumB64 = createHash("sha256").update(zipBytes).digest("base64");

// 3. Immutable destination, keyed by content. Same bytes → same path.
const relDir = join(OUT, "releases", version);
mkdirSync(relDir, { recursive: true });
const artifactName = `${sha256.slice(0, 16)}.zip`;
const artifactPath = join(relDir, artifactName);
if (existsSync(artifactPath)) {
  console.log(`artifact already exists (identical content): ${version}/${artifactName}`);
} else {
  writeFileSync(artifactPath, zipBytes);
}

// 4. Sign the ARTIFACT DIGEST, not the manifest.
const signer = createSign("RSA-SHA256");
signer.update(zipBytes);
const signature = signer.sign(privateKey, "base64");

const bundleId = `${version}-${sha256.slice(0, 8)}`;
const baseUrl = arg("base-url", "https://updates.factorylm.com");
const manifest = {
  bundleId,
  version,
  channel,
  downloadUrl: `${baseUrl}/releases/${version}/${artifactName}`,
  checksum: checksumB64,
  signature,
  // The compatibility gate: the shell refuses a bundle whose fingerprint is not
  // its own, so a bundle needing a plugin the installed APK lacks can never be
  // applied — it is rejected before download.
  nativeFingerprint: nativeFingerprint(),
  releaseSha: (() => {
    try {
      return sh("git", ["rev-parse", "HEAD"]).trim();
    } catch {
      return "unknown";
    }
  })(),
  releasedAt: new Date().toISOString(),
  artifactSha256: sha256,
};

writeFileSync(join(OUT, `manifest.${channel}.json`), JSON.stringify(manifest, null, 2) + "\n");
rmSync(staging, { recursive: true, force: true });

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
