/**
 * OTA verification rules (ADR-0034 amendment).
 *
 * Every assertion here is a security property, not a behaviour preference. The
 * shape of the risk: this is the one code path where the app runs JavaScript it
 * did not ship with. Each rule below is what stops that from becoming "anyone
 * who can answer an HTTPS request owns the technician's phone".
 *
 * The refusals are tested by observing that `downloadBundle` was NEVER CALLED —
 * asserting on the returned reason string alone would pass even if the download
 * had already happened.
 */
import { createSign, generateKeyPairSync, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FINGERPRINT = "fp-native-abc123";
const PACKAGED_MINIMUM = "2026-09-01T00:00:00.000Z";
const POINTER_HIGH_WATER_KEY = "flm.ota.pointerHighWater.v1.canary";
const COOKIE_JAR_KEY = "flm.cookiejar.v1";

const nativeHttp = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: nativeHttp,
}));

const plugin = vi.hoisted(() => ({
  ready: vi.fn(async () => undefined),
  downloadBundle: vi.fn(async () => undefined),
  setNextBundle: vi.fn(async () => undefined),
  getCurrentBundle: vi.fn(async () => ({ bundleId: "packaged" })),
  getNextBundle: vi.fn(async () => ({ bundleId: null as string | null })),
  getDownloadedBundles: vi.fn(async () => ({ bundleIds: [] as string[] })),
  deleteBundle: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
}));
vi.mock("@capawesome/capacitor-live-update", () => ({ LiveUpdate: plugin }));

const preferences = vi.hoisted(() => ({
  data: new Map<string, string>(),
  failOnGetKey: null as string | null,
  failOnSetKey: null as string | null,
  commitThenFailOnSetKey: null as string | null,
  get: vi.fn(async ({ key }: { key: string }) => {
    if (preferences.failOnGetKey === key) throw new Error("preferences unavailable");
    return { value: preferences.data.get(key) ?? null };
  }),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    if (preferences.failOnSetKey === key) throw new Error("preferences unavailable");
    preferences.data.set(key, value);
    if (preferences.commitThenFailOnSetKey === key) {
      throw new Error("preferences response unavailable after commit");
    }
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    preferences.data.delete(key);
  }),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: preferences.get, set: preferences.set, remove: preferences.remove },
}));

const pointerCrypto = vi.hoisted(() => ({
  importKey: vi.fn(async () => ({ type: "public" })),
  verify: vi.fn(async () => true),
}));

// The build injects this; pin it so the fingerprint gate is testable.
(globalThis as unknown as Record<string, string>).__FLM_NATIVE_FINGERPRINT__ = FINGERPRINT;
(globalThis as unknown as Record<string, string>).__FLM_PACKAGED_BUILD_MINIMUM__ =
  PACKAGED_MINIMUM;

const validManifest = {
  bundleId: "b-2026-08-24-01",
  downloadUrl: "https://app.factorylm.com/ota/b-2026-08-24-01.zip",
  checksum: "sha256-deadbeef",
  signature: "rsa-sig",
  channel: "canary",
  nativeFingerprint: FINGERPRINT,
  version: "1.2.0",
  artifact: "deadbeefdeadbeef.zip",
  releaseSha: "91d437e5e91d437e5e91d437e5e91d437e5e91d4",
  releasedAt: "2026-08-24T00:00:00.000Z",
  artifactSha256: "d".repeat(64),
  provenanceSignature: "cHJvdmVuYW5jZS1yc2Etc2ln",
  manifestSignature: "cG9pbnRlci1yc2Etc2ln",
  pointerChangedAt: "2026-09-07T01:02:03.004Z",
};

function serve(body: unknown, ok = true, status = 200) {
  nativeHttp.request.mockResolvedValue({
    status,
    data: JSON.stringify(body),
    headers: {},
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

const idle = () => false;

beforeEach(() => {
  vi.clearAllMocks();
  nativeHttp.request.mockReset();
  plugin.ready.mockReset().mockResolvedValue(undefined);
  plugin.downloadBundle.mockReset().mockResolvedValue(undefined);
  plugin.setNextBundle.mockReset().mockResolvedValue(undefined);
  plugin.getCurrentBundle.mockReset().mockResolvedValue({ bundleId: "packaged" });
  plugin.getNextBundle.mockReset().mockResolvedValue({ bundleId: null });
  plugin.getDownloadedBundles.mockReset().mockResolvedValue({ bundleIds: [] });
  plugin.deleteBundle.mockReset().mockResolvedValue(undefined);
  plugin.reset.mockReset().mockResolvedValue(undefined);
  preferences.data.clear();
  preferences.failOnGetKey = null;
  preferences.failOnSetKey = null;
  preferences.commitThenFailOnSetKey = null;
  preferences.data.set(
    COOKIE_JAR_KEY,
    JSON.stringify({ "__Secure-next-auth.session-token": "session-cookie" }),
  );
  vi.stubGlobal("crypto", { subtle: pointerCrypto });
  (globalThis as unknown as Record<string, string>).__FLM_NATIVE_FINGERPRINT__ = FINGERPRINT;
  (globalThis as unknown as Record<string, string>).__FLM_PACKAGED_BUILD_MINIMUM__ =
    PACKAGED_MINIMUM;
});

describe("checkAndStage — what it accepts", () => {
  it("downloads, verifies and STAGES a valid signed bundle without applying it", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: "b-2026-08-24-01", reason: "staged" });
    // Checksum AND signature are both handed to the verifying layer.
    expect(plugin.downloadBundle).toHaveBeenCalledWith(
      expect.objectContaining({ checksum: "sha256-deadbeef", signature: "rsa-sig" }),
    );
    // Staged for next launch — nothing swapped under the running app.
    expect(plugin.setNextBundle).toHaveBeenCalledWith({ bundleId: "b-2026-08-24-01" });
    expect(preferences.data.get(POINTER_HIGH_WATER_KEY)).toBe(
      "2026-09-07T01:02:03.004Z",
    );
    const highWaterCall = preferences.set.mock.calls.findIndex(
      ([input]) => input.key === POINTER_HIGH_WATER_KEY,
    );
    expect(highWaterCall).toBeGreaterThanOrEqual(0);
    expect(preferences.set.mock.invocationCallOrder[highWaterCall]).toBeLessThan(
      plugin.setNextBundle.mock.invocationCallOrder[0],
    );
  });

  it("uses the persisted session cookie through the canonical trailing-slash native request seam", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result.reason).toBe("staged");
    expect(nativeHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(
          /^https:\/\/app\.factorylm\.com\/api\/mobile\/live-update\/manifest\/\?channel=canary&fingerprint=/,
        ),
        headers: expect.objectContaining({
          Cookie: "__Secure-next-auth.session-token=session-cookie",
        }),
        disableRedirects: true,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records the channel replay floor when the authenticated pointer already names the active bundle", async () => {
    const { checkAndStage } = await import("../live-update");
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    serve({ ...validManifest, channel: "production" });

    const result = await checkAndStage({ channel: "production", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "no_update" });
    expect(preferences.data.get("flm.ota.pointerHighWater.v1.production")).toBe(
      validManifest.pointerChangedAt,
    );
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("records the replay floor and restores the staged result when native already targets the bundle", async () => {
    const { checkAndStage } = await import("../live-update");
    plugin.getNextBundle.mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    serve(validManifest);

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: validManifest.bundleId, reason: "staged" });
    expect(preferences.data.get(POINTER_HIGH_WATER_KEY)).toBe(validManifest.pointerChangedAt);
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("accepts an active-bundle replay floor only after reconciling an ambiguous write", async () => {
    const { checkAndStage } = await import("../live-update");
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    preferences.commitThenFailOnSetKey = POINTER_HIGH_WATER_KEY;
    serve(validManifest);

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "no_update" });
    expect(preferences.data.get(POINTER_HIGH_WATER_KEY)).toBe(validManifest.pointerChangedAt);
    expect(preferences.get).toHaveBeenCalledTimes(2);
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("keeps the active-bundle replay floor unavailable when an ambiguous write rereads missing", async () => {
    const { checkAndStage } = await import("../live-update");
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    preferences.failOnSetKey = POINTER_HIGH_WATER_KEY;
    serve(validManifest);

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "pointer_state_unavailable" });
    expect(preferences.data.has(POINTER_HIGH_WATER_KEY)).toBe(false);
    expect(preferences.get).toHaveBeenCalledTimes(2);
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });
});

describe("checkAndStage — authenticated Hub no-update reasons", () => {
  it.each([
    ["upstream_unavailable", "unreachable"],
    ["upstream_error", "check_failed"],
    ["malformed_manifest", "invalid_pointer_signature"],
    ["channel_mismatch", "channel_mismatch"],
    ["invalid_pointer_timestamp", "invalid_pointer_timestamp"],
    ["invalid_provenance", "invalid_pointer_signature"],
    ["incompatible_native", "incompatible_native"],
    ["bad_download_url", "invalid_manifest_origin"],
    ["artifact_mismatch", "verify_failed"],
  ])("maps %s to the actionable device result %s", async (hubReason, deviceReason) => {
    const { checkAndStage } = await import("../live-update");
    serve({ update: false, reason: hubReason });

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: deviceReason });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });

  it.each([
    { update: false, reason: "no_manifest" },
    { update: false, reason: "arbitrary_upstream_detail" },
    { update: false, reason: "toString" },
    { update: false, reason: "constructor" },
    { reason: "invalid_provenance" },
    null,
  ])("keeps absent or untrusted Hub reason data as no-update", async (body) => {
    const { checkAndStage } = await import("../live-update");
    serve(body);

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "no_update" });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });
});

describe("native pending bundle state", () => {
  it("reads the plugin's restart target without changing it", async () => {
    plugin.getNextBundle.mockResolvedValueOnce({ bundleId: "b-next" });
    const { pendingBundleId } = await import("../live-update");
    await expect(pendingBundleId()).resolves.toBe("b-next");
    expect(plugin.getNextBundle).toHaveBeenCalledOnce();
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });
});

describe("checkAndStage — what it refuses, before downloading anything", () => {
  it("refuses a pointer without a canonical immutable release SHA", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, releaseSha: "unknown" });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("invalid_pointer_signature");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a bundle built for different native code", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, nativeFingerprint: "fp-someone-elses-shell" });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("incompatible_native");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a manifest with no signature", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, signature: undefined });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("unsigned");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a manifest with no checksum", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, checksum: undefined });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("unsigned");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a plain-http download url even if everything else is valid", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, downloadUrl: "http://app.factorylm.com/ota/x.zip" });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("not_https");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("independently refuses an invalid manifest-pointer signature", async () => {
    const { checkAndStage } = await import("../live-update");
    pointerCrypto.verify.mockResolvedValueOnce(false);
    serve(validManifest);

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("invalid_pointer_signature");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it.each([
    "2026-09-07T01:02:03Z",
    "2026-09-07T01:02:03.004+00:00",
    "2026-02-30T01:02:03.004Z",
    " 2026-09-07T01:02:03.004Z",
  ])("refuses a malformed or noncanonical pointer timestamp: %s", async (pointerChangedAt) => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, pointerChangedAt });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("invalid_pointer_timestamp");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a pointer older than the deterministic packaged-build minimum", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({ ...validManifest, pointerChangedAt: "2026-08-31T23:59:59.999Z" });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("stale_pointer");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("refuses a signed pointer timestamp that predates its release", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({
      ...validManifest,
      releasedAt: "2026-09-07T02:00:00.000Z",
      pointerChangedAt: "2026-09-07T01:59:59.999Z",
    });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r.reason).toBe("invalid_pointer_signature");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("rejects an older per-channel pointer but allows an equal pointer", async () => {
    const { checkAndStage } = await import("../live-update");
    preferences.data.set(POINTER_HIGH_WATER_KEY, "2026-09-07T01:02:03.004Z");
    serve({ ...validManifest, pointerChangedAt: "2026-09-07T01:02:03.003Z" });

    const replay = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(replay.reason).toBe("replayed_pointer");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();

    serve(validManifest);
    const equal = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(equal.reason).toBe("staged");
  });

  it("keeps production and canary replay high-water marks independent", async () => {
    const { checkAndStage } = await import("../live-update");
    preferences.data.set(POINTER_HIGH_WATER_KEY, "2026-09-08T01:02:03.004Z");
    serve({ ...validManifest, channel: "production" });

    const r = await checkAndStage({ channel: "production", isBusy: idle });

    expect(r.reason).toBe("staged");
    expect(preferences.data.get("flm.ota.pointerHighWater.v1.production")).toBe(
      validManifest.pointerChangedAt,
    );
  });

  it.each([
    { currentBundleId: "newer-active-bundle", nextBundleId: null },
    { currentBundleId: "packaged", nextBundleId: "newer-pending-bundle" },
    { currentBundleId: validManifest.bundleId, nextBundleId: "different-pending-bundle" },
    { currentBundleId: "different-active-bundle", nextBundleId: validManifest.bundleId },
  ])(
    "refuses a different pointer when an OTA bundle exists without a durable channel floor: $currentBundleId/$nextBundleId",
    async ({ currentBundleId, nextBundleId }) => {
      const { checkAndStage } = await import("../live-update");
      plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: currentBundleId });
      plugin.getNextBundle.mockResolvedValueOnce({ bundleId: nextBundleId });
      serve(validManifest);

      const result = await checkAndStage({ channel: "canary", isBusy: idle });

      expect(result).toEqual({ staged: null, reason: "pointer_state_unavailable" });
      expect(plugin.downloadBundle).not.toHaveBeenCalled();
      expect(plugin.deleteBundle).not.toHaveBeenCalled();
    },
  );

  it("allows a newer rollback pointer to reference an older released version", async () => {
    const { checkAndStage } = await import("../live-update");
    preferences.data.set(POINTER_HIGH_WATER_KEY, "2026-09-07T01:02:03.004Z");
    serve({
      ...validManifest,
      bundleId: "0.9.0-deadbeef",
      version: "0.9.0",
      releasedAt: "2026-01-01T00:00:00.000Z",
      pointerChangedAt: "2026-09-07T01:02:03.005Z",
    });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: "0.9.0-deadbeef", reason: "staged" });
  });

  it("stages nothing while the technician has unsynced work", async () => {
    // Pending offline work orders, an upload in flight, an open mutation: an
    // update is never worth interrupting work that is not yet on the server.
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);

    const r = await checkAndStage({ channel: "canary", isBusy: () => true });

    expect(r.reason).toBe("busy");
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });
});

describe("checkAndStage — an update server that is down must be a non-event", () => {
  it("treats an empty body as an explicit no-update", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({});
    const r = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(r).toMatchObject({ staged: null, reason: "no_update" });
  });

  it("treats a 500 as no-update, never as a failure that blocks the app", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({}, false, 500);
    const r = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(r.staged).toBeNull();
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("survives a thrown network error", async () => {
    const { checkAndStage } = await import("../live-update");
    nativeHttp.request.mockRejectedValue(new Error("ENOTFOUND"));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    const r = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(r).toMatchObject({ staged: null, reason: "unreachable" });
  });

  it("reports verify_failed and stages nothing when the plugin rejects the bundle", async () => {
    // Checksum mismatch / bad signature surface here. The technician's app is
    // unchanged, which is the only outcome that matters.
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.downloadBundle.mockRejectedValueOnce(new Error("checksum mismatch"));

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: null, reason: "verify_failed" });
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
    expect(preferences.data.has(POINTER_HIGH_WATER_KEY)).toBe(false);
  });

  it("does not advance replay state when the verified bundle cannot be staged", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles
      .mockResolvedValueOnce({ bundleIds: [] })
      .mockResolvedValueOnce({ bundleIds: [validManifest.bundleId] });
    plugin.setNextBundle.mockRejectedValueOnce(new Error("could not stage"));

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: null, reason: "verify_failed" });
    expect(preferences.data.has(POINTER_HIGH_WATER_KEY)).toBe(false);
    expect(plugin.deleteBundle).toHaveBeenCalledWith({ bundleId: validManifest.bundleId });
  });

  it("treats a setNext rejection with a committed native side effect as staged", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.setNextBundle.mockImplementationOnce(async () => {
      plugin.getNextBundle.mockResolvedValueOnce({ bundleId: validManifest.bundleId });
      throw new Error("bridge response lost after staging");
    });

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: validManifest.bundleId, reason: "staged" });
    expect(preferences.data.get(POINTER_HIGH_WATER_KEY)).toBe(validManifest.pointerChangedAt);
    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("fails closed without weakening replay state when staging outcome cannot be read", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.setNextBundle.mockImplementationOnce(async () => {
      plugin.getNextBundle.mockRejectedValueOnce(new Error("native state unavailable"));
      throw new Error("staging outcome unknown");
    });

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "bundle_state_unavailable" });
    expect(preferences.data.get(POINTER_HIGH_WATER_KEY)).toBe(validManifest.pointerChangedAt);
    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("does not stage a verified bundle when replay state cannot be made durable", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles
      .mockResolvedValueOnce({ bundleIds: [] })
      .mockResolvedValueOnce({ bundleIds: [validManifest.bundleId] });
    preferences.failOnSetKey = POINTER_HIGH_WATER_KEY;

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: null, reason: "pointer_state_unavailable" });
    expect(plugin.downloadBundle).toHaveBeenCalledTimes(1);
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
    expect(plugin.deleteBundle).toHaveBeenCalledWith({ bundleId: validManifest.bundleId });
  });

  it("deletes an orphaned copy before retrying the same signed bundle", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles.mockResolvedValueOnce({
      bundleIds: [validManifest.bundleId],
    });

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: validManifest.bundleId, reason: "staged" });
    expect(plugin.deleteBundle).toHaveBeenCalledWith({ bundleId: validManifest.bundleId });
    expect(plugin.deleteBundle.mock.invocationCallOrder[0]).toBeLessThan(
      plugin.downloadBundle.mock.invocationCallOrder[0],
    );
  });

  it("does not download or delete when native bundle inventory cannot be read", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles.mockRejectedValueOnce(new Error("inventory unavailable"));

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "bundle_state_unavailable" });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("does not redownload when orphan cleanup fails", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles.mockResolvedValueOnce({ bundleIds: [validManifest.bundleId] });
    plugin.deleteBundle.mockRejectedValueOnce(new Error("cleanup failed"));

    const result = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(result).toEqual({ staged: null, reason: "bundle_cleanup_failed" });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("never deletes the current bundle while cleaning up a failed stage", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getCurrentBundle
      .mockResolvedValueOnce({ bundleId: "packaged" })
      .mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    plugin.getDownloadedBundles
      .mockResolvedValueOnce({ bundleIds: [] })
      .mockResolvedValueOnce({ bundleIds: [validManifest.bundleId] });
    plugin.setNextBundle.mockRejectedValueOnce(new Error("could not stage"));

    await checkAndStage({ channel: "canary", isBusy: idle });

    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("never deletes the native next bundle while cleaning up a failed stage", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getNextBundle
      .mockResolvedValueOnce({ bundleId: null })
      .mockResolvedValueOnce({ bundleId: validManifest.bundleId });
    plugin.getDownloadedBundles
      .mockResolvedValueOnce({ bundleIds: [] })
      .mockResolvedValueOnce({ bundleIds: [validManifest.bundleId] });
    plugin.setNextBundle.mockRejectedValueOnce(new Error("could not stage"));

    await checkAndStage({ channel: "canary", isBusy: idle });

    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });

  it("preserves a bundle when cleanup inventory cannot be read", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.getDownloadedBundles
      .mockResolvedValueOnce({ bundleIds: [] })
      .mockRejectedValueOnce(new Error("inventory unavailable"));
    plugin.setNextBundle.mockRejectedValueOnce(new Error("could not stage"));

    await checkAndStage({ channel: "canary", isBusy: idle });

    expect(plugin.deleteBundle).not.toHaveBeenCalled();
  });
});

describe("manifest-pointer canonical crypto", () => {
  it("verifies RSA-SHA256 over the canonical ordered pointer fields", async () => {
    const live = (await import("../live-update")) as unknown as Record<string, unknown>;
    expect(typeof live.manifestPointerPayload).toBe("function");
    expect(typeof live.verifyOtaManifestPointer).toBe("function");
    if (
      typeof live.manifestPointerPayload !== "function" ||
      typeof live.verifyOtaManifestPointer !== "function"
    ) {
      return;
    }

    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const payload = (live.manifestPointerPayload as (value: unknown) => string)(validManifest);
    const signer = createSign("RSA-SHA256");
    signer.update(payload, "utf8");
    const signature = signer.sign(privateKey, "base64");
    vi.stubGlobal("crypto", webcrypto);

    await expect(
      (live.verifyOtaManifestPointer as (
        value: unknown,
        signature: string,
        publicKey: string,
      ) => Promise<boolean>)(validManifest, signature, publicPem),
    ).resolves.toBe(true);
    await expect(
      (live.verifyOtaManifestPointer as (
        value: unknown,
        signature: string,
        publicKey: string,
      ) => Promise<boolean>)(
        { ...validManifest, pointerChangedAt: "2026-09-07T01:02:03.005Z" },
        signature,
        publicPem,
      ),
    ).resolves.toBe(false);
  });
});

describe("OTA channel preference", () => {
  it("defaults ordinary devices to production and persists explicit canary enrollment", async () => {
    const live = (await import("../live-update")) as unknown as Record<string, unknown>;
    expect(typeof live.readOtaChannel).toBe("function");
    expect(typeof live.writeOtaChannel).toBe("function");
    if (typeof live.readOtaChannel !== "function" || typeof live.writeOtaChannel !== "function") {
      return;
    }

    await expect((live.readOtaChannel as () => Promise<string>)()).resolves.toBe("production");
    await (live.writeOtaChannel as (channel: string) => Promise<void>)("canary");
    await expect((live.readOtaChannel as () => Promise<string>)()).resolves.toBe("canary");
  });

  it("fails closed when persisted channel state cannot be read", async () => {
    const { readOtaChannel, otaStorageKeys } = await import("../live-update");
    preferences.failOnGetKey = otaStorageKeys.CHANNEL_KEY;

    await expect(readOtaChannel()).rejects.toThrow("preferences unavailable");
  });
});

describe("startup + recovery", () => {
  it("confirmBundleReady calls ready() so a booting bundle is not rolled back", async () => {
    const { confirmBundleReady } = await import("../live-update");
    await confirmBundleReady();
    expect(plugin.ready).toHaveBeenCalledTimes(1);
  });

  it("never throws out of startup when ready() fails", async () => {
    // Failing to CONFIRM is survivable — the native layer rolls back next
    // launch. Failing to START is not.
    const { confirmBundleReady } = await import("../live-update");
    plugin.ready.mockRejectedValueOnce(new Error("bridge not available"));
    await expect(confirmBundleReady()).resolves.toBeUndefined();
  });

  it("recoverToPackaged selects the packaged bundle for the next launch", async () => {
    const { recoverToPackaged } = await import("../live-update");
    await recoverToPackaged();
    expect(plugin.reset).toHaveBeenCalledTimes(1);
  });

  it("reports the packaged bundle when nothing has been staged", async () => {
    const { currentBundleId } = await import("../live-update");
    expect(await currentBundleId()).toBe("packaged");
  });
});
