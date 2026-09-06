import { resolve } from "node:path";

const uiPackageRoot = resolve(import.meta.dir, "../../../packages/factorylm-ui");
const install = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: uiPackageRoot,
  stdout: "inherit",
  stderr: "inherit",
});

if (await install.exited !== 0) process.exit(install.exitCode);
