// mira-hub/src/lib/sniff-mime.ts
//
// Magic-byte file sniffing. Client-supplied `mimeType` (cloud path) and
// browser-supplied `File.type` (local path) are both controllable — a
// malicious client can set "application/pdf" with an executable payload.
// Defense in depth: read the first ~16 bytes and reject anything that
// doesn't match a known signature.
//
// References:
//   PDF       %PDF-     25 50 44 46 2D
//   JPEG      JFIF/EXIF FF D8 FF
//   PNG                 89 50 4E 47 0D 0A 1A 0A
//   WebP      RIFF…WEBP 52 49 46 46 _ _ _ _ 57 45 42 50  (offset 0,8)
//   HEIC/HEIF ftyp box  ?? ?? ?? ?? 66 74 79 70           (offset 4)

export type SniffedKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | null;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const FTYP = [0x66, 0x74, 0x79, 0x70];
// HEIC/HEIF brand codes that follow `ftyp` — there are several.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "heif", "mif1", "msf1"]);

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Sniff the first ~16 bytes of `buf` and return the detected file kind, or
 * null if no known signature matches.
 */
export function sniffMime(buf: Uint8Array): SniffedKind {
  if (startsWith(buf, PDF)) return "pdf";
  if (startsWith(buf, JPEG)) return "jpeg";
  if (startsWith(buf, PNG)) return "png";
  if (startsWith(buf, RIFF) && startsWith(buf, WEBP, 8)) return "webp";
  // HEIC/HEIF: ftyp box at byte 4, brand at byte 8 (4 ASCII chars)
  if (startsWith(buf, FTYP, 4) && buf.length >= 12) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  return null;
}

/**
 * Return true if the sniffed kind is compatible with the declared MIME.
 *
 * "Compatible" means the MIME's general category matches: PDFs go to PDF,
 * any image MIME accepts any sniffed image format. We intentionally don't
 * require an exact match (e.g. someone uploads a JPEG with the wrong
 * extension labeled as image/png) — that's a UX nuisance, not a security
 * concern, since both end up in the same image-processing pipeline.
 */
export function isMimeCompatible(declared: string, sniffed: SniffedKind): boolean {
  if (sniffed === null) return false;
  if (sniffed === "pdf") return declared === "application/pdf";
  // Any non-pdf sniff is an image; reject if declared isn't an image MIME.
  return declared.startsWith("image/");
}
