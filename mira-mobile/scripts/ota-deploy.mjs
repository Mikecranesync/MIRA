/**
 * OTA deploy — copy staged artifacts + the signed manifest to the VPS.
 *
 * ORDERING IS THE SAFETY PROPERTY. Artifacts are uploaded FIRST and the manifest
 * LAST. The manifest is the only thing that makes a bundle live, so a deploy
 * that dies halfway leaves the previous manifest pointing at the previous
 * artifact — still valid, still verified, still serving. There is no window
 * where the manifest names a bundle that has not finished uploading.
 *
 * Artifacts are never overwritten: content-addressed names mean an existing file
 * is byte-identical by construction, so `--ignore-existing` is correctness, not
 * an optimisation.
 *
 * Usage:
 *   node scripts/ota-deploy.mjs --channel canary            # dry run
 *   node scripts/ota-deploy.mjs --channel canary --confirm  # actually upload
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const manifestPath = join(OUT, `manifest.${channel}.json`);
if (!existsSync(manifestPath)) {
  console.error(`no staged manifest for channel "${channel}" — run ota-publish.mjs first`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Refuse to deploy a manifest that does not describe THIS shell's native
// surface. Publishing a bundle no installed app can accept is not dangerous,
// but it is silently useless — every phone would refuse it and the operator
// would be left wondering why the update "did not arrive".
import { nativeFingerprint } from "./native-fingerprint.mjs";
const fp = nativeFingerprint();
if (manifest.nativeFingerprint !== fp) {
  console.error(
    `manifest fingerprint ${manifest.nativeFingerprint} != current ${fp}\n` +
      "Re-publish: the native surface changed since this manifest was built.",
  );
  process.exit(1);
}

const plan = [
  `rsync -av --ignore-existing ota-out/releases/ ${host}:${remoteRoot}/releases/`,
  `scp ota-out/manifest.${channel}.json ${host}:${remoteRoot}/manifest.${channel}.json`,
];

console.log(`
channel     ${channel}
bundleId    ${manifest.bundleId}
artifact    ${manifest.downloadUrl}
fingerprint ${manifest.nativeFingerprint}

plan (artifacts first, manifest last):
  1. ${plan[0]}
  2. ${plan[1]}
`);

if (!confirm) {
  console.log("dry run — re-run with --confirm to upload.");
  process.exit(0);
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

// 1. Artifacts. Immutable, so never overwrite.
run("rsync", [
  "-av",
  "--ignore-existing",
  "ota-out/releases/",
  `${host}:${remoteRoot}/releases/`,
]);

// 2. Manifest LAST — this is the atomic flip that makes the bundle live.
run("scp", [
  join("ota-out", `manifest.${channel}.json`),
  `${host}:${remoteRoot}/manifest.${channel}.json`,
]);

console.log(`\nlive: https://updates.factorylm.com/manifest.${channel}.json`);
