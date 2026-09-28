import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageDeterministicZip } from "../ota-package.mjs";

const temporaryDirectories = [];

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "factorylm-ota-package-"));
  temporaryDirectories.push(path);
  return path;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeFixture(dist, order, mode) {
  mkdirSync(join(dist, "assets", "nested"), { recursive: true });
  const contents = {
    "index.html": "<!doctype html><main>FactoryLM</main>\n",
    "assets/app.js": "console.log('FactoryLM');\n",
    "assets/nested/theme.css": ":root { color-scheme: light dark; }\n",
  };
  for (const relative of order) {
    const path = join(dist, relative);
    writeFileSync(path, contents[relative]);
    chmodSync(path, mode);
  }
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("deterministic OTA packaging", () => {
  it("produces identical ordered archives despite creation order and source modes", () => {
    const root = temporaryDirectory();
    const dist = join(root, "dist");
    const first = join(root, "first.zip");
    const second = join(root, "second.zip");

    writeFixture(dist, ["assets/nested/theme.css", "index.html", "assets/app.js"], 0o600);
    packageDeterministicZip({ dist, out: first });

    rmSync(dist, { recursive: true });
    writeFixture(dist, ["assets/app.js", "index.html", "assets/nested/theme.css"], 0o755);
    packageDeterministicZip({ dist, out: second });

    expect(sha256(second)).toBe(sha256(first));
    expect(
      execFileSync("unzip", ["-Z1", second], { encoding: "utf8" })
        .trim()
        .split("\n"),
    ).toEqual(["assets/app.js", "assets/nested/theme.css", "index.html"]);
  });

  it("refuses symbolic links rather than archiving host-dependent targets", () => {
    const root = temporaryDirectory();
    const dist = join(root, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html>\n");
    symlinkSync("index.html", join(dist, "alias.html"));

    expect(() =>
      packageDeterministicZip({ dist, out: join(root, "bundle.zip") }),
    ).toThrow(/symbolic link/i);
  });
});
