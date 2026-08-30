// Vitest coverage for src/lib/photo-ocr.ts — the mira-ask OCR client (EVID-4).
// The single invariant: OCR is an ADDED layer. Every failure mode (flag off,
// service down, non-2xx, timeout, available:false, malformed body) resolves to
// null — never throws, never fails the upload. Quality is decided by pure
// functions the upload door and the client copy both rely on.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/photo-ocr.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ocrPhotoText,
  ocrQuality,
  ocrSourceText,
  isPhotoOcrEnabled,
  MIN_INDEXABLE_WORDS,
  WEAK_CONFIDENCE_BELOW,
} from "../photo-ocr";

const PHOTO = Buffer.from("jpeg-bytes-here");

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    reason: null,
    engine: "tesseract",
    lang: "eng",
    text: "Model GS10\nRated 1.27A\n\nSerial 49849",
    mean_confidence: 84.2,
    word_count: 6,
    image: { width: 2200, height: 1650 },
    ms: 1830,
    ...overrides,
  };
}

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  process.env.PHOTO_OCR_ENABLED = "1";
  delete process.env.MIRA_ASK_URL;
  delete process.env.ASK_API_KEY;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PHOTO_OCR_ENABLED;
});

describe("isPhotoOcrEnabled", () => {
  it("is off unless PHOTO_OCR_ENABLED is exactly '1'", () => {
    delete process.env.PHOTO_OCR_ENABLED;
    expect(isPhotoOcrEnabled()).toBe(false);
    process.env.PHOTO_OCR_ENABLED = "true";
    expect(isPhotoOcrEnabled()).toBe(false);
    process.env.PHOTO_OCR_ENABLED = "1";
    expect(isPhotoOcrEnabled()).toBe(true);
  });
});

describe("ocrPhotoText", () => {
  it("flag off → null without a round-trip", async () => {
    process.env.PHOTO_OCR_ENABLED = "0";
    expect(await ocrPhotoText(PHOTO)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the photo as base64 to {MIRA_ASK_URL}/ocr/extract with the key", async () => {
    process.env.MIRA_ASK_URL = "http://ask.local:8011/";
    process.env.ASK_API_KEY = "k";
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => okBody() });
    const r = await ocrPhotoText(PHOTO);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ask.local:8011/ocr/extract");
    expect((init.headers as Record<string, string>)["X-Mira-Key"]).toBe("k");
    expect(JSON.parse(String(init.body))).toEqual({ image_base64: PHOTO.toString("base64") });
    expect(r).toEqual({
      text: "Model GS10\nRated 1.27A\n\nSerial 49849",
      meanConfidence: 84.2,
      wordCount: 6,
      engine: "tesseract",
      ms: 1830,
    });
  });

  it("available:false (disabled / busy / engine missing) → null", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => okBody({ available: false, reason: "busy", text: "", word_count: 0 }),
    });
    expect(await ocrPhotoText(PHOTO)).toBeNull();
  });

  it("non-2xx → null, never throws", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await ocrPhotoText(PHOTO)).toBeNull();
  });

  it("network / timeout error → null, never throws", async () => {
    fetchSpy.mockRejectedValue(new Error("TimeoutError"));
    expect(await ocrPhotoText(PHOTO)).toBeNull();
  });

  it("malformed body → null", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => "not an object" });
    expect(await ocrPhotoText(PHOTO)).toBeNull();
  });

  it("null confidence survives as null (no text read ≠ perfect read)", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => okBody({ text: "", mean_confidence: null, word_count: 0 }),
    });
    expect(await ocrPhotoText(PHOTO)).toEqual({
      text: "",
      meanConfidence: null,
      wordCount: 0,
      engine: "tesseract",
      ms: 1830,
    });
  });
});

describe("ocrQuality", () => {
  it("too few words is 'none' regardless of confidence", () => {
    expect(ocrQuality({ wordCount: MIN_INDEXABLE_WORDS - 1, meanConfidence: 99 })).toBe("none");
    expect(ocrQuality({ wordCount: 0, meanConfidence: null })).toBe("none");
  });

  it("enough words at low confidence is 'weak' — indexed, but labelled", () => {
    expect(ocrQuality({ wordCount: 40, meanConfidence: WEAK_CONFIDENCE_BELOW - 1 })).toBe("weak");
  });

  it("enough words at good (or unscored) confidence is 'usable'", () => {
    expect(ocrQuality({ wordCount: MIN_INDEXABLE_WORDS, meanConfidence: WEAK_CONFIDENCE_BELOW })).toBe("usable");
    expect(ocrQuality({ wordCount: 12, meanConfidence: null })).toBe("usable");
  });
});

describe("ocrSourceText", () => {
  it("leads with a provenance line naming the photo and the confidence", () => {
    const s = ocrSourceText("harrington_plate.jpg", {
      text: "  Serial 49849\n",
      meanConfidence: 84.2,
      wordCount: 2,
      engine: "tesseract",
      ms: 1,
    });
    expect(s).toBe('Text read from photo "harrington_plate.jpg" (OCR, 84% confidence):\n\nSerial 49849\n');
  });

  it("says 'unknown' rather than inventing a confidence", () => {
    const s = ocrSourceText("x.png", { text: "a b c", meanConfidence: null, wordCount: 3, engine: "t", ms: null });
    expect(s.startsWith('Text read from photo "x.png" (OCR, unknown confidence):')).toBe(true);
  });
});
