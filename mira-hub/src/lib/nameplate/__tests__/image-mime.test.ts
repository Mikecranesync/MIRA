// The bytes-decide MIME gate (EVID-2). Pure functions, no mocks.
//
// Run: cd mira-hub && npx vitest run src/lib/nameplate/__tests__/image-mime

import { describe, it, expect } from "vitest";
import { sniffImageMime, effectiveImageMime } from "../image-mime";

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from("GIF89a\x00\x00", "latin1");
const WEBP = Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1");
const TEXT = Buffer.from("#!/bin/sh\necho no", "utf8");

describe("sniffImageMime", () => {
  it("recognizes the four safelisted raster formats", () => {
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("returns null for non-image bytes, empty buffers, and truncated magic", () => {
    expect(sniffImageMime(TEXT)).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull(); // 2 of 3 JPEG bytes
    // RIFF container that is NOT WebP (a .wav) must not pass.
    expect(sniffImageMime(Buffer.from("RIFF\x00\x00\x00\x00WAVE", "latin1"))).toBeNull();
  });
});

describe("effectiveImageMime", () => {
  it("keeps an allowed declared type without consulting the bytes", () => {
    expect(effectiveImageMime("image/png", TEXT, ALLOWED)).toBe("image/png");
  });

  it("normalizes case and parameters on the declared type", () => {
    expect(effectiveImageMime("IMAGE/JPEG; charset=binary", TEXT, ALLOWED)).toBe("image/jpeg");
  });

  it("falls back to the sniffed type when the declared one is a picker lie", () => {
    expect(effectiveImageMime("application/octet-stream", JPEG, ALLOWED)).toBe("image/jpeg");
    expect(effectiveImageMime("", PNG, ALLOWED)).toBe("image/png");
  });

  it("rejects when neither declared nor sniffed passes — the safelist never widens", () => {
    expect(effectiveImageMime("application/octet-stream", TEXT, ALLOWED)).toBeNull();
    // Scriptable SVG stays out even when declared as such.
    expect(effectiveImageMime("image/svg+xml", TEXT, ALLOWED)).toBeNull();
  });
});
