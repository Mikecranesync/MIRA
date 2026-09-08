// Regression: the OTA manifest's `checksum` must be the HEX SHA-256 of the
// zip. @capawesome/capacitor-live-update parses `checksum` as hex and
// `signature` as base64 (README, downloadBundle options). A base64 checksum
// is refused by the phone as an integrity failure — every bundle published
// before 2026-09-06 (1.1.1, 1.1.2) hit exactly that.
import { readFileSync } from "node:fs";
import { createHash, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as otaProvenanceModule from "../ota-provenance.mjs";
import {
  provenancePayload,
  manifestPointerPayload,
  signManifestPointer,
  signProvenance,
  releasedAtFromBuildEpoch,
  validatePromotionSource,
  verifyArtifactSignature,
  verifyManifestPointer,
  verifyProvenance,
  OTA_PUBLIC_KEY,
} from "../ota-provenance.mjs";

const source = readFileSync(new URL("../ota-publish.mjs", import.meta.url), "utf8");
const rollbackSource = readFileSync(new URL("../ota-rollback.mjs", import.meta.url), "utf8");
const deploySource = readFileSync(new URL("../ota-deploy.mjs", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../ota-guard.mjs", import.meta.url), "utf8");
const readme = readFileSync(new URL("../../node_modules/@capawesome/capacitor-live-update/README.md", import.meta.url), "utf8");

function signedReleaseFixture({
  privateKey,
  bytes = Buffer.from("signed deploy fixture bytes"),
  version = "1.2.3",
  channel = "canary",
  pointerChangedAt = "2026-09-07T01:02:03.004Z",
} = {}) {
  const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact = `${artifactSha256.slice(0, 16)}.zip`;
  const metadata = {
    bundleId: `${version}-${artifactSha256.slice(0, 8)}`,
    version,
    artifact,
    checksum: artifactSha256,
    signature: (() => {
      const signer = createSign("RSA-SHA256");
      signer.update(bytes);
      return signer.sign(privateKey, "base64");
    })(),
    nativeFingerprint: "0123456789abcdef",
    releaseSha: "a".repeat(40),
    releasedAt: "2026-09-07T00:00:00.000Z",
    artifactSha256,
  };
  metadata.provenanceSignature = signProvenance(metadata, privateKey);
  const manifest = {
    ...metadata,
    channel,
    downloadUrl: `https://updates.factorylm.com/releases/${version}/${artifact}`,
    pointerChangedAt,
  };
  manifest.manifestSignature = signManifestPointer(manifest, privateKey);
  return {
    bytes,
    metadata,
    manifest,
    metadataBytes: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  };
}

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

  it("refuses corrupted bytes already occupying an immutable artifact path", () => {
    const assertArtifactDigest = otaProvenanceModule.assertArtifactDigest;
    expect(typeof assertArtifactDigest).toBe("function");
    if (typeof assertArtifactDigest !== "function") return;

    const requestedBundle = Buffer.from("the requested signed bundle");
    const expectedSha256 = createHash("sha256").update(requestedBundle).digest("hex");

    expect(() =>
      assertArtifactDigest(Buffer.from("different bytes at the same truncated path"), expectedSha256),
    ).toThrow(/immutable artifact.*digest/i);
    expect(() => assertArtifactDigest(requestedBundle, expectedSha256)).not.toThrow();
  });

  it("creates the artifact exclusively and authenticates the staged path before signing", () => {
    expect(source).toContain('writeFileSync(artifactPath, zipBytes, { flag: "wx" })');
    const stagedDigestCheck = source.indexOf(
      "assertArtifactDigest(readFileSync(artifactPath), sha256)",
    );
    const signerCreation = source.indexOf('createSign("RSA-SHA256")');
    expect(stagedDigestCheck).toBeGreaterThan(-1);
    expect(signerCreation).toBeGreaterThan(stagedDigestCheck);
  });
});

describe("OTA rollback provenance", () => {
  it("publishes immutable per-artifact metadata for later rollback", () => {
    expect(source).toMatch(/artifactMetadataPath/);
    expect(source).toMatch(/artifactMetadata/);
    expect(source).toMatch(/nativeFingerprint/);
    expect(source).toMatch(/provenanceSignature/);
    expect(source).toMatch(/signProvenance/);
    expect(source).toMatch(
      /writeFileSync\(\s*artifactMetadataPath,[\s\S]*?\{\s*flag:\s*"wx"\s*\},?\s*\)/,
    );
  });

  it("reuses verified artifact metadata, hex checksum, signature, and fingerprint", () => {
    expect(rollbackSource).not.toMatch(/checksumB64/);
    expect(rollbackSource).not.toMatch(/createSign/);
    expect(rollbackSource).toMatch(/artifactMetadataPath/);
    expect(rollbackSource).toMatch(/metadata\.nativeFingerprint\s*!==\s*nativeFingerprint\(\)/);
    expect(rollbackSource).toMatch(/checksum:\s*sha256,/);
    expect(rollbackSource).toMatch(/artifact:\s*metadata\.artifact,/);
    expect(rollbackSource).toMatch(/signature:\s*metadata\.signature,/);
    expect(rollbackSource).toMatch(/nativeFingerprint:\s*metadata\.nativeFingerprint,/);
    expect(rollbackSource).toMatch(/verifyProvenance/);
    expect(rollbackSource).toMatch(/verifyArtifactSignature/);
    expect(rollbackSource).toMatch(/\["canary",\s*"production"\]\.includes\(channel\)/);
  });

  it("makes production promotion prove the exact current canary pointer", () => {
    expect(source).toContain('channel !== "canary"');
    expect(source).toContain("--require-source-channel canary");
    expect(rollbackSource).toContain('arg("require-source-channel")');
    expect(rollbackSource).toContain("validatePromotionSource");
    expect(rollbackSource).not.toContain("--allow-deliberate-rollback");
  });

  it("installs immutable release files safely and flips the pointer atomically", () => {
    expect(deploySource).toContain("sha256sum");
    expect(deploySource).toContain("manifestTemp");
    expect(deploySource).toContain("mv");
    expect(deploySource).toContain("validatePointerTransition");
    expect(deploySource).toContain(".ota-pointer.lock");
    expect(deploySource).toContain("flock 9");
    expect(deploySource).toContain("expectedLiveSha256");
    expect(deploySource).not.toMatch(/scp[^\n]*manifest\.\$\{channel\}\.json[^\n]*manifest\.\$\{channel\}\.json/);
  });

  it("runs authenticated local preflight before the confirm/upload gate", () => {
    const preflight = deploySource.indexOf("validateStagedRelease({");
    const confirmGate = deploySource.indexOf("if (!confirm)");
    const firstUpload = deploySource.indexOf('run("scp"');
    expect(preflight).toBeGreaterThan(-1);
    expect(confirmGate).toBeGreaterThan(preflight);
    expect(firstUpload).toBeGreaterThan(confirmGate);
  });
});

describe("OTA authenticated compatibility envelope", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const metadata = {
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

  it("ships a public key Node can parse for release and Hub verification", () => {
    expect(() => createPublicKey(OTA_PUBLIC_KEY)).not.toThrow();
  });

  it("binds the artifact digest and native fingerprint to one deterministic payload", () => {
    const payload = provenancePayload(metadata);
    expect(payload).toContain(`checksum=${metadata.checksum}`);
    expect(payload).toContain(`nativeFingerprint=${metadata.nativeFingerprint}`);
    expect(payload).toContain(`artifact=${metadata.artifact}`);
  });

  it.each(["unknown", "91d437e5e", "A".repeat(40)])(
    "rejects a noncanonical release source SHA: %s",
    (releaseSha) => {
      expect(() => provenancePayload({ ...metadata, releaseSha })).toThrow(/releaseSha/);
    },
  );

  it("rejects a fingerprint rewrite even when the artifact signature is unchanged", () => {
    const provenanceSignature = signProvenance(metadata, privateKey);
    expect(verifyProvenance(metadata, provenanceSignature, publicKey)).toBe(true);
    expect(
      verifyProvenance(
        { ...metadata, nativeFingerprint: "ffffffffffffffff" },
        provenanceSignature,
        publicKey,
      ),
    ).toBe(false);
  });

  it("verifies the artifact signature independently of the provenance envelope", () => {
    const bytes = Buffer.from("signed bundle bytes");
    const signer = createSign("RSA-SHA256");
    signer.update(bytes);
    const artifactSignature = signer.sign(privateKey, "base64");
    expect(verifyArtifactSignature(bytes, artifactSignature, publicKey)).toBe(true);
    expect(verifyArtifactSignature(Buffer.from("tampered"), artifactSignature, publicKey)).toBe(false);
  });

  it("authenticates channel promotion and the exact download pointer separately", () => {
    const provenanceSignature = signProvenance(metadata, privateKey);
    const manifest = {
      ...metadata,
      provenanceSignature,
      channel: "canary",
      downloadUrl: `https://updates.factorylm.com/releases/${metadata.version}/${metadata.artifact}`,
      pointerChangedAt: "2026-09-07T01:02:03.004Z",
    };
    expect(manifestPointerPayload(manifest)).toBe(
      [
        "factorylm-ota-manifest-pointer-v1",
        `bundleId=${metadata.bundleId}`,
        `version=${metadata.version}`,
        `artifact=${metadata.artifact}`,
        `checksum=${metadata.checksum}`,
        `signature=${metadata.signature}`,
        `nativeFingerprint=${metadata.nativeFingerprint}`,
        `releaseSha=${metadata.releaseSha}`,
        `releasedAt=${metadata.releasedAt}`,
        `artifactSha256=${metadata.artifactSha256}`,
        `provenanceSignature=${provenanceSignature}`,
        "channel=canary",
        `downloadUrl=https://updates.factorylm.com/releases/${metadata.version}/${metadata.artifact}`,
        "pointerChangedAt=2026-09-07T01:02:03.004Z",
        "",
      ].join("\n"),
    );
    const manifestSignature = signManifestPointer(manifest, privateKey);
    expect(verifyManifestPointer(manifest, manifestSignature, publicKey)).toBe(true);
    expect(
      verifyManifestPointer({ ...manifest, channel: "production" }, manifestSignature, publicKey),
    ).toBe(false);
    expect(
      verifyManifestPointer(
        { ...manifest, downloadUrl: `${manifest.downloadUrl}.replayed` },
        manifestSignature,
        publicKey,
      ),
    ).toBe(false);
    expect(
      verifyManifestPointer(
        { ...manifest, pointerChangedAt: "2026-09-07T01:02:03.005Z" },
        manifestSignature,
        publicKey,
      ),
    ).toBe(false);
  });

  it.each([
    "2026-09-07T01:02:03Z",
    "2026-09-07T01:02:03.004+00:00",
    "2026-02-30T01:02:03.004Z",
  ])("refuses to sign a noncanonical pointer timestamp: %s", (pointerChangedAt) => {
    const provenanceSignature = signProvenance(metadata, privateKey);
    expect(() =>
      signManifestPointer(
        {
          ...metadata,
          provenanceSignature,
          channel: "canary",
          downloadUrl: `https://updates.factorylm.com/releases/${metadata.version}/${metadata.artifact}`,
          pointerChangedAt,
        },
        privateKey,
      ),
    ).toThrow(/pointerChangedAt/);
  });

  it("refuses to sign a channel pointer that predates its governed build", () => {
    const provenanceSignature = signProvenance(metadata, privateKey);
    expect(() =>
      signManifestPointer(
        {
          ...metadata,
          releasedAt: "2026-09-07T02:00:00.000Z",
          provenanceSignature,
          channel: "canary",
          downloadUrl: `https://updates.factorylm.com/releases/${metadata.version}/${metadata.artifact}`,
          pointerChangedAt: "2026-09-07T01:59:59.999Z",
        },
        privateKey,
      ),
    ).toThrow(/predates/i);
  });

  it("stamps a fresh pointer time on both publish and rollback before signing", () => {
    expect(source).toMatch(/pointerChangedAt:\s*new Date\(\)\.toISOString\(\)/);
    expect(rollbackSource).toMatch(/pointerChangedAt:\s*new Date\(\)\.toISOString\(\)/);
  });

  it("derives immutable release time from the governed build attempt", () => {
    expect(releasedAtFromBuildEpoch("1788742803")).toBe("2026-09-07T01:00:03.000Z");
    expect(source).toContain("BUILD_EPOCH");
    expect(source).toContain("releasedAtFromBuildEpoch");
  });

  it.each(["", "-1", "1.5", "not-an-epoch", "999999999999999999999"])(
    "rejects an invalid governed build epoch: %s",
    (epoch) => expect(() => releasedAtFromBuildEpoch(epoch)).toThrow(/epoch/),
  );

  it("accepts only an authenticated source pointer naming the exact promoted artifact", () => {
    const provenanceSignature = signProvenance(metadata, privateKey);
    const source = {
      ...metadata,
      provenanceSignature,
      channel: "canary",
      downloadUrl: `https://updates.factorylm.com/releases/${metadata.version}/${metadata.artifact}`,
      pointerChangedAt: "2026-09-07T01:02:03.004Z",
    };
    source.manifestSignature = signManifestPointer(source, privateKey);

    expect(
      validatePromotionSource(source, {
        sourceChannel: "canary",
        target: `${metadata.version}/${metadata.artifact}`,
        publicKey,
      }),
    ).toEqual({ ok: true });
    expect(
      validatePromotionSource(source, {
        sourceChannel: "canary",
        target: `${metadata.version}/other.zip`,
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "source_target_mismatch" });
    expect(
      validatePromotionSource(
        { ...source, version: "9.9.9" },
        { sourceChannel: "canary", target: `${metadata.version}/${metadata.artifact}`, publicKey },
      ),
    ).toEqual({ ok: false, reason: "invalid_source_signature" });
    expect(
      validatePromotionSource(
        { ...source, releaseSha: "unknown" },
        { sourceChannel: "canary", target: `${metadata.version}/${metadata.artifact}`, publicKey },
      ),
    ).toEqual({ ok: false, reason: "invalid_source_release_sha" });
  });
});

describe("OTA base ancestry", () => {
  it("fails closed unless the installed APK commit is an ancestor of the bundle", () => {
    expect(guardSource).toContain("merge-base");
    expect(guardSource).toContain("--is-ancestor");
    expect(guardSource).toContain("baseIsAncestor");
  });
});

describe("OTA deploy local authenticated preflight", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("accepts only an exact artifact, provenance sidecar, signed pointer, channel, and shell", () => {
    const validateStagedRelease = otaProvenanceModule.validateStagedRelease;
    expect(typeof validateStagedRelease).toBe("function");
    if (typeof validateStagedRelease !== "function") return;

    const fixture = signedReleaseFixture({ privateKey });
    expect(
      validateStagedRelease({
        artifactBytes: fixture.bytes,
        metadata: fixture.metadata,
        manifest: fixture.manifest,
        channel: "canary",
        currentNativeFingerprint: "0123456789abcdef",
        publicKey,
      }),
    ).toEqual({ ok: true, artifactSha256: fixture.metadata.artifactSha256 });

    expect(
      validateStagedRelease({
        artifactBytes: Buffer.from("corrupted after signing"),
        metadata: fixture.metadata,
        manifest: fixture.manifest,
        channel: "canary",
        currentNativeFingerprint: "0123456789abcdef",
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "artifact_digest_mismatch" });

    expect(
      validateStagedRelease({
        artifactBytes: fixture.bytes,
        metadata: { ...fixture.metadata, bundleId: "other" },
        manifest: fixture.manifest,
        channel: "canary",
        currentNativeFingerprint: "0123456789abcdef",
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "metadata_mismatch" });
  });

  it.each([
    ["wrong channel", (f) => ({ ...f, manifest: { ...f.manifest, channel: "production" } }), "channel_mismatch"],
    ["noncanonical release SHA", (f) => ({
      ...f,
      metadata: { ...f.metadata, releaseSha: "unknown" },
      manifest: { ...f.manifest, releaseSha: "unknown" },
    }), "invalid_release_sha"],
    ["noncanonical pointer time", (f) => ({
      ...f,
      manifest: { ...f.manifest, pointerChangedAt: "2026-09-07T01:02:03Z" },
    }), "invalid_pointer_timestamp"],
    ["wrong release URL", (f) => ({
      ...f,
      manifest: { ...f.manifest, downloadUrl: "https://example.invalid/release.zip" },
    }), "invalid_download_url"],
    ["wrong native shell", (f) => f, "native_fingerprint_mismatch"],
    ["invalid artifact signature", (f) => ({
      ...f,
      metadata: { ...f.metadata, signature: "invalid" },
      manifest: { ...f.manifest, signature: "invalid" },
    }), "invalid_artifact_signature"],
    ["invalid provenance signature", (f) => ({
      ...f,
      metadata: { ...f.metadata, provenanceSignature: "invalid" },
      manifest: { ...f.manifest, provenanceSignature: "invalid" },
    }), "invalid_provenance_signature"],
    ["invalid pointer signature", (f) => ({
      ...f,
      manifest: { ...f.manifest, manifestSignature: "invalid" },
    }), "invalid_pointer_signature"],
  ])("rejects %s", (_label, mutate, reason) => {
    const validateStagedRelease = otaProvenanceModule.validateStagedRelease;
    expect(typeof validateStagedRelease).toBe("function");
    if (typeof validateStagedRelease !== "function") return;

    const fixture = mutate(signedReleaseFixture({ privateKey }));
    expect(
      validateStagedRelease({
        artifactBytes: fixture.bytes,
        metadata: fixture.metadata,
        manifest: fixture.manifest,
        channel: "canary",
        currentNativeFingerprint:
          reason === "native_fingerprint_mismatch" ? "ffffffffffffffff" : "0123456789abcdef",
        publicKey,
      }),
    ).toEqual({ ok: false, reason });
  });
});

describe("OTA deploy live-pointer transition", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("allows a newer authenticated pointer and reports the compared live digest", () => {
    const validatePointerTransition = otaProvenanceModule.validatePointerTransition;
    expect(typeof validatePointerTransition).toBe("function");
    if (typeof validatePointerTransition !== "function") return;

    const live = signedReleaseFixture({
      privateKey,
      pointerChangedAt: "2026-09-07T01:00:00.000Z",
    });
    const candidate = signedReleaseFixture({
      privateKey,
      pointerChangedAt: "2026-09-07T02:00:00.000Z",
    });
    expect(
      validatePointerTransition({
        liveManifest: live.manifest,
        liveBytes: live.manifestBytes,
        candidateManifest: candidate.manifest,
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({
      ok: true,
      idempotent: false,
      expectedLiveSha256: createHash("sha256").update(live.manifestBytes).digest("hex"),
    });
  });

  it("allows a missing live pointer and only an exact-byte equal idempotent retry", () => {
    const validatePointerTransition = otaProvenanceModule.validatePointerTransition;
    expect(typeof validatePointerTransition).toBe("function");
    if (typeof validatePointerTransition !== "function") return;

    const candidate = signedReleaseFixture({ privateKey });
    expect(
      validatePointerTransition({
        liveManifest: null,
        liveBytes: null,
        candidateManifest: candidate.manifest,
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({ ok: true, idempotent: false, expectedLiveSha256: null });
    expect(
      validatePointerTransition({
        liveManifest: candidate.manifest,
        liveBytes: candidate.manifestBytes,
        candidateManifest: candidate.manifest,
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({
      ok: true,
      idempotent: true,
      expectedLiveSha256: createHash("sha256").update(candidate.manifestBytes).digest("hex"),
    });
  });

  it.each([
    ["backwards", "2026-09-07T02:00:00.000Z", "2026-09-07T01:00:00.000Z"],
    ["equal but different", "2026-09-07T01:00:00.000Z", "2026-09-07T01:00:00.000Z"],
  ])("refuses a %s pointer transition", (_label, liveTime, candidateTime) => {
    const validatePointerTransition = otaProvenanceModule.validatePointerTransition;
    expect(typeof validatePointerTransition).toBe("function");
    if (typeof validatePointerTransition !== "function") return;

    const live = signedReleaseFixture({ privateKey, pointerChangedAt: liveTime });
    const candidate = signedReleaseFixture({
      privateKey,
      bytes: Buffer.from("different candidate release"),
      version: "1.2.4",
      pointerChangedAt: candidateTime,
    });
    expect(
      validatePointerTransition({
        liveManifest: live.manifest,
        liveBytes: live.manifestBytes,
        candidateManifest: candidate.manifest,
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "pointer_not_advanced" });
  });

  it("fails closed when either live or candidate pointer authentication is invalid", () => {
    const validatePointerTransition = otaProvenanceModule.validatePointerTransition;
    expect(typeof validatePointerTransition).toBe("function");
    if (typeof validatePointerTransition !== "function") return;

    const live = signedReleaseFixture({
      privateKey,
      pointerChangedAt: "2026-09-07T01:00:00.000Z",
    });
    const candidate = signedReleaseFixture({
      privateKey,
      pointerChangedAt: "2026-09-07T02:00:00.000Z",
    });
    expect(
      validatePointerTransition({
        liveManifest: { ...live.manifest, manifestSignature: "invalid" },
        liveBytes: live.manifestBytes,
        candidateManifest: candidate.manifest,
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "invalid_live_pointer" });
    expect(
      validatePointerTransition({
        liveManifest: live.manifest,
        liveBytes: live.manifestBytes,
        candidateManifest: { ...candidate.manifest, manifestSignature: "invalid" },
        candidateBytes: candidate.manifestBytes,
        channel: "canary",
        publicKey,
      }),
    ).toEqual({ ok: false, reason: "invalid_candidate_pointer" });
  });
});
