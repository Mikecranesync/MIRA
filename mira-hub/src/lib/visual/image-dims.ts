// mira-hub/src/lib/visual/image-dims.ts
//
// Minimal header-only image dimension parsing (PNG / JPEG / WebP). The Visual
// Workspace normalizes all geometry to the ORIGINAL image's natural pixel size
// (factorylm.visual-region.v1, coordinate_space "normalized_original") — the
// server must derive that reference itself at upload time and never trust
// client-supplied dimensions. mira-hub deliberately has no image dependency
// (frozen lockfile), so this parses just the fixed headers.
//
// Returns null for anything it cannot parse confidently — callers reject the
// upload rather than guessing.

export interface ImageDims {
  width: number;
  height: number;
}

function u32be(buf: Uint8Array, off: number): number {
  return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}

function u16be(buf: Uint8Array, off: number): number {
  return (buf[off] << 8) | buf[off + 1];
}

function u16le(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

function u24le(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
}

/** PNG: IHDR is always the first chunk — width/height at bytes 16..23 (big-endian u32). */
function pngDims(buf: Uint8Array): ImageDims | null {
  if (buf.length < 24) return null;
  // Verify the first chunk really is IHDR before trusting the dim bytes —
  // a truncated/garbage file must reject, not report noise as dimensions.
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) {
    return null;
  }
  const width = u32be(buf, 16) >>> 0;
  const height = u32be(buf, 20) >>> 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * JPEG EXIF Orientation (tag 0x0112) from the APP1 "Exif" segment, or null.
 * Orientations 5–8 mean the decoded raster is TRANSPOSED relative to the SOF
 * frame dimensions — browsers render the oriented bitmap by default
 * (image-orientation: from-image), so the normalization reference must match.
 */
export function jpegExifOrientation(buf: Uint8Array): number | null {
  let off = 2;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    const segLen = u16be(buf, off + 2);
    if (segLen < 2) return null;
    if (marker === 0xda) return null; // start of scan — no EXIF ahead
    if (marker === 0xe1 && off + 4 + 6 <= buf.length) {
      const p = off + 4;
      // "Exif\0\0"
      if (
        buf[p] === 0x45 && buf[p + 1] === 0x78 && buf[p + 2] === 0x69 &&
        buf[p + 3] === 0x66 && buf[p + 4] === 0x00 && buf[p + 5] === 0x00
      ) {
        const tiff = p + 6;
        if (tiff + 8 > buf.length) return null;
        const little = buf[tiff] === 0x49 && buf[tiff + 1] === 0x49;
        const big = buf[tiff] === 0x4d && buf[tiff + 1] === 0x4d;
        if (!little && !big) return null;
        const rd16 = (o: number) => (little ? u16le(buf, o) : u16be(buf, o));
        const rd32 = (o: number) =>
          little
            ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
            : u32be(buf, o) >>> 0;
        const ifdOff = tiff + rd32(tiff + 4);
        if (ifdOff + 2 > buf.length) return null;
        const count = rd16(ifdOff);
        for (let i = 0; i < count; i++) {
          const entry = ifdOff + 2 + i * 12;
          if (entry + 12 > buf.length) return null;
          if (rd16(entry) === 0x0112) {
            const value = rd16(entry + 8);
            return value >= 1 && value <= 8 ? value : null;
          }
        }
        return null;
      }
    }
    off += 2 + segLen;
  }
  return null;
}

/** JPEG: walk markers to the first SOFn (C0–CF except C4/C8/CC); height at +5, width at +7. */
function jpegDims(buf: Uint8Array): ImageDims | null {
  let off = 2; // past FFD8
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off += 1; // fill bytes / resync
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    // Standalone markers without a length segment.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    const segLen = u16be(buf, off + 2);
    if (segLen < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (off + 9 > buf.length) return null;
      const height = u16be(buf, off + 5);
      const width = u16be(buf, off + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    off += 2 + segLen;
  }
  return null;
}

/** WebP: RIFF container — VP8 (lossy), VP8L (lossless), or VP8X (extended). */
function webpDims(buf: Uint8Array): ImageDims | null {
  if (buf.length < 30) return null;
  const fourcc = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  if (fourcc === "VP8X") {
    // Canvas size: 24-bit LE minus-one fields at offsets 24 and 27.
    const width = u24le(buf, 24) + 1;
    const height = u24le(buf, 27) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (fourcc === "VP8 ") {
    // Lossy bitstream: sync code 9D 01 2A at offset 23, then 14-bit LE dims.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = u16le(buf, 26) & 0x3fff;
    const height = u16le(buf, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (fourcc === "VP8L") {
    // Lossless: signature 0x2F at offset 20, then 14+14 bit minus-one dims.
    if (buf[20] !== 0x2f) return null;
    const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/**
 * Parse natural pixel dimensions from an image buffer, keyed by the
 * magic-byte-sniffed kind (see src/lib/sniff-mime.ts — never the client MIME).
 */
export function imageDims(buf: Uint8Array, kind: "png" | "jpeg" | "webp"): ImageDims | null {
  switch (kind) {
    case "png":
      return pngDims(buf);
    case "jpeg":
      return jpegDims(buf);
    case "webp":
      return webpDims(buf);
    default:
      return null;
  }
}
