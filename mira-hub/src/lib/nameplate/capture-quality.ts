/**
 * capture-quality.ts — cheap, pure, offline checks on a nameplate photo BEFORE
 * it is uploaded, so a bad capture is retaken instead of reconstructed.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The expensive failures in nameplate recognition are not model failures, they
 * are *pixel* failures: a decimal point that occupies four blurred pixels cannot
 * be recovered by any prompt, and a glare band across the catalog row deletes
 * information that no amount of inference restores. The only cure is a second
 * photograph — and the only moment that costs nothing is while the technician is
 * still standing in front of the machine with the phone in their hand.
 *
 * So: measure the pixels on the device, and say something a technician can act
 * on ("hold steady and retake") rather than asking a model to guess.
 *
 * ── Boundaries ──────────────────────────────────────────────────────────────
 *
 * - PURE. No I/O, no image decoding, no dependencies, no globals. The caller
 *   supplies a single-channel 8-bit grayscale buffer (browser:
 *   `ctx.getImageData()` then luma-reduce; server: whatever produced the pixels).
 *   Decoding is the caller's problem precisely so this file stays runnable in a
 *   worker, a test, and a React Native bridge without change.
 * - ALLOCATION-LIGHT. Every metric is a single pass over the buffer with O(1)
 *   extra state, except the Laplacian which is O(1) too (it accumulates moments
 *   rather than building a response image). Safe to run per preview frame.
 * - DETERMINISTIC. Same bytes in, same numbers out. No sampling, no randomness.
 *
 * ── ⚠️ THE THRESHOLDS BELOW ARE UNCALIBRATED GUESSES ────────────────────────
 *
 * They are provisional starting points chosen from first principles and from a
 * handful of synthetic buffers — NOT tuned against real technician photographs,
 * because no labelled corpus of "photos that produced a wrong reading" exists
 * yet. Do not present them as tuned, and do not treat a number near a boundary
 * as meaningful. The intended path to real values is: log these metrics
 * alongside recognition outcomes on real captures, then fit the thresholds to
 * the observed accuracy curve. Until that happens, every threshold in
 * `DEFAULT_THRESHOLDS` should be read as "a plausible guess we can move".
 *
 * ── The one rule that is NOT provisional ────────────────────────────────────
 *
 * NEVER HARD-BLOCK A BORDERLINE PHOTO. The technician is standing in a plant,
 * possibly on a ladder, possibly with the only access they will get today. A
 * warning that they can override costs them three seconds; a block that is wrong
 * costs them the trip. `severity: "block"` is therefore reserved for input that
 * is genuinely unusable as an image (a thumbnail-sized buffer, an empty buffer),
 * never for "the numbers look a bit low". Everything else warns and proceeds.
 */

export type Severity = "warn" | "block";

export type CaptureIssueCode =
  | "blurry"
  | "glare"
  | "underexposed"
  | "overexposed"
  | "low_contrast"
  | "too_small"
  | "plate_too_small"
  | "empty";

export type CaptureIssue = {
  code: CaptureIssueCode;
  severity: Severity;
  /** Technician-facing. Says what is wrong AND what to do about it. */
  message: string;
};

export type CaptureMetrics = {
  width: number;
  height: number;
  pixels: number;
  /** Variance of the Laplacian response. Higher = sharper. Blur signal. */
  laplacianVariance: number;
  /** Fraction of pixels at/above the highlight threshold (glare). */
  clippedHighlightRatio: number;
  /** Fraction of pixels at/below the shadow threshold. */
  underexposedRatio: number;
  /** p99 - p1 of the intensity histogram, 0..255. Robust dynamic range. */
  contrastRange: number;
  /** Mean intensity, 0..255. */
  meanIntensity: number;
  /** Echoed from the caller when supplied; not measured here. */
  plateAreaRatio: number | null;
};

export type CaptureAssessment = {
  /** False when any issue was raised. Callers should still let the user proceed
   *  unless `blocked` is true — `ok` is "worth a second look", not "refuse". */
  ok: boolean;
  /** True only when an issue has severity "block". */
  blocked: boolean;
  issues: CaptureIssue[];
  metrics: CaptureMetrics;
};

export type Gray = Uint8Array | Uint8ClampedArray | number[];

export type CaptureInput = {
  gray: Gray;
  width: number;
  height: number;
  /**
   * Optional: fraction of the frame occupied by the nameplate, 0..1, if the
   * caller has a detector or a framing rectangle. Omit when unknown — an absent
   * value produces no issue rather than a guessed one.
   */
  plateAreaRatio?: number;
  thresholds?: Partial<CaptureThresholds>;
};

export type CaptureThresholds = {
  /** Below this Laplacian variance the image reads as blurred. */
  blurVariance: number;
  /** Intensity at/above which a pixel counts as a clipped highlight. */
  highlightLevel: number;
  /** Fraction of clipped highlights that indicates glare. */
  glareRatio: number;
  /** Intensity at/below which a pixel counts as crushed shadow. */
  shadowLevel: number;
  /** Fraction of crushed shadows that indicates underexposure. */
  underexposedRatio: number;
  /** Fraction of clipped highlights that indicates a blown-out frame. */
  overexposedRatio: number;
  /** Below this p99-p1 spread the frame is too flat to read reliably. */
  contrastRange: number;
  /** Below this plateAreaRatio the plate is too small in frame (when known). */
  plateAreaRatio: number;
  /** Fewer pixels on the short edge than this and the capture is unusable. */
  minShortEdge: number;
};

/**
 * ⚠️ PROVISIONAL. See the header: these are first-principles guesses, not fitted
 * values. Each carries the reasoning that produced it so a future calibration
 * knows what it is overturning.
 */
export const DEFAULT_THRESHOLDS: CaptureThresholds = {
  // Laplacian variance on 8-bit data spans roughly 0 (flat) to several thousand
  // (crisp text edges). 100 is the value most commonly cited for "blurry" in the
  // OpenCV-era literature; it is a starting point, and it is scene-dependent —
  // a plate that is mostly flat metal will score lower than one that is mostly
  // text at identical sharpness. Expect to move this.
  blurVariance: 100,
  highlightLevel: 250,
  // A specular highlight on a plastic/metal plate is normal; a glare BAND that
  // eats a row of text is not. 8% of the frame is a guess at where "a hotspot"
  // becomes "covering something".
  glareRatio: 0.08,
  shadowLevel: 12,
  underexposedRatio: 0.5,
  overexposedRatio: 0.35,
  // p99-p1 below 40 on 8-bit means the whole frame lives in a sixth of the
  // available range — printed text against its background should beat that
  // easily, even on a dusty plate.
  contrastRange: 40,
  // If the plate is under 10% of the frame, character strokes are approaching
  // the few-pixel width where a decimal point stops surviving JPEG.
  plateAreaRatio: 0.1,
  // 240px short edge is far below anything a phone produces; reaching it means
  // a thumbnail or a broken pipeline, which is the one genuinely unusable case.
  minShortEdge: 240,
};

// ── Metrics ──────────────────────────────────────────────────────────────────

function at(gray: Gray, i: number): number {
  const v = gray[i];
  return v === undefined ? 0 : v;
}

/**
 * Variance of the 4-neighbour Laplacian — the standard cheap blur signal.
 *
 * Sharp edges produce large-magnitude responses and therefore a large variance;
 * a blurred image has small responses everywhere and a small variance. Border
 * pixels are skipped (no full neighbourhood) rather than clamped, so the value
 * is not inflated by edge artifacts.
 *
 * Single pass, O(1) memory: accumulates sum and sum-of-squares instead of
 * materializing a response image.
 *
 * Returns 0 for buffers too small to have an interior.
 */
export function laplacianVariance(gray: Gray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const r =
        4 * at(gray, i) -
        at(gray, i - 1) -
        at(gray, i + 1) -
        at(gray, i - width) -
        at(gray, i + width);
      sum += r;
      sumSq += r * r;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  // Floating-point cancellation can push a perfectly flat image very slightly
  // negative; a variance is never negative.
  return variance > 0 ? variance : 0;
}

/**
 * Fraction of pixels at or above `threshold` — the glare / blown-highlight
 * signal. A nameplate under a work light routinely has a specular hotspot; what
 * matters is how much of the frame it covers.
 */
export function clippedHighlightRatio(
  gray: Gray,
  width: number,
  height: number,
  threshold: number = DEFAULT_THRESHOLDS.highlightLevel,
): number {
  const n = width * height;
  if (n <= 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) if (at(gray, i) >= threshold) hits++;
  return hits / n;
}

/** Fraction of pixels at or below `threshold` — crushed shadows / underexposure. */
export function underexposedRatio(
  gray: Gray,
  width: number,
  height: number,
  threshold: number = DEFAULT_THRESHOLDS.shadowLevel,
): number {
  const n = width * height;
  if (n <= 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) if (at(gray, i) <= threshold) hits++;
  return hits / n;
}

/**
 * Robust dynamic range: p99 - p1 of the intensity histogram.
 *
 * Deliberately NOT max-min: a single hot pixel or one dead pixel would report a
 * full 255 range on an otherwise flat, unreadable frame. Percentiles come from a
 * 256-bin histogram, so this is one pass and one fixed 256-entry array.
 */
export function contrastRange(gray: Gray): number {
  const n = gray.length;
  if (n === 0) return 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = at(gray, i);
    hist[v < 0 ? 0 : v > 255 ? 255 : v | 0]++;
  }
  const lowTarget = n * 0.01;
  const highTarget = n * 0.99;
  let cum = 0;
  let p1 = 0;
  let p99 = 255;
  let gotLow = false;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (!gotLow && cum >= lowTarget) {
      p1 = v;
      gotLow = true;
    }
    if (cum >= highTarget) {
      p99 = v;
      break;
    }
  }
  return p99 - p1;
}

/** Mean intensity, 0..255. */
export function meanIntensity(gray: Gray): number {
  const n = gray.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += at(gray, i);
  return sum / n;
}

/**
 * Reduce RGBA canvas data to a single grayscale channel (Rec. 601 luma).
 *
 * Convenience for the browser caller so every surface computes luma the same
 * way — two callers using different weights would make the thresholds above
 * mean two different things.
 */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray | number[]): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = (0.299 * at(rgba, j) + 0.587 * at(rgba, j + 1) + 0.114 * at(rgba, j + 2)) | 0;
  }
  return out;
}

// ── Assessment ───────────────────────────────────────────────────────────────

/**
 * Run every cheap check and return technician-facing issues.
 *
 * Severity policy (see header): "block" ONLY for input that is not a usable
 * photograph at all — an empty buffer, a size/buffer mismatch, or a frame far
 * below any phone's output. Blur, glare, exposure and framing always "warn",
 * however bad they look, because the technician is the one who can see the
 * machine and we are not.
 */
export function assessCapture(input: CaptureInput): CaptureAssessment {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const { gray, width, height } = input;
  const issues: CaptureIssue[] = [];

  const expected = width * height;
  const usable = width > 0 && height > 0 && gray.length >= expected;

  const metrics: CaptureMetrics = {
    width,
    height,
    pixels: expected > 0 ? expected : 0,
    laplacianVariance: usable ? laplacianVariance(gray, width, height) : 0,
    clippedHighlightRatio: usable ? clippedHighlightRatio(gray, width, height, t.highlightLevel) : 0,
    underexposedRatio: usable ? underexposedRatio(gray, width, height, t.shadowLevel) : 0,
    contrastRange: usable ? contrastRange(gray) : 0,
    meanIntensity: usable ? meanIntensity(gray) : 0,
    plateAreaRatio: typeof input.plateAreaRatio === "number" ? input.plateAreaRatio : null,
  };

  if (!usable) {
    // Not a photo. This is the one place a hard stop is honest: there is nothing
    // to send and nothing to warn about.
    issues.push({
      code: "empty",
      severity: "block",
      message: "No image data was captured. Take the photo again.",
    });
    return { ok: false, blocked: true, issues, metrics };
  }

  const shortEdge = Math.min(width, height);
  if (shortEdge < t.minShortEdge) {
    issues.push({
      code: "too_small",
      severity: "block",
      message: `This image is only ${width}x${height} pixels — too small to read a nameplate. Take the photo again with the camera at full resolution.`,
    });
  }

  if (metrics.laplacianVariance < t.blurVariance) {
    issues.push({
      code: "blurry",
      severity: "warn",
      message: "Image appears blurred. Hold the phone steady and retake it.",
    });
  }

  if (metrics.clippedHighlightRatio >= t.overexposedRatio) {
    issues.push({
      code: "overexposed",
      severity: "warn",
      message:
        "The photo is washed out — most of the frame is pure white. Move out of the direct light or retake it without the flash.",
    });
  } else if (metrics.clippedHighlightRatio >= t.glareRatio) {
    issues.push({
      code: "glare",
      severity: "warn",
      message: "Strong glare may be covering part of the nameplate. Tilt the phone slightly.",
    });
  }

  if (metrics.underexposedRatio >= t.underexposedRatio) {
    issues.push({
      code: "underexposed",
      severity: "warn",
      message: "The nameplate looks very dark. Add light or move closer, then retake it.",
    });
  }

  if (metrics.contrastRange < t.contrastRange) {
    issues.push({
      code: "low_contrast",
      severity: "warn",
      message: "The text has very little contrast against the plate. Change the angle or add light, then retake it.",
    });
  }

  if (metrics.plateAreaRatio !== null && metrics.plateAreaRatio < t.plateAreaRatio) {
    issues.push({
      code: "plate_too_small",
      severity: "warn",
      message: "Move closer so the nameplate fills more of the frame.",
    });
  }

  return {
    ok: issues.length === 0,
    blocked: issues.some((i) => i.severity === "block"),
    issues,
    metrics,
  };
}
