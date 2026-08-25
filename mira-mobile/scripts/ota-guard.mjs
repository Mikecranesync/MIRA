/**
 * OTA release guard — refuses to publish a web bundle when the diff changed
 * anything that only an APK can deliver.
 *
 * THE MISTAKE THIS EXISTS TO PREVENT
 * OTA carries web assets. If a change also touched a native plugin, Gradle, the
 * manifest, permissions, SDK levels, or signing, then publishing "just the JS"
 * ships half the change: the bundle calls native code the installed shell does
 * not have. The technician's app breaks in a way that looks like our bug and is
 * not recoverable by pushing another bundle.
 *
 * Two independent checks, because either alone is fool-able:
 *
 *  1. PATH CHECK — did the diff touch native-owned files? Cheap, catches the
 *     obvious case, but blind to a dependency bump that reaches native code
 *     through a lockfile.
 *  2. FINGERPRINT CHECK — recompute the native compatibility fingerprint at
 *     both ends of the range and compare. This is the authoritative one: it is
 *     derived from the actual native dependency set, so it catches changes the
 *     path list never anticipated, and it does not care what a file is named.
 *
 * Usage:  node scripts/ota-guard.mjs <baseRef> [headRef]
 * Exit 0 = safe to publish OTA. Exit 1 = must go through Firebase/Play.
 */
import { execFileSync } from "node:child_process";
import { nativeFingerprint } from "./native-fingerprint.mjs";

/** Files whose changes can only ship inside an APK. */
const NATIVE_PATHS = [
  "mira-mobile/android/",
  "mira-mobile/ios/",
  "mira-mobile/capacitor.config.ts",
  "mira-mobile/package.json", // native plugin add/remove/bump lives here
  "mira-mobile/bun.lock",
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** package.json as it existed at a ref, or null when unreadable. */
function pkgAt(ref) {
  try {
    return JSON.parse(git(["show", `${ref}:mira-mobile/package.json`]));
  } catch {
    return null;
  }
}

export function evaluate(baseRef, headRef = "HEAD") {
  const changed = git(["diff", "--name-only", `${baseRef}...${headRef}`])
    .split("\n")
    .filter(Boolean);

  const nativeTouched = changed.filter((f) => NATIVE_PATHS.some((p) => f.startsWith(p)));

  const basePkg = pkgAt(baseRef);
  const headPkg = pkgAt(headRef);
  const baseFp = basePkg ? nativeFingerprint(basePkg) : null;
  const headFp = headPkg ? nativeFingerprint(headPkg) : null;
  // Unreadable ends are treated as a mismatch: unprovable is not the same as
  // safe, and this guard fails closed.
  const fingerprintChanged = baseFp === null || headFp === null || baseFp !== headFp;

  return { changed, nativeTouched, baseFp, headFp, fingerprintChanged };
}

if (process.argv[1] && process.argv[1].endsWith("ota-guard.mjs")) {
  const [baseRef, headRef = "HEAD"] = process.argv.slice(2);
  if (!baseRef) {
    console.error("usage: node scripts/ota-guard.mjs <baseRef> [headRef]");
    process.exit(2);
  }
  const r = evaluate(baseRef, headRef);
  console.log(`native fingerprint: ${r.baseFp} -> ${r.headFp}`);

  if (r.fingerprintChanged) {
    console.error("\nBLOCKED: the native compatibility fingerprint changed.");
    console.error("A web bundle cannot carry this change — ship an APK via Firebase/Play.");
    process.exit(1);
  }
  if (r.nativeTouched.length > 0) {
    console.error("\nBLOCKED: the diff touches native-owned files:");
    for (const f of r.nativeTouched) console.error(`  - ${f}`);
    console.error("Ship an APK via Firebase/Play instead of an OTA bundle.");
    process.exit(1);
  }
  console.log(`OK: ${r.changed.length} changed file(s), none native. Safe to publish OTA.`);
}
