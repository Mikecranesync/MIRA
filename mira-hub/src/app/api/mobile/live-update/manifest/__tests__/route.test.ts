// GET /api/mobile/live-update/manifest
//
// The server half of OTA. The client (mira-mobile/src/lib/live-update.ts) has
// existed since #3393 and calls this route on every "Check now"; the route did
// not exist, so the Pixel reported `Update server error (404)` and OTA had
// never once worked.
//
// The contract is fixed by the client, and the tests below pin it:
//   - a usable update  -> 200 with bundleId + downloadUrl + checksum + signature
//   - anything else    -> 200 WITHOUT downloadUrl/bundleId and a closed reason
//                         vocabulary the client maps to actionable copy. A
//                         non-2xx becomes `server_<status>` on the device, which
//                         reads as broken — reserve it for bad requests.
//
// Run: cd mira-hub && npx vitest run src/app/api/mobile

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/capabilities/ota-provenance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/ota-provenance")>()),
  verifyPublishedManifestProvenance: vi.fn(() => true),
}));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { verifyPublishedManifestProvenance } from "@/capabilities/ota-provenance";

const session = {
  userId: "u_1",
  tenantId: "11111111-2222-3333-4444-555555555555",
  email: "tech@example.com",
  status: "trial",
  trialExpiresAt: null,
};

const FP = "b8e888a03076a108";
const ORIGIN = "https://updates.factorylm.com";

/** A manifest exactly as scripts/ota-publish.mjs writes it. */
function publishedManifest(over: Record<string, unknown> = {}) {
  return {
    bundleId: "1.0.1-9f2c1a4b",
    version: "1.0.1",
    channel: "canary",
    downloadUrl: `${ORIGIN}/releases/1.0.1/web-1.0.1-9f2c1a4b.zip`,
    checksum: "d".repeat(64),
    signature: "c2lnbmF0dXJlLWJ5dGVz",
    nativeFingerprint: FP,
    releaseSha: "e2b89725f088ac1734100fd01638735c2773108f",
    releasedAt: "2026-08-25T20:00:00.000Z",
    artifact: "web-1.0.1-9f2c1a4b.zip",
    artifactSha256: "d".repeat(64),
    provenanceSignature: "cHJvdmVuYW5jZS1zaWduYXR1cmU=",
    manifestSignature: "bWFuaWZlc3Qtc2lnbmF0dXJl",
    pointerChangedAt: "2026-09-07T01:02:03.004Z",
    ...over,
  };
}

function req(qs: string) {
  return new Request(`https://app.factorylm.com/api/mobile/live-update/manifest${qs}`);
}

function upstream(body: unknown, status = 200) {
  // Typed parameter so `.mock.calls[0][0]` (the requested URL) is assertable.
  return vi.fn(async (_url: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(verifyPublishedManifestProvenance).mockReturnValue(true);
});

describe("auth", () => {
  it("propagates a 401 rather than leaking release metadata", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(req(`?channel=canary&fingerprint=${FP}`));
    expect(res.status).toBe(401);
  });
});

describe("request validation", () => {
  it("rejects an unknown channel — only canary and production exist", async () => {
    const res = await GET(req(`?channel=beta&fingerprint=${FP}`));
    expect(res.status).toBe(400);
  });

  it("rejects a missing fingerprint: without it the compatibility gate is blind", async () => {
    const res = await GET(req("?channel=canary"));
    expect(res.status).toBe(400);
  });

  it("rejects a fingerprint that is not the expected shape", async () => {
    const res = await GET(req("?channel=canary&fingerprint=../../etc/passwd"));
    expect(res.status).toBe(400);
  });
});

describe("serving an update", () => {
  it("returns the published manifest when the fingerprint matches", async () => {
    const fetchMock = upstream(publishedManifest());
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req(`?channel=canary&fingerprint=${FP}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      bundleId: "1.0.1-9f2c1a4b",
      downloadUrl: `${ORIGIN}/releases/1.0.1/web-1.0.1-9f2c1a4b.zip`,
      checksum: "d".repeat(64),
      signature: "c2lnbmF0dXJlLWJ5dGVz",
      nativeFingerprint: FP,
      channel: "canary",
      provenanceSignature: "cHJvdmVuYW5jZS1zaWduYXR1cmU=",
      artifact: "web-1.0.1-9f2c1a4b.zip",
      pointerChangedAt: "2026-09-07T01:02:03.004Z",
    });
    // Reads the channel-specific published manifest.
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${ORIGIN}/manifest.canary.json`);
  });

  it("reads the production manifest when production is asked for", async () => {
    const fetchMock = upstream(publishedManifest({ channel: "production" }));
    vi.stubGlobal("fetch", fetchMock);
    await GET(req(`?channel=production&fingerprint=${FP}`));
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${ORIGIN}/manifest.production.json`);
  });

  it("never caches — a stale manifest would pin the fleet to an old bundle", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest()));
    const res = await GET(req(`?channel=canary&fingerprint=${FP}`));
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("honours OTA_ORIGIN so staging can point somewhere else", async () => {
    vi.stubEnv("OTA_ORIGIN", "https://ota-staging.factorylm.com");
    const fetchMock = upstream(
      publishedManifest({
        artifact: "w.zip",
        downloadUrl: "https://ota-staging.factorylm.com/releases/1.0.1/w.zip",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(req(`?channel=canary&fingerprint=${FP}`));
    const body = await res.json();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://ota-staging.factorylm.com/manifest.canary.json");
    expect(body.downloadUrl).toBe("https://ota-staging.factorylm.com/releases/1.0.1/w.zip");
  });
});

/**
 * Every case here must be a 200 with NO downloadUrl/bundleId and, where useful,
 * a code-owned reason the device can safely map. A non-2xx would surface as
 * "Update server error (NNN)", which is reserved for malformed requests.
 */
describe("no update — always 200, never a downloadUrl", () => {
  async function expectNoUpdate(res: Response, reason?: string) {
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toBeUndefined();
    expect(body.bundleId).toBeUndefined();
    if (reason) expect(body.reason).toBe(reason);
    return body;
  }

  it("refuses a bundle built for a different native surface", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ nativeFingerprint: "0000000000000000" })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "incompatible_native");
  });

  it("refuses a manifest published to a different channel", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ channel: "production" })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "channel_mismatch");
  });

  it("says nothing is published when the manifest 404s", async () => {
    vi.stubGlobal("fetch", upstream({ error: "not found" }, 404));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "no_manifest");
  });

  it("stays quiet when the release host is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "upstream_unavailable");
  });

  it("stays quiet when the release host returns 5xx", async () => {
    vi.stubGlobal("fetch", upstream("nope", 503));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "upstream_error");
  });

  it("rejects a manifest that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>404</html>", { status: 200 })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "malformed_manifest");
  });

  it("rejects a manifest missing its signature — unsigned must never reach the device", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ signature: undefined })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "malformed_manifest");
  });

  it("rejects a manifest missing its checksum", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ checksum: undefined })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "malformed_manifest");
  });

  it("rejects a manifest missing its authenticated pointer time", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ pointerChangedAt: undefined })));
    await expectNoUpdate(
      await GET(req(`?channel=canary&fingerprint=${FP}`)),
      "malformed_manifest",
    );
  });

  it.each([
    "2026-09-07T01:02:03Z",
    "2026-09-07T01:02:03.004+00:00",
    "2026-02-30T01:02:03.004Z",
  ])("rejects a noncanonical pointer timestamp: %s", async (pointerChangedAt) => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ pointerChangedAt })));
    await expectNoUpdate(
      await GET(req(`?channel=canary&fingerprint=${FP}`)),
      "invalid_pointer_timestamp",
    );
  });

  it("rejects metadata whose compatibility provenance signature is invalid", async () => {
    vi.mocked(verifyPublishedManifestProvenance).mockReturnValue(false);
    vi.stubGlobal("fetch", upstream(publishedManifest()));
    await expectNoUpdate(
      await GET(req(`?channel=canary&fingerprint=${FP}`)),
      "invalid_provenance",
    );
    expect(verifyPublishedManifestProvenance).toHaveBeenCalledOnce();
  });

  it("rejects a plain-http downloadUrl", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ downloadUrl: "http://updates.factorylm.com/r/x.zip" })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "bad_download_url");
  });

  it("rejects a downloadUrl pointing off the release host", async () => {
    // A manifest is only a pointer. If it could point anywhere, a tampered or
    // mis-published manifest would aim the whole fleet at an attacker's zip —
    // the signature check happens AFTER the download.
    vi.stubGlobal("fetch", upstream(publishedManifest({ downloadUrl: "https://evil.example.com/x.zip" })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "bad_download_url");
  });

  it("rejects a lookalike release host", async () => {
    vi.stubGlobal("fetch", upstream(publishedManifest({ downloadUrl: "https://updates.factorylm.com.evil.net/x.zip" })));
    await expectNoUpdate(await GET(req(`?channel=canary&fingerprint=${FP}`)), "bad_download_url");
  });

  it("refuses a download path that does not name the authenticated artifact", async () => {
    vi.stubGlobal(
      "fetch",
      upstream(
        publishedManifest({
          downloadUrl: `${ORIGIN}/releases/1.0.1/different.zip`,
        }),
      ),
    );
    await expectNoUpdate(
      await GET(req(`?channel=canary&fingerprint=${FP}`)),
      "artifact_mismatch",
    );
  });
});
