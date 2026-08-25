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
import { beforeEach, describe, expect, it, vi } from "vitest";

const FINGERPRINT = "fp-native-abc123";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

const plugin = vi.hoisted(() => ({
  ready: vi.fn(async () => undefined),
  downloadBundle: vi.fn(async () => undefined),
  setNextBundle: vi.fn(async () => undefined),
  getCurrentBundle: vi.fn(async () => ({ bundleId: "packaged" })),
  reset: vi.fn(async () => undefined),
}));
vi.mock("@capawesome/capacitor-live-update", () => ({ LiveUpdate: plugin }));

// The build injects this; pin it so the fingerprint gate is testable.
(globalThis as unknown as Record<string, string>).__FLM_NATIVE_FINGERPRINT__ = FINGERPRINT;

const validManifest = {
  bundleId: "b-2026-08-24-01",
  downloadUrl: "https://app.factorylm.com/ota/b-2026-08-24-01.zip",
  checksum: "sha256-deadbeef",
  signature: "rsa-sig",
  channel: "canary",
  nativeFingerprint: FINGERPRINT,
  releaseSha: "91d437e5e",
  releasedAt: "2026-08-24T00:00:00Z",
};

function serve(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

const idle = () => false;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as Record<string, string>).__FLM_NATIVE_FINGERPRINT__ = FINGERPRINT;
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
  });
});

describe("checkAndStage — what it refuses, before downloading anything", () => {
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

  it("recoverToPackaged drops every downloaded bundle", async () => {
    const { recoverToPackaged } = await import("../live-update");
    await recoverToPackaged();
    expect(plugin.reset).toHaveBeenCalledTimes(1);
  });

  it("reports the packaged bundle when nothing has been staged", async () => {
    const { currentBundleId } = await import("../live-update");
    expect(await currentBundleId()).toBe("packaged");
  });
});
