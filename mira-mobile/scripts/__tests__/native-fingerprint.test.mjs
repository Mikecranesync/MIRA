import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as nativeFingerprintModule from "../native-fingerprint.mjs";
import * as otaGuardModule from "../ota-guard.mjs";
import {
  isNativeCompatibilityPath,
  nativeFingerprintFromSnapshot,
} from "../native-fingerprint.mjs";

const viteConfigSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
const fingerprintSource = readFileSync(new URL("../native-fingerprint.mjs", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../ota-guard.mjs", import.meta.url), "utf8");
const otaWorkflowSource = readFileSync(
  new URL("../../../.github/workflows/ota-release.yml", import.meta.url),
  "utf8",
);
const nativeWorkflowSource = readFileSync(
  new URL("../../../.github/workflows/mobile-release-distribute.yml", import.meta.url),
  "utf8",
);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const pkg = {
  dependencies: {
    "@capacitor/core": "^8.0.0",
    "@capacitor/app": "^8.0.0",
    react: "^18.3.1",
    "vendor-native-bridge": "1.0.0",
  },
};

const lockText = `
    "@capacitor/app": ["@capacitor/app@8.1.1", "", {}, "sha512-old"],
    "@capacitor/core": ["@capacitor/core@8.5.0", "", {}, "sha512-core"],
    "react": ["react@18.3.1", "", {}, "sha512-react"],
    "vendor-native-bridge": ["vendor-native-bridge@1.0.0", "", {}, "sha512-vendor"],
`;

const files = new Map([
  ["mira-mobile/capacitor.config.ts", Buffer.from("publicKey: old")],
  ["mira-mobile/android/app/src/main/AndroidManifest.xml", Buffer.from("<manifest />")],
  ["mira-mobile/ios/App/App/AppDelegate.swift", Buffer.from("class AppDelegate {}")],
]);

const fingerprint = (over = {}) =>
  nativeFingerprintFromSnapshot({ pkgJson: pkg, lockText, files, ...over });

describe("native compatibility fingerprint", () => {
  it("fails closed when a historical ref used a different fingerprint implementation", () => {
    const temporaryGitDirectory = mkdtempSync(join(tmpdir(), "factorylm-native-fingerprint-"));
    const gitEnvironment = {
      ...process.env,
      GIT_INDEX_FILE: join(temporaryGitDirectory, "index"),
      GIT_AUTHOR_NAME: "FactoryLM test",
      GIT_AUTHOR_EMAIL: "test@factorylm.invalid",
      GIT_COMMITTER_NAME: "FactoryLM test",
      GIT_COMMITTER_EMAIL: "test@factorylm.invalid",
    };
    const git = (args, options = {}) =>
      execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        env: gitEnvironment,
        ...options,
      }).trim();

    try {
      git(["read-tree", "HEAD"]);
      const historicalSource = git([
        "show",
        "HEAD:mira-mobile/scripts/native-fingerprint.mjs",
      ]);
      const changedBlob = git(["hash-object", "-w", "--stdin"], {
        input: `${historicalSource}\n// changed fingerprint protocol implementation\n`,
      });
      git([
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${changedBlob},mira-mobile/scripts/native-fingerprint.mjs`,
      ]);
      const changedTree = git(["write-tree"]);
      const changedRef = git(["commit-tree", changedTree, "-p", "HEAD"], {
        input: "test: change fingerprint implementation\n",
      });

      expect(nativeFingerprintModule.nativeFingerprintAtRef(changedRef)).not.toBe(
        nativeFingerprintModule.nativeFingerprintAtRef("HEAD"),
      );
      expect(
        otaGuardModule.nativeTouchedPaths(
          Buffer.from("mira-mobile/scripts/native-fingerprint.mjs\0"),
        ),
      ).toEqual(["mira-mobile/scripts/native-fingerprint.mjs"]);
    } finally {
      rmSync(temporaryGitDirectory, { recursive: true, force: true });
    }
  }, 15_000);

  it("changes for Android manifest/native source changes", () => {
    const changed = new Map(files);
    changed.set(
      "mira-mobile/android/app/src/main/AndroidManifest.xml",
      Buffer.from('<manifest permission="camera" />'),
    );
    expect(fingerprint({ files: changed })).not.toBe(fingerprint());
  });

  it("changes for iOS native source and Capacitor public-key/config changes", () => {
    const ios = new Map(files);
    ios.set("mira-mobile/ios/App/App/AppDelegate.swift", Buffer.from("class AppDelegateV2 {}"));
    expect(fingerprint({ files: ios })).not.toBe(fingerprint());

    const config = new Map(files);
    config.set("mira-mobile/capacitor.config.ts", Buffer.from("publicKey: rotated"));
    expect(fingerprint({ files: config })).not.toBe(fingerprint());
  });

  it("binds the complete dependency and lock inputs without guessing plugin names", () => {
    expect(fingerprint({ lockText: lockText.replace("8.1.1", "8.1.2") })).not.toBe(
      fingerprint(),
    );
    expect(fingerprint({ lockText: lockText.replace("react@18.3.1", "react@18.3.2") })).not.toBe(
      fingerprint(),
    );
    expect(
      fingerprint({
        pkgJson: {
          ...pkg,
          dependencies: { ...pkg.dependencies, "vendor-native-bridge": "1.0.1" },
        },
      }),
    ).not.toBe(fingerprint());
  });

  it("orders native paths by code units instead of the runner locale", () => {
    const unicodeFiles = new Map([
      ["mira-mobile/android/app/src/main/assets/z.txt", Buffer.from("z")],
      ["mira-mobile/android/app/src/main/assets/ä.txt", Buffer.from("umlaut")],
    ]);
    const sortedEntries = [...unicodeFiles.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const payload = [
      "factorylm-native-compatibility-v3",
      `package=${createHash("sha256").update(JSON.stringify(pkg)).digest("hex")}`,
      `lock=${createHash("sha256").update(lockText).digest("hex")}`,
      ...sortedEntries.map(
        ([path, bytes]) =>
          `file=${path}:${createHash("sha256").update(bytes).digest("hex")}`,
      ),
    ];
    const expected = createHash("sha256")
      .update(`${payload.join("\n")}\n`)
      .digest("hex")
      .slice(0, 16);

    expect(
      nativeFingerprintFromSnapshot({ pkgJson: pkg, lockText, files: unicodeFiles }),
    ).toBe(expected);
  });

  it("excludes native tests and repository metadata from the APK compatibility surface", () => {
    expect(
      isNativeCompatibilityPath(
        "mira-mobile/android/app/src/androidTest/java/example/Test.java",
      ),
    ).toBe(false);
    expect(
      isNativeCompatibilityPath("mira-mobile/ios/App/CapApp-SPM/README.md"),
    ).toBe(false);
    expect(
      isNativeCompatibilityPath("mira-mobile/android/app/src/main/AndroidManifest.xml"),
    ).toBe(true);
    expect(
      isNativeCompatibilityPath("mira-mobile/android/app/src/main/assets/help/README.md"),
    ).toBe(true);
    expect(
      isNativeCompatibilityPath("mira-mobile/ios/App/App/README.md"),
    ).toBe(true);
  });

  it("parses NUL-delimited Git output without letting newline/control paths evade native checks", () => {
    const parse = nativeFingerprintModule.parseNulSeparatedPaths;
    const nativeTouchedPaths = otaGuardModule.nativeTouchedPaths;
    expect(typeof parse).toBe("function");
    expect(typeof nativeTouchedPaths).toBe("function");
    if (typeof parse !== "function" || typeof nativeTouchedPaths !== "function") return;

    const tricky = "mira-mobile/android/app/src/main/assets/line\ncontrol-\u0001.json";
    const ordinary = "mira-mobile/src/App.tsx";
    const output = Buffer.concat([
      Buffer.from(tricky),
      Buffer.from([0]),
      Buffer.from(ordinary),
      Buffer.from([0]),
    ]);

    expect(parse(output)).toEqual([tricky, ordinary]);
    expect(nativeTouchedPaths(output)).toEqual([tricky]);

    const trickyFiles = new Map(files);
    trickyFiles.set(tricky, Buffer.from("native asset v1"));
    const changedTrickyFiles = new Map(trickyFiles);
    changedTrickyFiles.set(tricky, Buffer.from("native asset v2"));
    expect(fingerprint({ files: trickyFiles })).not.toBe(
      fingerprint({ files: changedTrickyFiles }),
    );

    expect(fingerprintSource).toMatch(/"ls-tree",\s*"-r",\s*"--name-only",\s*"-z"/);
    expect(fingerprintSource).toMatch(/"ls-files",\s*"-z"/);
    expect(guardSource).toMatch(/"diff",\s*"--name-only",\s*"-z"/);
  });

  it("uses a server-issued workflow epoch as the packaged pointer replay floor", () => {
    const fromEpoch = nativeFingerprintModule.packagedBuildMinimumFromEpoch;
    const fromEnvironment = nativeFingerprintModule.packagedBuildMinimumFromEnvironment;
    const fromAttempt = nativeFingerprintModule.workflowAttemptBuildEpoch;
    expect(typeof fromEpoch).toBe("function");
    expect(typeof fromEnvironment).toBe("function");
    expect(typeof fromAttempt).toBe("function");
    if (
      typeof fromEpoch !== "function" ||
      typeof fromEnvironment !== "function" ||
      typeof fromAttempt !== "function"
    ) return;

    const attempt = {
      id: 34131104475,
      run_attempt: 2,
      head_sha: "a".repeat(40),
      run_started_at: "2026-09-07T14:07:54Z",
    };
    const expected = {
      runId: "34131104475",
      runAttempt: "2",
      headSha: "a".repeat(40),
    };
    expect(fromAttempt(attempt, expected)).toBe("1788790074");
    for (const changed of [
      { ...attempt, id: attempt.id + 1 },
      { ...attempt, run_attempt: 1 },
      { ...attempt, head_sha: "b".repeat(40) },
    ]) {
      expect(() => fromAttempt(changed, expected)).toThrow(/workflow attempt identity/i);
    }
    expect(() =>
      fromAttempt({ ...attempt, run_started_at: "not-a-time" }, expected),
    ).toThrow(/start time/i);

    expect(fromEpoch("1788664663")).toBe("2026-09-06T03:17:43.000Z");
    expect(() => fromEpoch("not-an-epoch")).toThrow();
    expect(
      fromEnvironment({
        workflowEpoch: "1788664663",
        governedReleaseBuild: "1",
      }),
    ).toBe("2026-09-06T03:17:43.000Z");
    expect(() =>
      fromEnvironment({ workflowEpoch: undefined, governedReleaseBuild: "1" }),
    ).toThrow(/server-issued packaged build epoch/i);
    expect(
      fromEnvironment({ workflowEpoch: undefined, governedReleaseBuild: undefined }),
    ).toBe("unset");
    expect(() =>
      fromEnvironment({ workflowEpoch: "1788664663", governedReleaseBuild: undefined }),
    ).toThrow(/governed release build/i);

    for (const workflow of [otaWorkflowSource, nativeWorkflowSource]) {
      expect(workflow).toContain("actions: read");
      expect(workflow).toContain(
        "actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT",
      );
      expect(workflow).toContain("workflowAttemptBuildEpoch");
      expect(workflow).toContain("FLM_PACKAGED_BUILD_MINIMUM_EPOCH");
      expect(workflow).toContain("FLM_GOVERNED_RELEASE_BUILD");
      expect(workflow).not.toContain("--format=%ct");
    }
    expect(nativeWorkflowSource).toContain("native-release-provenance.json");
    expect(nativeWorkflowSource).toContain("needs.build-unsigned-native.outputs.build_epoch");
    expect(nativeWorkflowSource).toMatch(
      /app-release-apk-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
    expect(fingerprintSource).toContain("run_started_at");
    expect(viteConfigSource).toContain("__FLM_PACKAGED_BUILD_MINIMUM__");
  });
});
