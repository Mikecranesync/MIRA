import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

type PackageManifest = {
  name?: string;
  private?: boolean;
  license?: string;
  version?: string;
};

type AppManifest = {
  dependencies?: Record<string, string>;
};

const appRoot = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(appRoot, "../..");
const firstPartyPackagesRoot = resolve(workspaceRoot, "packages");
const allowedLicenses = new Set(["MIT", "Apache-2.0"]);
const auditedPaths = new Set<string>();
// `name@version` of every external package already covered by the installed
// tree, so the lockfile-closure pass below only re-checks what this platform
// skipped rather than re-fetching the whole dependency graph.
const auditedExternalPackages = new Set<string>();
const violations: string[] = [];
let auditedExternalPackageCount = 0;
const appManifest = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8")) as AppManifest;
const linkedFirstPartyPackageNames = new Set(
  Object.entries(appManifest.dependencies ?? {})
    .filter(([, version]) => version.startsWith("workspace:") || version.startsWith("file:"))
    .map(([name]) => name),
);

function isFirstPartyPackage(realPackagePath: string, manifest: PackageManifest): boolean {
  const packageRelativePath = relative(firstPartyPackagesRoot, realPackagePath);
  // A workspace member resolves to its SOURCE directory (packages/x, apps/x) — a
  // path under the workspace root with no node_modules segment. Everything
  // installed from the registry resolves under node_modules.
  const workspaceRelativePath = relative(workspaceRoot, realPackagePath);
  const isWorkspaceSource =
    workspaceRelativePath !== "" &&
    !workspaceRelativePath.startsWith("..") &&
    !workspaceRelativePath.split("/").includes("node_modules");
  return (
    manifest.private === true &&
    ((packageRelativePath !== "" && !packageRelativePath.startsWith("..")) ||
      isWorkspaceSource ||
      (manifest.name !== undefined && linkedFirstPartyPackageNames.has(manifest.name)))
  );
}

async function auditPackage(packagePath: string): Promise<void> {
  const realPackagePath = dirname(await realpath(join(packagePath, "package.json")));
  if (auditedPaths.has(realPackagePath)) return;
  auditedPaths.add(realPackagePath);

  const manifest = JSON.parse(await readFile(join(realPackagePath, "package.json"), "utf8")) as PackageManifest;
  if (!isFirstPartyPackage(realPackagePath, manifest)) {
    auditedExternalPackageCount += 1;
    if (manifest.name && manifest.version) auditedExternalPackages.add(`${manifest.name}@${manifest.version}`);
    if (!manifest.license || !allowedLicenses.has(manifest.license)) {
      violations.push(`${manifest.name ?? realPackagePath}@${manifest.version ?? "unknown"}: ${manifest.license ?? "missing license"}`);
    }
  }

  const nestedNodeModules = join(realPackagePath, "node_modules");
  if (existsSync(nestedNodeModules)) await auditNodeModules(nestedNodeModules);
}

async function auditNodeModules(nodeModulesPath: string): Promise<void> {
  for (const entry of await readdir(nodeModulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;

    const entryPath = join(nodeModulesPath, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) await auditPackage(join(entryPath, scopedEntry.name));
      }
    } else {
      await auditPackage(entryPath);
    }
  }
}

// ── Installed-tree audit ────────────────────────────────────────────────────
// Bun's isolated linker (pinned in the root bunfig.toml) installs every package
// exactly once under <workspaceRoot>/node_modules/.bun/<name>@<version>/node_modules/,
// with a member's own node_modules holding only symlinks into that store. So the
// store IS the installed set: walk it and every third-party manifest is audited
// once, no link-following needed. The classic roots are walked too — realpaths
// dedupe, and it keeps the audit correct if the linker is ever switched to hoisted.
const isolatedStore = join(workspaceRoot, "node_modules", ".bun");
const skippedStoreEntries: string[] = [];
if (existsSync(isolatedStore)) {
  for (const entry of await readdir(isolatedStore, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const storeNodeModules = join(isolatedStore, entry.name, "node_modules");
    if (existsSync(storeNodeModules)) await auditNodeModules(storeNodeModules);
    else skippedStoreEntries.push(entry.name);
  }
}
// A store entry the walk cannot read is a package the audit did not cover. Left
// silent, the total below shrinks and still exits 0 — the partial-walk twin of
// the empty-walk guard, raised by the #3705 review.
if (skippedStoreEntries.length > 0) {
  console.error(
    `Dependency license audit failed: ${skippedStoreEntries.length} store entr${skippedStoreEntries.length === 1 ? "y" : "ies"} had no node_modules/ and could not be audited: ${skippedStoreEntries.join(", ")}`,
  );
  process.exit(1);
}
for (const classicRoot of [join(workspaceRoot, "node_modules"), join(appRoot, "node_modules")]) {
  if (existsSync(classicRoot)) await auditNodeModules(classicRoot);
}
// An empty walk is not a clean bill — it is the shape of a wrong root or an
// uninstalled tree, and it would otherwise print "0 manifests are MIT" and exit 0.
if (auditedExternalPackageCount === 0) {
  console.error(
    "Dependency license audit failed: the installed-tree walk audited zero external packages. " +
      "Run `bun install` at the workspace root first; if it is installed, the walk roots are wrong.",
  );
  process.exit(1);
}

// ── Closure audit ───────────────────────────────────────────────────────────
// Walking node_modules only sees what THIS platform installed. Optional and
// platform-gated dependencies are skipped by the installer, so a darwin-only
// or win32-only package with a disallowed licence would sail past a Linux CI
// runner untouched. `fsevents@2.3.2` (os: darwin, an optional dependency of
// playwright) is the live example: 26 manifests on macOS, 25 on ubuntu.
//
// So: read every package in the lockfile closure and audit any that the
// installed-tree walk did not already cover, resolving its licence from the
// registry. This fails CLOSED — an unresolvable package is a violation, not a
// pass, because "we could not check it" must never read as "it is fine".
// Lockfiles are DISCOVERED, not listed. A hardcoded list silently stops
// auditing the moment a task adds a package with its own bun.lock — the same
// class of blind spot as only auditing the installed tree. Globbing `apps/` as
// well as `packages/` costs nothing and covers a future sibling app too.
const lockfilePaths: string[] = [];
// The workspace shares ONE lockfile at its root. The globs stay so that a
// sibling that opts out of the workspace and carries its own bun.lock is still
// audited rather than silently skipped.
const workspaceLockfile = join(workspaceRoot, "bun.lock");
if (existsSync(workspaceLockfile)) lockfilePaths.push(workspaceLockfile);
for (const pattern of ["apps/factorylm-*/bun.lock", "packages/factorylm-*/bun.lock"]) {
  for await (const match of new Bun.Glob(pattern).scan({ cwd: workspaceRoot, absolute: true })) {
    lockfilePaths.push(match);
  }
}
lockfilePaths.sort(); // deterministic order, so the audit output is stable
if (lockfilePaths.length === 0) {
  console.error("Dependency license audit failed: no bun.lock discovered at the workspace root or under apps/factorylm-*/ / packages/factorylm-*/.");
  process.exit(1);
}
const registryLicenseCache = new Map<string, string | undefined>();
let auditedClosureOnlyPackageCount = 0;

function parseLockfile(raw: string): { packages?: Record<string, unknown[]> } {
  // bun.lock is JSONC: trailing commas are legal and JSON.parse rejects them.
  try {
    return JSON.parse(raw) as { packages?: Record<string, unknown[]> };
  } catch {
    return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as { packages?: Record<string, unknown[]> };
  }
}

function normalizeLicense(license: unknown): string | undefined {
  if (typeof license === "string") return license;
  if (license && typeof license === "object" && "type" in license) {
    const type = (license as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return undefined;
}

async function licenseFromRegistry(name: string, version: string): Promise<string | undefined> {
  const key = `${name}@${version}`;
  if (registryLicenseCache.has(key)) return registryLicenseCache.get(key);

  // Scoped names must keep their slash percent-encoded for the registry.
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`;
  let license: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        license = normalizeLicense((await response.json()).license);
        break;
      }
      if (response.status === 404) break; // definitive: no such version
    } catch {
      // network flake — retried below
    }
    if (attempt < 3) await new Promise((wake) => setTimeout(wake, 400 * attempt));
  }
  registryLicenseCache.set(key, license);
  return license;
}

for (const lockfilePath of lockfilePaths) {
  if (!existsSync(lockfilePath)) continue;
  const lockfile = parseLockfile(await readFile(lockfilePath, "utf8"));

  for (const entry of Object.values(lockfile.packages ?? {})) {
    const specifier = entry[0];
    if (typeof specifier !== "string") continue;
    // `name@workspace:packages/x` (and legacy `name@file:../x`) entries are the
    // first-party workspace members, not registry packages.
    if (specifier.includes("@workspace:") || specifier.includes("@file:")) continue;

    const separator = specifier.lastIndexOf("@");
    if (separator <= 0) continue;
    const name = specifier.slice(0, separator);
    const version = specifier.slice(separator + 1);
    if (auditedExternalPackages.has(`${name}@${version}`)) continue;

    auditedExternalPackages.add(`${name}@${version}`);
    auditedClosureOnlyPackageCount += 1;
    const license = await licenseFromRegistry(name, version);
    if (!license) {
      violations.push(`${name}@${version}: not installed on this platform and its licence could not be resolved from the registry`);
    } else if (!allowedLicenses.has(license)) {
      violations.push(`${name}@${version}: ${license} (not installed on this platform; resolved from the registry)`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Dependency license audit failed after auditing ${auditedExternalPackageCount} installed + ${auditedClosureOnlyPackageCount} closure-only external package manifests:`,
  );
  for (const violation of violations.sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Dependency license audit passed: ${auditedExternalPackageCount} external package manifests are MIT or Apache-2.0` +
    ` (plus ${auditedClosureOnlyPackageCount} platform-skipped package(s) resolved from the registry` +
    `, across ${lockfilePaths.length} discovered lockfile(s)).`,
);
