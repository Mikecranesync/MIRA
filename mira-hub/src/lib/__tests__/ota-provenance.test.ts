import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  manifestPointerPayload,
  provenancePayload,
  verifyPublishedManifestProvenance,
} from "../../capabilities/ota-provenance";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function sign(payload: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(payload, "utf8");
  return signer.sign(privateKey, "base64");
}

function signedManifest() {
  const value: Record<string, unknown> = {
    bundleId: "1.2.3-deadbeef",
    version: "1.2.3",
    artifact: "deadbeefdeadbeef.zip",
    checksum: "d".repeat(64),
    signature: "artifact-signature",
    nativeFingerprint: "0123456789abcdef",
    releaseSha: "a".repeat(40),
    releasedAt: "2026-09-07T00:00:00.000Z",
    artifactSha256: "d".repeat(64),
  };
  value.provenanceSignature = sign(provenancePayload(value));
  value.channel = "canary";
  value.downloadUrl =
    "https://updates.factorylm.com/releases/1.2.3/deadbeefdeadbeef.zip";
  value.pointerChangedAt = "2026-09-07T01:02:03.004Z";
  value.manifestSignature = sign(manifestPointerPayload(value));
  return value;
}

describe("OTA manifest provenance", () => {
  it("accepts an artifact and channel pointer authenticated by the release key", () => {
    expect(verifyPublishedManifestProvenance(signedManifest(), publicKey)).toBe(true);
  });

  it.each(["unknown", "abc123", "A".repeat(40)])(
    "rejects a noncanonical release source SHA: %s",
    (releaseSha) => {
      expect(() => provenancePayload({ ...signedManifest(), releaseSha })).toThrow(
        /releaseSha/,
      );
    },
  );

  it.each([
    ["nativeFingerprint", "ffffffffffffffff"],
    ["checksum", "e".repeat(64)],
    ["channel", "production"],
    ["downloadUrl", "https://updates.factorylm.com/releases/replayed.zip"],
    ["pointerChangedAt", "2026-09-07T01:02:03.005Z"],
  ])("refuses a rewritten %s", (field, value) => {
    expect(
      verifyPublishedManifestProvenance({ ...signedManifest(), [field]: value }, publicKey),
    ).toBe(false);
  });

  it.each([
    "2026-09-07T01:02:03Z",
    "2026-09-07T01:02:03.004+00:00",
    "2026-02-30T01:02:03.004Z",
  ])("rejects a noncanonical pointer timestamp: %s", (pointerChangedAt) => {
    expect(() =>
      manifestPointerPayload({ ...signedManifest(), pointerChangedAt }),
    ).toThrow(/pointerChangedAt/);
  });

  it("rejects a pointer that predates its authenticated release", () => {
    expect(() =>
      manifestPointerPayload({
        ...signedManifest(),
        releasedAt: "2026-09-07T02:00:00.000Z",
        pointerChangedAt: "2026-09-07T01:59:59.999Z",
      }),
    ).toThrow(/predates/i);
  });
});
