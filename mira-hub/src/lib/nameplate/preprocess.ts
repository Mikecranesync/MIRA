/** Header introspection plus opt-in bounded inspection working views.
 * Pixel preprocessing ports printsense/preprocess.py: 1000px OSD probe,
 * confidence >=1.0, correction rotation, 2576px long edge and JPEG95.
 * Originals are never modified. Nameplate callers retain header-only behavior.
 */
import { spawn } from "node:child_process";
import sharp from "sharp";

export type ImageInfo = {
  format: "jpeg" | "png" | "unknown";
  width: number | null;
  height: number | null;
  /** EXIF orientation 1..8, or null when absent/unparseable. */
  exifOrientation: number | null;
  megapixels: number | null;
  bytes: number;
};

/** Clockwise rotation (degrees) that would upright the pixels for a given EXIF tag. */
export function rotationDegreesFor(orientation: number | null | undefined): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

function u16(b: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
}

function u32(b: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian
    ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
    : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

/** Parse EXIF orientation (IFD0 tag 0x0112) out of a JPEG APP1 segment. */
function exifOrientationFromApp1(b: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0"
  if (end - start < 14) return null;
  if (!(b[start] === 0x45 && b[start + 1] === 0x78 && b[start + 2] === 0x69 && b[start + 3] === 0x66)) {
    return null;
  }
  const tiff = start + 6;
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const be = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
  if (!le && !be) return null;
  if (u16(b, tiff + 2, le) !== 0x002a) return null;
  const ifd0 = tiff + u32(b, tiff + 4, le);
  if (ifd0 + 2 > end) return null;
  const count = u16(b, ifd0, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(b, entry, le) === 0x0112) {
      return u16(b, entry + 8, le);
    }
  }
  return null;
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Header-only image inspection. Never decodes pixels, so it is O(header) and
 * safe to run on an 8 MB camera photo inside a request.
 */
export function inspectImage(input: Uint8Array | ArrayBuffer): ImageInfo {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const base: ImageInfo = {
    format: "unknown",
    width: null,
    height: null,
    exifOrientation: null,
    megapixels: null,
    bytes: b.length,
  };

  // PNG: 8-byte signature, then IHDR at 16 (width) / 20 (height), big-endian.
  if (
    b.length > 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  ) {
    const width = u32(b, 16, false);
    const height = u32(b, 20, false);
    return {
      ...base,
      format: "png",
      width,
      height,
      megapixels: round2((width * height) / 1e6),
    };
  }

  // JPEG: SOI then a marker chain.
  if (!(b.length > 4 && b[0] === 0xff && b[1] === 0xd8)) return base;

  let orientation: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = u16(b, i + 2, false);
    if (len < 2) break;
    const segStart = i + 4;
    const segEnd = Math.min(i + 2 + len, b.length);
    if (marker === 0xe1 && orientation === null) {
      orientation = exifOrientationFromApp1(b, segStart, segEnd);
    } else if (SOF_MARKERS.has(marker) && width === null && segEnd - segStart >= 5) {
      height = u16(b, segStart + 1, false);
      width = u16(b, segStart + 3, false);
    }
    if (orientation !== null && width !== null) break;
    i = segEnd;
  }

  return {
    ...base,
    format: "jpeg",
    width,
    height,
    exifOrientation: orientation,
    megapixels: width && height ? round2((width * height) / 1e6) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A one-line, model-facing hint about how the photo is laid out. Returns null
 * when there is nothing worth saying — an empty hint is better than a
 * confidently wrong one, since the model will act on whatever we assert.
 */
export function orientationHint(info: ImageInfo): string | null {
  const parts: string[] = [];
  const rot = rotationDegreesFor(info.exifOrientation);
  if (rot !== 0) {
    parts.push(
      `This photo carries EXIF orientation ${info.exifOrientation}; the pixels as sent are rotated and the text may run ${rot === 180 ? "upside-down" : `${rot}° from horizontal`}.`,
    );
  }
  if (info.width && info.height) {
    const portrait = info.height > info.width;
    parts.push(
      `The image is ${info.width}x${info.height} (${portrait ? "portrait" : "landscape"}).`,
    );
  }
  if (!parts.length) return null;
  return parts.join(" ");
}


export type OrientationReading = { rotation: number; confidence: number };
export type InspectionPreprocessing = {
  originalWidth: number; originalHeight: number; width: number; height: number;
  rotationDegrees: number; osdRotation: number | null; osdConfidence: number | null;
  osdStatus: "accepted" | "low_confidence" | "unavailable";
};

/** Fixed command/args, bounded stdin/stdout/stderr/runtime; never a shell. */
export function readInspectionOrientation(probe: Buffer): Promise<OrientationReading> {
  if (probe.length > 4 * 1024 * 1024) return Promise.reject(new Error("osd_probe_too_large"));
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", ["stdin", "stdout", "--psm", "0", "-l", "osd"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
    let output = "";
    let diagnostic = "";
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); return; }
      const rotation = Number(output.match(/^Rotate:\s*(\d+)\s*$/m)?.[1]);
      const confidence = Number(output.match(/^Orientation confidence:\s*([\d.]+)\s*$/m)?.[1]);
      if (![0, 90, 180, 270].includes(rotation) || !Number.isFinite(confidence)) {
        reject(new Error("osd_invalid_output"));
      } else resolve({ rotation, confidence });
    };
    const timer = setTimeout(() => finish(new Error("osd_timeout")), 5000);
    child.on("error", () => finish(new Error("osd_unavailable")));
    child.stdin.on("error", () => finish(new Error("osd_input_error")));
    const consume = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024) { finish(new Error("osd_output_too_large")); return; }
      if (stdout) output += chunk.toString("utf8");
      else diagnostic += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, false));
    child.on("close", (code) => {
      if (code !== 0 && /Too few characters/i.test(diagnostic)) {
        // Valid hardware photos may have too little text for OSD: no rotation.
        output = "Rotate: 0\nOrientation confidence: 0\n";
        finish();
      } else finish(code === 0 ? undefined : new Error("osd_failed"));
    });
    child.stdin.end(probe);
  });
}

/** PrintSense image semantics; explicit opt-in requires a working OSD runtime. */
export async function prepareInspectionImage(
  input: Buffer,
  readOrientation: (probe: Buffer) => Promise<OrientationReading> = readInspectionOrientation,
): Promise<{ buffer: Buffer; mimeType: "image/jpeg"; metadata: InspectionPreprocessing }> {
  if (input.length > 8 * 1024 * 1024) throw new Error("inspection_image_too_large");
  const options = { limitInputPixels: 20_000_000, failOn: "error" as const, animated: false };
  const image = sharp(input, options);
  const header = await image.metadata();
  if (!header.width || !header.height || header.width * header.height > 20_000_000) {
    throw new Error("inspection_image_pixels_exceeded");
  }
  // OSD scores depend on the probe filter. Linear sampling passed the private
  // schematic rotation controls where lanczos3 fell below the confidence gate.
  // Keep full-resolution rendering below independent of this probe filter.
  const probe = await image.clone().resize({ width: 1000, height: 1000, fit: "inside", kernel: "linear", withoutEnlargement: true, fastShrinkOnLoad: false }).png().toBuffer();
  const reading = await readOrientation(probe);
  const valid = reading && [0, 90, 180, 270].includes(reading.rotation) && Number.isFinite(reading.confidence);
  const accepted = Boolean(valid && reading!.confidence >= 1.0);
  // Tesseract returns the clockwise correction; sharp rotates clockwise.
  // Python's PIL equivalent is rotate(-reading.rotation).
  const rotationDegrees = accepted ? reading!.rotation : 0;
  const { data, info } = await image.clone().rotate(rotationDegrees)
    .resize({ width: 2576, height: 2576, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
  return { buffer: data, mimeType: "image/jpeg", metadata: {
    originalWidth: header.width, originalHeight: header.height, width: info.width, height: info.height,
    rotationDegrees, osdRotation: valid ? reading!.rotation : null, osdConfidence: valid ? reading!.confidence : null,
    osdStatus: accepted ? "accepted" : valid ? "low_confidence" : "unavailable",
  } };
}
