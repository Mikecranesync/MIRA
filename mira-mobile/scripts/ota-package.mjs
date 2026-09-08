/** Package an already-built Vite dist tree into a byte-stable OTA ZIP. */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_MTIME = new Date("2000-01-01T00:00:00Z");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * The governed release path runs on Ubuntu with Info-ZIP. Sort entries, reject
 * links, normalize modes/times, and store without compressor-version variance.
 * Windows packaging fails closed instead of claiming cross-tool byte identity.
 */
export function packageDeterministicZip({ dist, out, platform = process.platform }) {
  if (platform === "win32") {
    throw new Error("deterministic OTA packaging requires the governed Linux release runner");
  }
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error("dist/index.html missing; run the secret-free web build first");
  }

  const entries = readdirSync(dist, { recursive: true })
    .map((relative) => relative.replaceAll("\\", "/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const files = [];
  for (const relative of entries) {
    if (relative.includes("\n") || relative.includes("\r")) {
      throw new Error(`OTA archive path contains a line break: ${JSON.stringify(relative)}`);
    }
    const path = join(dist, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`OTA archive refuses symbolic link: ${relative}`);
    }
    if (stat.isDirectory()) {
      chmodSync(path, 0o755);
    } else if (stat.isFile()) {
      chmodSync(path, 0o644);
      files.push(relative);
    } else {
      throw new Error(`OTA archive refuses non-file entry: ${relative}`);
    }
    utimesSync(path, FIXED_MTIME, FIXED_MTIME);
  }

  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  execFileSync("zip", ["-0", "-X", "-q", out, "-@"], {
    cwd: dist,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    input: `${files.join("\n")}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

function main() {
  const requested = arg("out", "ota-unsigned/bundle.zip");
  const out = isAbsolute(requested) ? requested : resolve(root, requested);
  packageDeterministicZip({ dist: join(root, "dist"), out });
  console.log(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
