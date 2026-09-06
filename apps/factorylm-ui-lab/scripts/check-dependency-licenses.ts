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
const firstPartyPackagesRoot = resolve(appRoot, "../../packages");
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
    .filter(([, version]) => version.startsWith("file:"))
    .map(([name]) => name),
);

function isFirstPartyPackage(realPackagePath: string, manifest: PackageManifest): boolean {
  const packageRelativePath = relative(firstPartyPackagesRoot, realPackagePath);
  return (
    manifest.private === true &&
    ((packageRelativePath !== "" && !packageRelativePath.startsWith("..")) ||
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

await auditNodeModules(join(appRoot, "node_modules"));

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
const lockfilePaths = [join(appRoot, "bun.lock"), join(firstPartyPackagesRoot, "factorylm-ui/bun.lock")];
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
    // `name@file:../..` entries are the first-party workspace links.
    if (specifier.includes("@file:")) continue;

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
    ` (plus ${auditedClosureOnlyPackageCount} platform-skipped package(s) resolved from the registry).`,
);
