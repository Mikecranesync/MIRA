// Vitest coverage for src/lib/nameplate/detect.ts — the mira-ask detector
// client. The single invariant: detection is an OPTIMIZATION. Every failure
// mode (flag off, service down, timeout, zero boxes, malformed geometry,
// missing crop) resolves to null / original-photo, never throws, never blocks
// recognition.
//
// Run: cd mira-hub && npx vitest run src/lib/nameplate/__tests__/detect.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAutoCrop, resolveRecognitionImage, isDetectorEnabled } from "../detect";

const ORIGINAL_B64 = Buffer.from("original-photo-bytes").toString("base64");
const CROP_B64 = Buffer.from("cropped-jpeg-bytes").toString("base64");

/** A fully valid detect response, matching ask_api/nameplate_detect.py. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    reason: null,
    model: "PP-OCRv5_mobile_det",
    image: { width: 3000, height: 4000 },
    regions: [
      { poly: [[281, 1603], [598, 1603], [598, 2146], [281, 2146]], score: 0.62 },
      { poly: [[2186, 1804], [2374, 1804], [2374, 2179], [2186, 2179]], score: 0.88 },
    ],
    union_bbox: { left: 281, top: 1603, width: 2093, height: 576 },
    crop_base64: CROP_B64,
    crop_bbox: { left: 241, top: 1563, width: 2173, height: 656 },
    crop_rotation_deg: 90,
    ms: 2310,
    ...overrides,
  };
}

function mockFetchJson(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  process.env.NAMEPLATE_DETECT_ENABLED = "1";
  delete process.env.MIRA_ASK_URL;
  delete process.env.ASK_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NAMEPLATE_DETECT_ENABLED;
});

describe("feature flag", () => {
  it("disabled: no network call at all, resolves null", async () => {
    delete process.env.NAMEPLATE_DETECT_ENABLED;
    expect(isDetectorEnabled()).toBe(false);
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("'0' is off — only the literal '1' enables", async () => {
    process.env.NAMEPLATE_DETECT_ENABLED = "0";
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("service failure -> null (never throws)", () => {
  it("service reports available=false (detector down / flag off ask-side)", async () => {
    fetchSpy.mockImplementation(mockFetchJson({ available: false, reason: "disabled", regions: [], union_bbox: null }));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("non-200 response", async () => {
    fetchSpy.mockImplementation(mockFetchJson({ detail: "boom" }, 502));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("network error / timeout (fetch rejects)", async () => {
    fetchSpy.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("malformed JSON body", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });
});

describe("geometry validation -> null", () => {
  it("zero regions", async () => {
    fetchSpy.mockImplementation(mockFetchJson(validBody({ regions: [], union_bbox: null, crop_base64: null, crop_bbox: null })));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("crop bbox extends past the frame", async () => {
    fetchSpy.mockImplementation(
      mockFetchJson(validBody({ crop_bbox: { left: 2500, top: 100, width: 1000, height: 200 } })),
    );
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("negative / zero-area / non-numeric bbox", async () => {
    for (const bad of [
      { left: -5, top: 0, width: 100, height: 100 },
      { left: 0, top: 0, width: 0, height: 100 },
      { left: 0, top: 0, width: "wide", height: 100 },
      null,
    ]) {
      fetchSpy.mockImplementation(mockFetchJson(validBody({ crop_bbox: bad })));
      expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
    }
  });

  it("crop failed service-side (crop_base64 null, detections present)", async () => {
    fetchSpy.mockImplementation(mockFetchJson(validBody({ crop_base64: null, crop_bbox: null })));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });

  it("missing image dimensions", async () => {
    fetchSpy.mockImplementation(mockFetchJson(validBody({ image: null })));
    expect(await fetchAutoCrop(ORIGINAL_B64)).toBeNull();
  });
});

describe("valid detection", () => {
  it("returns the crop with full provenance", async () => {
    fetchSpy.mockImplementation(mockFetchJson(validBody()));
    const auto = await fetchAutoCrop(ORIGINAL_B64);
    expect(auto).not.toBeNull();
    expect(auto!.cropBase64).toBe(CROP_B64);
    expect(auto!.mimeType).toBe("image/jpeg");
    expect(auto!.detector).toEqual({
      model: "PP-OCRv5_mobile_det",
      regionCount: 2,
      cropBbox: { left: 241, top: 1563, width: 2173, height: 656 },
      imageWidth: 3000,
      imageHeight: 4000,
      cropRotationDeg: 90,
      ms: 2310,
    });
  });

  it("sends return_crop and the shared-secret header", async () => {
    process.env.MIRA_ASK_URL = "http://ask.test:8011/";
    process.env.ASK_API_KEY = "sekrit";
    fetchSpy.mockImplementation(mockFetchJson(validBody()));
    await fetchAutoCrop(ORIGINAL_B64);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://ask.test:8011/nameplate/detect");
    expect(init.headers["X-Mira-Key"]).toBe("sekrit");
    expect(JSON.parse(init.body)).toMatchObject({ image_base64: ORIGINAL_B64, return_crop: true });
  });
});

describe("resolveRecognitionImage — the routes' seam", () => {
  it("crop available: recognizer reads the crop, provenance says so", async () => {
    fetchSpy.mockImplementation(mockFetchJson(validBody()));
    const read = await resolveRecognitionImage(ORIGINAL_B64, "image/webp");
    expect(read.base64).toBe(CROP_B64);
    expect(read.mimeType).toBe("image/jpeg");
    expect(read.imageSource.kind).toBe("auto_detected_crop");
  });

  it("any detector failure: ORIGINAL bytes + original mime + original_photo provenance", async () => {
    fetchSpy.mockRejectedValue(new Error("connection refused"));
    const read = await resolveRecognitionImage(ORIGINAL_B64, "image/webp");
    expect(read.base64).toBe(ORIGINAL_B64);
    expect(read.mimeType).toBe("image/webp");
    expect(read.imageSource).toEqual({ kind: "original_photo" });
  });

  it("flag off: identical to today's behavior, zero network calls", async () => {
    delete process.env.NAMEPLATE_DETECT_ENABLED;
    const read = await resolveRecognitionImage(ORIGINAL_B64, "image/jpeg");
    expect(read.base64).toBe(ORIGINAL_B64);
    expect(read.imageSource).toEqual({ kind: "original_photo" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
