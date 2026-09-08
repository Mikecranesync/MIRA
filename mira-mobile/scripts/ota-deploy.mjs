/**
 * OTA deploy — copy staged artifacts + the signed manifest to the VPS.
 *
 * ORDERING IS THE SAFETY PROPERTY. Artifacts are uploaded FIRST and the manifest
 * LAST. The manifest is the only thing that makes a bundle live, so a deploy
 * that dies halfway leaves the previous manifest pointing at the previous
 * artifact — still valid, still verified, still serving. There is no window
 * where the manifest names a bundle that has not finished uploading.
 *
 * Artifacts are never overwritten: the deploy verifies an existing remote
 * content-addressed file against the authenticated full SHA-256 before reuse.
 *
 * Usage:
 *   node scripts/ota-deploy.mjs --channel canary            # dry run
 *   node scripts/ota-deploy.mjs --channel canary --confirm  # actually upload
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFingerprint } from "./native-fingerprint.mjs";
import {
  validatePointerTransition,
  validateStagedRelease,
} from "./ota-provenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "ota-out");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const channel = arg("channel", "canary");
const host = arg("host", "factorylm-prod");
const remoteRoot = arg("remote-root", "/srv/factorylm/ota");
const confirm = process.argv.includes("--confirm");

if (!new Set(["canary", "production"]).has(channel)) {
  console.error(`--channel must be canary|production (got ${channel})`);
  process.exit(2);
}

const manifestPath = join(OUT, `manifest.${channel}.json`);
if (!existsSync(manifestPath)) {
  console.error(`no staged manifest for channel "${channel}" — run ota-publish.mjs first`);
  process.exit(1);
}
const manifestBytes = readFileSync(manifestPath);
let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch {
  console.error("staged manifest is not valid JSON");
  process.exit(1);
}
if (
  manifest.channel !== channel ||
  !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? "") ||
  !/^[0-9a-f]{16}\.zip$/.test(manifest.artifact ?? "")
) {
  console.error("staged manifest has a non-canonical channel, version, or artifact");
  process.exit(1);
}
const releaseTarget = `${manifest.version}/${manifest.artifact}`;
if (
  manifest.downloadUrl !==
  `https://updates.factorylm.com/releases/${releaseTarget}`
) {
  console.error("staged manifest download URL does not name its canonical release path");
  process.exit(1);
}
const artifactPath = join(OUT, "releases", manifest.version, manifest.artifact);
const metadataPath = artifactPath.replace(/\.zip$/, ".json");
for (const path of [artifactPath, metadataPath]) {
  if (!existsSync(path)) {
    console.error(`staged release file is missing: ${path}`);
    process.exit(1);
  }
}

const artifactBytes = readFileSync(artifactPath);
const metadataBytes = readFileSync(metadataPath);
let metadata;
try {
  metadata = JSON.parse(metadataBytes.toString("utf8"));
} catch {
  console.error("staged immutable provenance is not valid JSON");
  process.exit(1);
}

// Verify the complete local release before a confirmed run can send one byte.
const fp = nativeFingerprint();
const stagedRelease = validateStagedRelease({
  artifactBytes,
  metadata,
  manifest,
  channel,
  currentNativeFingerprint: fp,
});
if (!stagedRelease.ok) {
  console.error(`staged release failed authenticated preflight: ${stagedRelease.reason}`);
  process.exit(1);
}
const artifactSha256 = stagedRelease.artifactSha256;
const metadataSha256 = createHash("sha256").update(metadataBytes).digest("hex");
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

const manifestTemp = `${remoteRoot}/.manifest.${channel}.${process.pid}.tmp`;
const plan = [
  `verify or atomically install releases/${releaseTarget}`,
  `verify or atomically install releases/${releaseTarget.replace(/\.zip$/, ".json")}`,
  `compare the signed live pointer under lock, then atomically install manifest.${channel}.json`,
];

console.log(`
channel     ${channel}
bundleId    ${manifest.bundleId}
artifact    ${manifest.downloadUrl}
fingerprint ${manifest.nativeFingerprint}

plan (artifacts first, manifest last):
  1. ${plan[0]}
  2. ${plan[1]}
  3. ${plan[2]}
`);

if (!confirm) {
  console.log("dry run — re-run with --confirm to upload.");
  process.exit(0);
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function remoteScript(args, script, encoding = undefined) {
  return execFileSync("ssh", [host, "sh", "-s", "--", ...args], {
    input: script,
    encoding,
    stdio: encoding ? ["pipe", "pipe", "inherit"] : ["pipe", "inherit", "inherit"],
  });
}

function installImmutable(localPath, remotePath, expected) {
  if (sha256(localPath) !== expected) {
    throw new Error(`local staged file changed after authenticated preflight: ${localPath}`);
  }
  const state = remoteScript(
    [remotePath, expected],
    `set -eu
final=$1
expected=$2
if [ ! -e "$final" ]; then printf missing; exit 0; fi
actual=$(sha256sum "$final" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "immutable remote file has the wrong digest: $final" >&2; exit 1; }
printf verified
`,
    "utf8",
  ).trim();
  if (state === "verified") return;
  if (state !== "missing") throw new Error(`unexpected remote verification state: ${state}`);

  const remoteTemp = `${remotePath}.${process.pid}.tmp`;
  run("scp", [localPath, `${host}:${remoteTemp}`]);
  remoteScript(
    [remoteTemp, remotePath, expected],
    `set -eu
temp=$1
final=$2
expected=$3
trap 'rm -f "$temp"' EXIT
actual=$(sha256sum "$temp" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "uploaded immutable file failed digest verification" >&2; exit 1; }
chmod 0644 "$temp"
if ! ln "$temp" "$final" 2>/dev/null; then
  actual=$(sha256sum "$final" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || { echo "immutable destination exists with a different digest" >&2; exit 1; }
fi
`,
  );
}

function readRemotePointer(remotePath) {
  const response = remoteScript(
    [remotePath],
    `set -eu
final=$1
if [ ! -e "$final" ]; then printf 'missing\\n'; exit 0; fi
[ -f "$final" ] || { echo "live manifest is not a regular file" >&2; exit 1; }
printf 'present\\n'
cat "$final"
`,
    "utf8",
  );
  if (response === "missing\n") return { manifest: null, bytes: null };
  const prefix = "present\n";
  if (!response.startsWith(prefix)) {
    throw new Error("unexpected live manifest response");
  }
  const bytes = Buffer.from(response.slice(prefix.length), "utf8");
  try {
    return { manifest: JSON.parse(bytes.toString("utf8")), bytes };
  } catch {
    throw new Error("live manifest is not valid JSON");
  }
}

const livePointer = readRemotePointer(`${remoteRoot}/manifest.${channel}.json`);
const pointerTransition = validatePointerTransition({
  liveManifest: livePointer.manifest,
  liveBytes: livePointer.bytes,
  candidateManifest: manifest,
  candidateBytes: manifestBytes,
  channel,
});
if (!pointerTransition.ok) {
  console.error(`live pointer refused staged transition: ${pointerTransition.reason}`);
  process.exit(1);
}
const expectedLiveSha256 = pointerTransition.expectedLiveSha256 ?? "missing";

// Immutable bytes first. Existing paths are independently hashed, never assumed.
remoteScript([`${remoteRoot}/releases/${manifest.version}`], 'set -eu\nmkdir -p "$1"\n');
installImmutable(
  artifactPath,
  `${remoteRoot}/releases/${releaseTarget}`,
  artifactSha256,
);
installImmutable(
  metadataPath,
  `${remoteRoot}/releases/${releaseTarget.replace(/\.zip$/, ".json")}`,
  metadataSha256,
);

// Manifest LAST. Upload beside its destination, verify, then same-filesystem
// rename. `mv` is the atomic pointer flip; a failed upload leaves the old file.
if (sha256(manifestPath) !== manifestSha256) {
  throw new Error(`local staged file changed after authenticated preflight: ${manifestPath}`);
}
run("scp", [manifestPath, `${host}:${manifestTemp}`]);
remoteScript(
  [
    manifestTemp,
    `${remoteRoot}/manifest.${channel}.json`,
    manifestSha256,
    `${remoteRoot}/.ota-pointer.lock`,
    expectedLiveSha256,
  ],
  `set -eu
temp=$1
final=$2
expected=$3
lock=$4
expected_live=$5
trap 'rm -f "$temp"' EXIT
actual=$(sha256sum "$temp" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "uploaded manifest failed digest verification" >&2; exit 1; }
chmod 0644 "$temp"
exec 9>"$lock"
flock 9
if [ "$expected_live" = missing ]; then
  [ ! -e "$final" ] || { echo "live manifest appeared after preflight" >&2; exit 1; }
else
  [ -f "$final" ] || { echo "live manifest disappeared after preflight" >&2; exit 1; }
  actual=$(sha256sum "$final" | cut -d' ' -f1)
  [ "$actual" = "$expected_live" ] || { echo "live manifest changed after preflight" >&2; exit 1; }
fi
mv -f "$temp" "$final"
actual=$(sha256sum "$final" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "live manifest failed post-rename verification" >&2; exit 1; }
`,
);

console.log(`\nlive: https://updates.factorylm.com/manifest.${channel}.json`);
