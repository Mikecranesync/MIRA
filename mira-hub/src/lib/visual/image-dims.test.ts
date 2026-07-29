// Run: npx vitest run src/lib/visual/image-dims.test.ts
//
// Header-only dimension parsing for the three accepted upload types. Fixtures
// are hand-built minimal headers — dims come from fixed header fields, so a
// full decodable image is not required.

import { describe, expect, it } from "vitest";
import { imageDims, jpegExifOrientation } from "./image-dims";

function pngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  buf.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(buf.buffer).setUint32(16, width);
  new DataView(buf.buffer).setUint32(20, height);
  return buf;
}

function jpegHeader(width: number, height: number): Uint8Array {
  // SOI, APP0 (minimal), SOF0 with dims.
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

function webpVp8xHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  buf.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe("imageDims", () => {
  it("parses PNG IHDR dimensions", () => {
    expect(imageDims(pngHeader(2481, 3508), "png")).toEqual({ width: 2481, height: 3508 });
  });

  it("parses JPEG SOF0 dimensions past other segments", () => {
    expect(imageDims(jpegHeader(1920, 1080), "jpeg")).toEqual({ width: 1920, height: 1080 });
  });

  it("parses WebP VP8X canvas dimensions", () => {
    expect(imageDims(webpVp8xHeader(800, 600), "webp")).toEqual({ width: 800, height: 600 });
  });

  it("rejects a PNG whose first chunk is not IHDR (garbage bytes are not dimensions)", () => {
    const bogus = pngHeader(1234, 5678);
    bogus.set([0x69, 0x64, 0x61, 0x74], 12); // not "IHDR"
    expect(imageDims(bogus, "png")).toBeNull();
  });

  it("reads EXIF orientation from a JPEG APP1 segment", () => {
    // SOI + APP1(Exif, little-endian TIFF, one IFD entry: tag 0x0112 = 6) + SOF0
    const tiff = [
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, magic, IFD @8
      0x01, 0x00, // 1 entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // orientation=6
      0x00, 0x00, 0x00, 0x00, // next IFD
    ];
    const exifBody = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const app1 = [0xff, 0xe1, (exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff, ...exifBody];
    const sof0 = [
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xd0, 0x0f, 0xc0, // 4032x3024 (h=0x0bd0, w=0x0fc0)
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ];
    const jpeg = new Uint8Array([0xff, 0xd8, ...app1, ...sof0]);
    expect(jpegExifOrientation(jpeg)).toBe(6);
    // SOF dims are pre-orientation; the caller transposes for orientation >= 5.
    expect(imageDims(jpeg, "jpeg")).toEqual({ width: 4032, height: 3024 });
  });

  it("returns null orientation when no APP1/Exif exists", () => {
    expect(jpegExifOrientation(jpegHeader(100, 100))).toBeNull();
  });

  it("returns null for truncated or zero-dimension input", () => {
    expect(imageDims(new Uint8Array(4), "png")).toBeNull();
    expect(imageDims(pngHeader(0, 100), "png")).toBeNull();
    expect(imageDims(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "jpeg")).toBeNull();
    expect(imageDims(new Uint8Array(10), "webp")).toBeNull();
  });
});
