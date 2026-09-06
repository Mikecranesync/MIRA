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

if (violations.length > 0) {
  console.error(`Dependency license audit failed after auditing ${auditedExternalPackageCount} external package manifests:`);
  for (const violation of violations.sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Dependency license audit passed: ${auditedExternalPackageCount} external package manifests are MIT or Apache-2.0.`);
