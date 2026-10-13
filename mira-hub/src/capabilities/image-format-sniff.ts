/**
 * Name the format of an image the LOOK route rejected, so the 415 says what
 * the phone actually sent. 2026-10-12: a Pixel gallery pick got a 415 and
 * nothing recorded which format it was. Detection only — this never widens
 * what the route accepts; the allowlist stays in the route.
 */
export type SniffedImageFormat =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "heic"
  | "heif"
  | "avif"
  | "tiff"
  | "bmp"
  | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

export function sniffImageFormat(b: Uint8Array): SniffedImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (AVIF_BRANDS.has(brand)) return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (HEIF_BRANDS.has(brand)) return "heif";
  }
  if (b.length >= 4 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return "tiff";
  if (b.length >= 4 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return "tiff";
  if (b.length >= 2 && ascii(b, 0, 2) === "BM") return "bmp";
  return "unknown";
}
