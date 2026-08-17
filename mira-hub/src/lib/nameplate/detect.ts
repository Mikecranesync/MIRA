/**
 * detect — thin, best-effort client for the mira-ask nameplate region finder
 * (`POST {MIRA_ASK_URL}/nameplate/detect`, ask_api/nameplate_detect.py).
 *
 * What it is for: the region-crop experiments proved the recognizer's 10x
 * current misread (`1.27A` -> `12A`) and its fabricated `RoHS` mark are cured
 * by WHERE the model looks, not how it is prompted — and auto-region.ts proved
 * the region can be found automatically by a text detector (union of all
 * detected boxes; benchmarks/nameplate/results/auto-round1-union.json). This
 * client fetches that union crop so the recognize routes can read the crop
 * instead of the whole frame.
 *
 * Honesty / fallback contract:
 * - Detection is an OPTIMIZATION, never a dependency. Flag off, service down,
 *   timeout, zero boxes, malformed geometry, missing crop — every one of those
 *   resolves to `null` and the caller reads the ORIGINAL photo exactly as it
 *   does today. This module never throws.
 * - The crop is used only to READ. The original photo is parked as evidence
 *   before recognition is ever attempted (recognize routes, rule 1) and the
 *   crop is never persisted.
 * - Detection is geometry, not testimony. It contributes no textual claim, is
 *   not a FactSource, and must never corroborate the recognizer's output —
 *   the crop and the reading are one observation chain, not two independent
 *   ones (see evidence.ts: corroboration requires a source OTHER than the
 *   model's self-report).
 *
 * Call pattern mirrors src/lib/manual-discovery.ts: MIRA_ASK_URL default,
 * optional X-Mira-Key, AbortSignal.timeout, any failure falls through.
 */

export interface DetectorProvenance {
  /** Detector model name, e.g. "PP-OCRv5_mobile_det". */
  model: string;
  /** Text regions found on the full frame. */
  regionCount: number;
  /** The crop rectangle actually excised, in the decoded pixel space of the
   * ORIGINAL posted bytes — enough to rebuild the exact pixels that were read. */
  cropBbox: { left: number; top: number; width: number; height: number };
  /** Full-frame dimensions the bbox is relative to. */
  imageWidth: number;
  imageHeight: number;
  /** Degrees the service rotated the crop to upright it (0/90/180/270).
   * Load-bearing for accuracy — the identical crop read sideways scored
   * 1.27A 2/3 / catalog 0/3 vs 3/3 / 3/3 uprighted (hub-path-round1 vs 2). */
  cropRotationDeg: number;
  /** Detector wall time (ms) as reported by the service. */
  ms: number | null;
}

export interface AutoCrop {
  /** JPEG bytes of the union-of-all-boxes crop, base64. */
  cropBase64: string;
  mimeType: "image/jpeg";
  detector: DetectorProvenance;
}

/** Where the pixels a recognition actually read came from. Rides on the
 * response's rawObservation so every downstream consumer can tell a
 * whole-frame reading from a detector-cropped one. */
export type RecognitionImageSource =
  | { kind: "original_photo" }
  | { kind: "auto_detected_crop"; detector: DetectorProvenance };

export interface RecognitionImage {
  base64: string;
  mimeType: string;
  imageSource: RecognitionImageSource;
}

/**
 * The one seam both recognize routes share: try the detector, read the crop if
 * it produced one, read the original otherwise. The returned object is the
 * COMPLETE decision — callers pass its base64/mimeType to the recognizer and
 * its imageSource into the response, and nothing else changes on the fallback
 * path.
 */
export async function resolveRecognitionImage(
  base64: string,
  mimeType: string,
): Promise<RecognitionImage> {
  const auto = await fetchAutoCrop(base64);
  if (!auto) return { base64, mimeType, imageSource: { kind: "original_photo" } };
  return {
    base64: auto.cropBase64,
    mimeType: auto.mimeType,
    imageSource: { kind: "auto_detected_crop", detector: auto.detector },
  };
}

const DEFAULT_ASK_URL = "http://mira-ask:8011";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Both sides of the wire share one switch: NAMEPLATE_DETECT_ENABLED gates the
 * mira-ask endpoint AND this client, so flipping a single Doppler var turns
 * the whole path on or off. Hub-side check first = no wasted round-trip while
 * the feature is dark.
 */
export function isDetectorEnabled(): boolean {
  return process.env.NAMEPLATE_DETECT_ENABLED === "1";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A bbox is usable only if it is a real, positive-area rectangle that lies
 * inside the frame the service says it measured. Malformed geometry -> null
 * crop -> whole-photo fallback; never a garbage extract. */
function saneBbox(
  raw: unknown,
  imageWidth: number,
  imageHeight: number,
): DetectorProvenance["cropBbox"] | null {
  const b = (raw ?? null) as Record<string, unknown> | null;
  if (!b) return null;
  const left = num(b.left);
  const top = num(b.top);
  const width = num(b.width);
  const height = num(b.height);
  if (left === null || top === null || width === null || height === null) return null;
  if (left < 0 || top < 0 || width <= 0 || height <= 0) return null;
  if (left + width > imageWidth || top + height > imageHeight) return null;
  return { left, top, width, height };
}

/**
 * Ask the detector for the label crop of `imageBase64`. Best-effort: resolves
 * to an AutoCrop or null, never throws, never blocks recognition on failure.
 */
export async function fetchAutoCrop(imageBase64: string): Promise<AutoCrop | null> {
  if (!isDetectorEnabled()) return null;

  const base = (process.env.MIRA_ASK_URL ?? DEFAULT_ASK_URL).replace(/\/+$/, "");
  const timeoutMs = Number(process.env.NAMEPLATE_DETECT_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  let raw: unknown;
  try {
    const resp = await fetch(`${base}/nameplate/detect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ASK_API_KEY ? { "X-Mira-Key": process.env.ASK_API_KEY } : {}),
      },
      body: JSON.stringify({ image_base64: imageBase64, return_crop: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    raw = await resp.json();
  } catch {
    // Timeout, connection refused, malformed JSON — recognition proceeds on
    // the original photo, exactly as it would with the feature off.
    return null;
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.available !== true) return null;

  const image = (body.image ?? null) as Record<string, unknown> | null;
  const imageWidth = num(image?.width);
  const imageHeight = num(image?.height);
  if (!imageWidth || !imageHeight) return null;

  const regions = Array.isArray(body.regions) ? body.regions : [];
  if (regions.length === 0) return null;

  const cropBbox = saneBbox(body.crop_bbox, imageWidth, imageHeight);
  const cropBase64 = typeof body.crop_base64 === "string" && body.crop_base64 ? body.crop_base64 : null;
  if (!cropBbox || !cropBase64) return null;

  return {
    cropBase64,
    mimeType: "image/jpeg",
    detector: {
      model: typeof body.model === "string" && body.model ? body.model : "unknown",
      regionCount: regions.length,
      cropBbox,
      imageWidth,
      imageHeight,
      cropRotationDeg: num(body.crop_rotation_deg) ?? 0,
      ms: num(body.ms),
    },
  };
}
