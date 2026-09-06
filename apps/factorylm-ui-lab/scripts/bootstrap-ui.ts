import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

// 1. Install the UI package's own pinned toolchain (frozen lockfile).
const labRoot = resolve(import.meta.dir, "..");
// Directory links: a symlink needs Developer Mode or elevation on Windows; a
// junction does not. Both resolve to the real path, which is all we need.
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
const uiPackageRoot = resolve(labRoot, "../../packages/factorylm-ui");
const install = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: uiPackageRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (await install.exited !== 0) process.exit(install.exitCode);

// 2. Real sources, not install-time mirrors. Bun materialises a `file:`
//    dependency by COPYING the package into node_modules, and a frozen
//    re-install does not refresh that copy — a local run can silently test a
//    stale snapshot of the shared packages (seen 2026-09-06: the lab's mirror
//    still held the Task 4 shell). Replace each mirror with a symlink to the
//    package directory so every entry — tests, build, dev server — reads the
//    working tree. CI's fresh install never had the problem; this makes local
//    runs equally honest.
const packagesRoot = resolve(labRoot, "../../packages");
const relink = (nodeModules: string, name: string) => {
  const mirror = resolve(nodeModules, "@factorylm", name);
  const target = resolve(packagesRoot, `factorylm-${name}`);
  if (!existsSync(target)) return;
  if (lstatSync(mirror, { throwIfNoEntry: false })) rmSync(mirror, { recursive: true, force: true });
  symlinkSync(target, mirror, LINK_TYPE);
};
for (const name of ["theme", "interaction", "ui"]) relink(resolve(labRoot, "node_modules"), name);
for (const name of ["theme", "interaction"]) relink(resolve(uiPackageRoot, "node_modules"), name);

// 3. One React. `@factorylm/ui` declares React as a peer but carries a
//    package-local copy so its tests run from the package directory. Bun
//    resolves `react` from a package file's PHYSICAL path, so the lab (which
//    has its own React) would otherwise load two instances and every hook
//    would throw "Invalid hook call". Point the package-local copies at the
//    lab's install; Bun resolves symlinks to their real path, so both sides
//    share one module instance. Versions must match — fail loudly otherwise.
for (const name of ["react", "react-dom", "scheduler"]) {
  const labCopy = resolve(labRoot, "node_modules", name);
  const packageCopy = resolve(uiPackageRoot, "node_modules", name);
  if (!existsSync(labCopy)) {
    console.error(`bootstrap:ui — ${name} is not installed in the lab; run \`bun install\` in apps/factorylm-ui-lab first.`);
    process.exit(1);
  }
  const version = (path: string) => (JSON.parse(readFileSync(resolve(path, "package.json"), "utf8")) as { version: string }).version;
  if (existsSync(packageCopy) && !lstatSync(packageCopy).isSymbolicLink() && version(packageCopy) !== version(labCopy)) {
    console.error(`bootstrap:ui — ${name} ${version(packageCopy)} in packages/factorylm-ui differs from ${version(labCopy)} in the lab; align the pins.`);
    process.exit(1);
  }
  if (existsSync(packageCopy) || lstatSync(packageCopy, { throwIfNoEntry: false })) rmSync(packageCopy, { recursive: true, force: true });
  symlinkSync(labCopy, packageCopy, LINK_TYPE);
}
