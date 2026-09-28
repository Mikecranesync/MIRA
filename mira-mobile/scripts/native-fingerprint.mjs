/**
 * Native compatibility fingerprint for OTA web bundles.
 *
 * Covers resolved native dependency records and the actual production
 * Android/iOS/Capacitor inputs. Package spec strings alone miss permission,
 * native source, build configuration, and compiled public-key changes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(mobileRoot, "..");
const FINGERPRINT_IMPLEMENTATION_PATH = "mira-mobile/scripts/native-fingerprint.mjs";

const NONRUNTIME_NATIVE_EXACT_PATHS = new Set([
  "mira-mobile/android/.gitignore",
  "mira-mobile/android/app/.gitignore",
  "mira-mobile/ios/App/CapApp-SPM/.gitignore",
  "mira-mobile/ios/App/CapApp-SPM/README.md",
  "mira-mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist",
  "mira-mobile/ios/.gitignore",
]);

/** Test-only and repository metadata do not enter the installed native ABI. */
export function isNativeCompatibilityPath(path) {
  // The implementation is part of the compatibility protocol. Including its
  // historical bytes prevents today's algorithm from recomputing both sides
  // of a release range as equal after the protocol itself changed.
  if (path === FINGERPRINT_IMPLEMENTATION_PATH) return true;
  if (path === "mira-mobile/capacitor.config.ts") return true;
  if (!path.startsWith("mira-mobile/android/") && !path.startsWith("mira-mobile/ios/")) {
    return false;
  }
  if (NONRUNTIME_NATIVE_EXACT_PATHS.has(path)) return false;
  if (/^mira-mobile\/android\/[^/]+\/src\/(?:test|androidTest|testFixtures)(?:[A-Z][^/]*)?\//.test(path)) {
    return false;
  }
  const parts = path.split("/");
  if (
    path.startsWith("mira-mobile/ios/") &&
    parts.slice(3, -1).some((part) => part === "Tests" || part.endsWith("Tests"))
  ) {
    return false;
  }
  return true;
}

export function nativeFingerprintFromSnapshot({ pkgJson, lockText, files }) {
  if (pkgJson === null || typeof pkgJson !== "object") {
    throw new TypeError("native fingerprint requires package.json");
  }
  if (typeof lockText !== "string") throw new TypeError("native fingerprint requires bun.lock");
  // A package name is not a reliable native-plugin classifier. Bind the whole
  // package manifest and resolved lock so a future vendor cannot evade the
  // compatibility identity merely by choosing a new namespace.
  const payload = [
    "factorylm-native-compatibility-v3",
    `package=${createHash("sha256").update(JSON.stringify(pkgJson)).digest("hex")}`,
    `lock=${createHash("sha256").update(lockText).digest("hex")}`,
  ];

  const entries = [...files.entries()]
    .filter(([path]) => isNativeCompatibilityPath(path))
    // Locale collation differs across runners. Git paths are protocol bytes,
    // so order them by JavaScript code units for a host-independent digest.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) throw new TypeError("native fingerprint requires native files");
  for (const [path, bytes] of entries) {
    const digest = createHash("sha256").update(bytes).digest("hex");
    payload.push(`file=${path}:${digest}`);
  }
  return createHash("sha256").update(`${payload.join("\n")}\n`).digest("hex").slice(0, 16);
}

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: repoRoot, encoding });
}

/** Parse Git's `-z` output without treating newline or other control bytes as paths. */
export function parseNulSeparatedPaths(output) {
  if (!Buffer.isBuffer(output)) {
    throw new TypeError("NUL-separated Git output must be a Buffer");
  }
  if (output.length === 0) return [];
  if (output[output.length - 1] !== 0) {
    throw new TypeError("unterminated NUL-separated Git output");
  }

  const paths = [];
  let start = 0;
  for (let end = output.indexOf(0, start); end !== -1; end = output.indexOf(0, start)) {
    if (end > start) paths.push(output.subarray(start, end).toString("utf8"));
    start = end + 1;
  }
  return paths;
}

export function packagedBuildMinimumFromEpoch(epoch) {
  if (typeof epoch !== "string" || !/^(?:0|[1-9]\d*)$/.test(epoch.trim())) {
    throw new TypeError("packaged build epoch must be whole UTC seconds");
  }
  const millis = Number(epoch.trim()) * 1_000;
  if (!Number.isSafeInteger(millis)) {
    throw new TypeError("packaged build epoch is outside the safe date range");
  }
  try {
    return new Date(millis).toISOString();
  } catch {
    throw new TypeError("packaged build epoch is outside the supported date range");
  }
}

/** Bind the server-issued timestamp to this exact workflow run attempt and head. */
export function workflowAttemptBuildEpoch(
  run,
  { runId, runAttempt, headSha } = {},
) {
  if (
    !/^[1-9]\d*$/.test(runId ?? "") ||
    !/^[1-9]\d*$/.test(runAttempt ?? "") ||
    !/^[0-9a-f]{40}$/.test(headSha ?? "")
  ) {
    throw new TypeError("invalid expected workflow attempt identity");
  }
  const expectedId = Number(runId);
  const expectedAttempt = Number(runAttempt);
  if (
    !Number.isSafeInteger(expectedId) ||
    !Number.isSafeInteger(expectedAttempt) ||
    run === null ||
    typeof run !== "object" ||
    run.id !== expectedId ||
    run.run_attempt !== expectedAttempt ||
    run.head_sha !== headSha
  ) {
    throw new Error("workflow attempt identity does not match this release job");
  }
  if (
    typeof run.run_started_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(run.run_started_at)
  ) {
    throw new TypeError("workflow attempt start time is not canonical UTC seconds");
  }
  const millis = Date.parse(run.run_started_at);
  if (
    !Number.isSafeInteger(millis) ||
    millis % 1_000 !== 0 ||
    new Date(millis).toISOString() !== run.run_started_at.replace(/Z$/, ".000Z")
  ) {
    throw new TypeError("workflow attempt start time is invalid");
  }
  return String(millis / 1_000);
}

/**
 * Resolve the replay floor baked into the web bundle. Governed GitHub release
 * workflows must supply their server-issued, stable workflow creation epoch;
 * a Git commit timestamp is author-controlled and is not a security boundary.
 * Unsigned local/dev builds receive a noncanonical sentinel, so runtime OTA is
 * disabled instead of pretending those builds establish a production floor.
 */
export function packagedBuildMinimumFromEnvironment({
  workflowEpoch = process.env.FLM_PACKAGED_BUILD_MINIMUM_EPOCH,
  governedReleaseBuild = process.env.FLM_GOVERNED_RELEASE_BUILD,
} = {}) {
  if (governedReleaseBuild === undefined || governedReleaseBuild === "") {
    if (workflowEpoch !== undefined && workflowEpoch !== "") {
      throw new Error("packaged build epoch requires an explicit governed release build");
    }
    return "unset";
  }
  if (governedReleaseBuild !== "1") {
    throw new Error("FLM_GOVERNED_RELEASE_BUILD must be 1 when set");
  }
  if (workflowEpoch === undefined || workflowEpoch === "") {
    throw new Error("governed builds require a server-issued packaged build epoch");
  }
  return packagedBuildMinimumFromEpoch(workflowEpoch);
}

export function packagedBuildMinimum() {
  return packagedBuildMinimumFromEnvironment();
}

function nativePathsAt(ref) {
  return parseNulSeparatedPaths(git([
    "ls-tree", "-r", "--name-only", "-z", ref, "--",
    "mira-mobile/android", "mira-mobile/ios", "mira-mobile/capacitor.config.ts",
    FINGERPRINT_IMPLEMENTATION_PATH,
  ], null)).filter(isNativeCompatibilityPath);
}

function currentNativePaths() {
  return parseNulSeparatedPaths(git([
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "mira-mobile/android", "mira-mobile/ios", "mira-mobile/capacitor.config.ts",
    FINGERPRINT_IMPLEMENTATION_PATH,
  ], null)).filter(isNativeCompatibilityPath);
}

export function nativeFingerprintAtRef(ref) {
  const pkgJson = JSON.parse(git(["show", `${ref}:mira-mobile/package.json`]));
  const lockText = git(["show", `${ref}:mira-mobile/bun.lock`]);
  const files = new Map(
    nativePathsAt(ref).map((path) => [path, git(["show", `${ref}:${path}`], null)]),
  );
  return nativeFingerprintFromSnapshot({ pkgJson, lockText, files });
}

export function nativeFingerprint(pkgJson = null) {
  const resolvedPkg =
    pkgJson ?? JSON.parse(readFileSync(join(mobileRoot, "package.json"), "utf8"));
  const lockText = readFileSync(join(mobileRoot, "bun.lock"), "utf8");
  const files = new Map(
    currentNativePaths().map((path) => [path, readFileSync(join(repoRoot, path))]),
  );
  return nativeFingerprintFromSnapshot({ pkgJson: resolvedPkg, lockText, files });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${nativeFingerprint()}\n`);
}
