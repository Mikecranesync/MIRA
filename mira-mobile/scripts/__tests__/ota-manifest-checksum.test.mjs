// Regression: the OTA manifest's `checksum` must be the HEX SHA-256 of the
// zip. @capawesome/capacitor-live-update parses `checksum` as hex and
// `signature` as base64 (README, downloadBundle options). A base64 checksum
// is refused by the phone as an integrity failure — every bundle published
// before 2026-09-06 (1.1.1, 1.1.2) hit exactly that.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../ota-publish.mjs", import.meta.url), "utf8");
const readme = readFileSync(new URL("../../node_modules/@capawesome/capacitor-live-update/README.md", import.meta.url), "utf8");

describe("ota-publish manifest checksum encoding", () => {
  it("publishes the hex digest as `checksum` and never a base64 checksum", () => {
    expect(source).toMatch(/const sha256 = createHash\("sha256"\)\.update\(zipBytes\)\.digest\("hex"\)/);
    expect(source).toMatch(/checksum:\s*sha256,/);
    expect(source).not.toMatch(/checksumB64/);
    expect(source).not.toMatch(/digest\("base64"\)/);
  });

  it("matches the plugin contract this shell is built against", () => {
    expect(readme).toMatch(/\*\*`checksum`\*\*[^\n]*SHA-256 hash in hex format/);
    expect(readme).toMatch(/\*\*`signature`\*\*[^\n]*signed SHA-256 hash in base64 format/);
    expect(source).toMatch(/signer\.sign\(privateKey, "base64"\)/);
  });
});
