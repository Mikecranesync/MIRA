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

// checkAndStage now goes through the ONE authenticated seam rather than bare
// fetch, because the manifest route is session-gated and a bare fetch carries no
// cookie on native. Mock the seam, not global fetch — mocking fetch would keep
// these tests green while the real request path 401s, which is exactly how the
// 401 survived a full green suite.
const client = vi.hoisted(() => ({
  request: vi.fn(),
  withAuthEventsSuppressed: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  API_BASE: "https://app.factorylm.com",
  ApiError: class ApiError extends Error {
    kind: string;
    status: number | null;
    constructor(kind: string, status: number | null, detail = "") {
      super(detail || kind);
      this.kind = kind;
      this.status = status;
    }
  },
}));
vi.mock("../../api/client", () => client);

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
  if (ok) {
    client.request.mockResolvedValue({ status, data: body, text: "" });
  } else {
    client.request.mockRejectedValue(
      new client.ApiError(status === 401 ? "auth" : "server", status, `HTTP ${status}`),
    );
  }
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
    client.request.mockRejectedValue(new client.ApiError("network", null, "ENOTFOUND"));
    const r = await checkAndStage({ channel: "canary", isBusy: idle });
    expect(r).toMatchObject({ staged: null, reason: "unreachable" });
  });

  // CANARY-OTA-NAV-AUDIT: these four used to collapse into one "integrity" message,
  // which told a technician on a bad network that their update had failed a trust
  // check. The app being unchanged is still the outcome; WHY it is unchanged is now
  // distinguishable, because only two of these four are trust events.
  it.each([
    ["checksum mismatch", "checksum_mismatch"],
    ["signature verification failed", "signature_invalid"],
    ["bundle already exists", "duplicate_bundle"],
    ["network connection timed out", "download_failed"],
  ])("plugin rejects with %j -> reason %j, and stages nothing", async (thrown, reason) => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.downloadBundle.mockRejectedValueOnce(new Error(thrown));

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toMatchObject({ staged: null, reason });
    expect(plugin.setNextBundle).not.toHaveBeenCalled();
  });

  it("falls back to unknown_error — NOT a trust failure — for an unrecognised rejection", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);
    plugin.downloadBundle.mockRejectedValueOnce(new Error("something nobody anticipated"));
    const r = await checkAndStage({ channel: "canary", isBusy: idle });
    // This assertion used to expect verify_failed. That encoded the defect: an
    // unrecognised message was reported as an integrity failure, so a wrapped,
    // localised, or iOS-phrased transport error accused the bundle of being
    // tampered with. A trust claim must require positive evidence.
    expect(r).toMatchObject({ staged: null, reason: "unknown_error" });
  });

  // getBundles() is deprecated as of plugin 7.4.0 in favour of
  // getDownloadedBundles(); both mean "already downloaded". We ship 8.4.1, so the
  // current name must be preferred and the old one must still work for a native
  // shell that has not been rebuilt.
  it.each([
    ["getDownloadedBundles", "current API"],
    ["getBundles", "deprecated API on an older shell"],
  ])("reuses an already-downloaded bundle via %s (%s)", async (method) => {
    const { checkAndStage } = await import("../live-update");
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: "1.1.6-oldbundle" });
    (plugin as Record<string, unknown>)[method] = vi.fn(async () => ({
      bundleIds: [validManifest.bundleId],
    }));
    serve(validManifest);

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(plugin.setNextBundle).toHaveBeenCalledWith({ bundleId: validManifest.bundleId });
    expect(r).toMatchObject({ staged: validManifest.bundleId, reason: "reused_local" });
    delete (plugin as Record<string, unknown>)[method];
  });

  it("prefers getDownloadedBundles over the deprecated getBundles", async () => {
    const { checkAndStage } = await import("../live-update");
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: "1.1.6-oldbundle" });
    const current = vi.fn(async () => ({ bundleIds: [validManifest.bundleId] }));
    const deprecated = vi.fn(async () => ({ bundleIds: [] as string[] }));
    (plugin as Record<string, unknown>).getDownloadedBundles = current;
    (plugin as Record<string, unknown>).getBundles = deprecated;
    serve(validManifest);

    await checkAndStage({ channel: "canary", isBusy: idle });

    expect(current).toHaveBeenCalled();
    expect(deprecated).not.toHaveBeenCalled();
    delete (plugin as Record<string, unknown>).getDownloadedBundles;
    delete (plugin as Record<string, unknown>).getBundles;
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

describe("CANARY-OTA-NAV-AUDIT — Mike's Pixel: canary offers the bundle already running", () => {
  it("says up to date and does NOT re-download the active bundle", async () => {
    // Reproduces the reported state exactly: 1.1.7-9bfdc185 is ACTIVE, and the
    // canary manifest offers that same bundle id.
    plugin.getCurrentBundle.mockResolvedValueOnce({ bundleId: "1.1.7-9bfdc185" });
    serve({ ...validManifest, bundleId: "1.1.7-9bfdc185" });
    const { checkAndStage } = await import("../live-update");
    const r = await checkAndStage({ channel: "canary", isBusy: async () => false });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
    expect(r).toEqual({ staged: null, reason: "up_to_date" });
  });
});

describe("the request contract the phone actually uses", () => {
  it("asks the session-gated route through the authenticated seam, not bare fetch", async () => {
    const { checkAndStage } = await import("../live-update");
    serve(validManifest);

    await checkAndStage({ channel: "canary", isBusy: idle });

    expect(client.request).toHaveBeenCalledTimes(1);
    const path = client.request.mock.calls[0][0] as string;
    // Canonical trailing slash BEFORE the query: without it the server answers
    // 308 and the client pays a redirect hop on every check.
    expect(path.startsWith("/api/mobile/live-update/manifest/?")).toBe(true);
    expect(path).toContain("channel=canary");
    expect(path).toContain(`fingerprint=${FINGERPRINT}`);
    // A bare fetch is what produced the 401 in production. It must not be used.
    expect(path.startsWith("http")).toBe(false);
  });

  it("reports unauthenticated instead of a bare server_401", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({}, false, 401);

    const r = await checkAndStage({ channel: "canary", isBusy: idle });

    expect(r).toEqual({ staged: null, reason: "unauthenticated" });
    expect(plugin.downloadBundle).not.toHaveBeenCalled();
  });

  it("never signs the technician out because an update check found no session", async () => {
    const { checkAndStage } = await import("../live-update");
    serve({}, false, 401);

    await checkAndStage({ channel: "canary", isBusy: idle });

    // The 401 must be raised INSIDE the suppression window, or a routine update
    // check throws the user to the login screen mid-diagnosis.
    expect(client.withAuthEventsSuppressed).toHaveBeenCalledTimes(1);
  });
});

describe("classifyDownloadFailure — against the plugin's real messages", () => {
  // Read out of @capawesome/capacitor-live-update's Android sources: these are
  // the strings that reach the handset. The previous table was written against
  // invented messages and passed while misclassifying every real one.
  it.each([
    ["Bundle could not be downloaded.", "download_failed"],
    ["Request timed out.", "download_failed"],
    ["Checksum mismatch.", "checksum_mismatch"],
    ["Failed to calculate checksum.", "verify_failed"],
    ["Signature verification failed.", "signature_invalid"],
    ["Bundle does not contain a signature.", "unsigned_bundle"],
    ["Invalid public key.", "signature_invalid"],
    ["Bundle is blocked and will not be downloaded.", "bundle_blocked"],
    ["Unauthorized. Channel Discovery may not be enabled for this app.", "channel_unauthorized"],
    ["The bundle does not contain an index.html file.", "bundle_malformed"],
    ["Sync is already in progress.", "busy"],
    ["An unknown error has occurred.", "unknown_error"],
  ])("%s -> %s", async (message, expected) => {
    const { classifyDownloadFailure } = await import("../live-update");
    expect(classifyDownloadFailure(new Error(message))).toBe(expected);
  });

  it("never lets a real plugin message fall through to the catch-all", async () => {
    const { classifyDownloadFailure } = await import("../live-update");
    const REAL_MESSAGES = [
      "Bundle could not be downloaded.",
      "Request timed out.",
      "Checksum mismatch.",
      "Signature verification failed.",
      "Bundle does not contain a signature.",
      "Invalid public key.",
      "Bundle is blocked and will not be downloaded.",
      "The bundle does not contain an index.html file.",
      "Sync is already in progress.",
      "An unknown error has occurred.",
    ];
    // "Failed to calculate checksum." maps to verify_failed ON PURPOSE — it means
    // the check could not run, which is genuinely a verification failure — so it
    // is excluded here rather than weakening the assertion.
    for (const m of REAL_MESSAGES) {
      expect(classifyDownloadFailure(new Error(m))).not.toBe("verify_failed");
    }
  });

  it("a transport failure is never reported as an integrity failure", async () => {
    const { classifyDownloadFailure } = await import("../live-update");
    const TRUST = ["checksum_mismatch", "signature_invalid", "unsigned_bundle"];
    expect(TRUST).not.toContain(classifyDownloadFailure(new Error("Bundle could not be downloaded.")));
    expect(TRUST).not.toContain(classifyDownloadFailure(new Error("Request timed out.")));
  });
});

describe("review findings from 45bdb8047", () => {
  it("an UNRECOGNISED failure is never reported as a trust failure", async () => {
    const { classifyDownloadFailure } = await import("../live-update");
    // A wrapped, localised, or future plugin message matches no rule. The default
    // must not accuse the bundle of failing verification — that is the same defect
    // this function exists to prevent, one layer deeper.
    const TRUST = ["checksum_mismatch", "signature_invalid", "unsigned_bundle", "verify_failed"];
    for (const msg of [
      "Le paquet n'a pas pu être téléchargé.", // localised
      "LiveUpdateError: something the table has never seen",
      "",
      "undefined",
    ]) {
      expect(TRUST).not.toContain(classifyDownloadFailure(new Error(msg)));
      expect(classifyDownloadFailure(new Error(msg))).toBe("unknown_error");
    }
  });

  it("the probe checks the SAME path the client requests", async () => {
    // The probe duplicates MANIFEST_PATH by necessity — it is a plain node script
    // and cannot import the TS module. A comment saying "must match" is not a
    // guard; this is. The whole reason the probe exists is that we verified the
    // wrong URL for two releases.
    const { readFileSync } = await import("node:fs");
    const { MANIFEST_PATH } = await import("../live-update");
    const probe = readFileSync(
      new URL("../../../scripts/ota-readiness-probe.mjs", import.meta.url),
      "utf8",
    );
    const m = probe.match(/const MANIFEST_PATH = "([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(MANIFEST_PATH);
  });
});
