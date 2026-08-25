/**
 * The native compatibility fingerprint.
 *
 * WHY NOT A VERSION STRING
 * A web bundle may only run on a shell that actually has the native plugins it
 * calls. Version labels and filenames do not carry that fact: a bundle can be
 * rebuilt with the same `versionName` after a plugin was added, and the label
 * still matches while the native surface underneath does not. The shell would
 * accept it, and the first call into the missing plugin would fail at runtime —
 * after the good bundle had already been replaced.
 *
 * So the fingerprint is derived from the thing that actually matters: the exact
 * set of native packages and their exact versions, plus the Capacitor major.
 * Add, remove, or bump any native plugin and the fingerprint changes, and every
 * previously published bundle stops being offered to shells that predate it.
 *
 * Pure web dependencies (react, vite) are deliberately EXCLUDED — they ship
 * inside the bundle, so they cannot desynchronise from the shell and including
 * them would invalidate every bundle on an unrelated dependency bump.
 *
 * Deterministic: same inputs → same hash, on any machine, in CI or locally.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A dependency whose code lives in the APK, not in the web bundle. */
function isNative(name) {
  return (
    name.startsWith("@capacitor/") ||
    name.startsWith("@capawesome/") ||
    name.startsWith("cordova-") ||
    name.startsWith("@capacitor-community/")
  );
}

export function nativeFingerprint(pkgJson) {
  const pkg = pkgJson ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  // Sorted so key order in package.json can never change the hash.
  const native = Object.keys(deps)
    .filter(isNative)
    .sort()
    .map((n) => `${n}@${deps[n]}`);

  // The Capacitor major is called out separately: it governs the bridge contract
  // itself, so a major bump must invalidate bundles even if no plugin changed.
  const core = deps["@capacitor/core"] ?? "0";
  const major = String(core).replace(/[^0-9.]/g, "").split(".")[0] || "0";

  const payload = `capacitor-major=${major}\n${native.join("\n")}\n`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// Run-as-CLI check. Compared via pathToFileURL rather than string-building a
// `file://` prefix: on Windows `import.meta.url` is `file:///C:/...` (three
// slashes) while argv[1] is `C:\...`, so the naive comparison silently never
// matches and the script prints nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(nativeFingerprint() + "\n");
}
