/**
 * capture-quality tests — fully offline, no image files.
 *
 * Every buffer here is SYNTHESIZED in code, on purpose: a test that loads a JPEG
 * is testing the decoder as much as the metric, and it cannot state what the
 * right answer is. A checkerboard's sharpness is not a matter of opinion.
 *
 * Note what these tests do NOT claim: they do not validate the THRESHOLDS (see
 * the module header — those are uncalibrated guesses). They validate the
 * *ordering* the metrics must preserve (sharp > blurred, glare > normal) and the
 * *policy* that borderline photos warn rather than block. Those two properties
 * are what the caller depends on and what a future re-calibration must not break.
 */

import { describe, it, expect } from "vitest";
import {
  assessCapture,
  clippedHighlightRatio,
  contrastRange,
  laplacianVariance,
  meanIntensity,
  rgbaToGray,
  underexposedRatio,
  DEFAULT_THRESHOLDS,
} from "../nameplate/capture-quality";

// ── Synthetic buffers ────────────────────────────────────────────────────────

/** Hard-edged checkerboard — the sharpest thing an 8-bit raster can be. */
function checkerboard(width: number, height: number, cell = 4): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      g[y * width + x] = on ? 235 : 20;
    }
  }
  return g;
}

/** Smooth horizontal ramp — full dynamic range, but no edges at all. */
function blurredGradient(width: number, height: number): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      g[y * width + x] = Math.round((x / Math.max(width - 1, 1)) * 215) + 20;
    }
  }
  return g;
}

function fill(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

/**
 * A plausible "good enough" nameplate capture: mid-grey plate with dark text
 * strokes and one small specular highlight. Deliberately unremarkable — this is
 * the borderline case that must NOT be blocked.
 */
function plausiblePlate(width = 480, height = 320): Uint8Array {
  const g = new Uint8Array(width * height).fill(170);
  const rowGap = Math.max(4, Math.floor(height / 7));
  const strokeH = Math.max(2, Math.floor(rowGap * 0.35));
  for (let row = 0; row < 5; row++) {
    const y0 = rowGap + row * rowGap;
    for (let y = y0; y < Math.min(y0 + strokeH, height); y++) {
      for (let x = 10; x < width - 10; x++) {
        // Dashed strokes so there are real edges in both directions.
        if (Math.floor(x / 3) % 2 === 0) g[y * width + x] = 35;
      }
    }
  }
  // Small specular hotspot, a few percent of the frame — normal on a real plate
  // and deliberately kept below the glare threshold.
  const hotH = Math.floor(height * 0.1);
  const hotW = Math.floor(width * 0.25);
  for (let y = 2; y < 2 + hotH; y++) for (let x = 2; x < 2 + hotW; x++) g[y * width + x] = 255;
  return g;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

describe("laplacianVariance", () => {
  it("is far higher for a sharp checkerboard than for a smooth gradient", () => {
    const w = 64;
    const h = 64;
    const sharp = laplacianVariance(checkerboard(w, h), w, h);
    const blurred = laplacianVariance(blurredGradient(w, h), w, h);
    expect(sharp).toBeGreaterThan(1000);
    expect(blurred).toBeLessThan(10);
    // Not merely "lower" — an order of magnitude, which is what makes it usable
    // as a blur signal rather than a coin flip.
    expect(sharp).toBeGreaterThan(blurred * 100);
  });

  it("is zero for a perfectly flat field", () => {
    expect(laplacianVariance(fill(32, 32, 128), 32, 32)).toBe(0);
  });

  it("returns 0 rather than throwing when there is no interior", () => {
    expect(laplacianVariance(fill(2, 2, 100), 2, 2)).toBe(0);
    expect(laplacianVariance(new Uint8Array(0), 0, 0)).toBe(0);
  });

  it("accepts a plain number[] as well as a typed array", () => {
    const w = 16;
    const h = 16;
    const arr = Array.from(checkerboard(w, h));
    expect(laplacianVariance(arr, w, h)).toBeCloseTo(
      laplacianVariance(checkerboard(w, h), w, h),
      6,
    );
  });

  it("is deterministic across repeated calls", () => {
    const g = checkerboard(40, 40);
    expect(laplacianVariance(g, 40, 40)).toBe(laplacianVariance(g, 40, 40));
  });
});

describe("clippedHighlightRatio", () => {
  it("is 1 for an all-white glare field and 0 for a dark one", () => {
    expect(clippedHighlightRatio(fill(20, 20, 255), 20, 20)).toBe(1);
    expect(clippedHighlightRatio(fill(20, 20, 40), 20, 20)).toBe(0);
  });

  it("measures a partial glare band as its area fraction", () => {
    const w = 20;
    const h = 20;
    const g = fill(w, h, 100);
    for (let y = 0; y < 5; y++) for (let x = 0; x < w; x++) g[y * w + x] = 255;
    expect(clippedHighlightRatio(g, w, h)).toBeCloseTo(0.25, 6);
  });

  it("honors a caller-supplied threshold", () => {
    expect(clippedHighlightRatio(fill(10, 10, 200), 10, 10, 250)).toBe(0);
    expect(clippedHighlightRatio(fill(10, 10, 200), 10, 10, 150)).toBe(1);
  });
});

describe("underexposedRatio", () => {
  it("is 1 for a near-black field and 0 for a bright one", () => {
    expect(underexposedRatio(fill(20, 20, 3), 20, 20)).toBe(1);
    expect(underexposedRatio(fill(20, 20, 200), 20, 20)).toBe(0);
  });
});

describe("contrastRange", () => {
  it("is ~0 for a flat field and wide for a full-range gradient", () => {
    expect(contrastRange(fill(50, 50, 128))).toBe(0);
    expect(contrastRange(blurredGradient(50, 50))).toBeGreaterThan(180);
  });

  it("ignores a handful of outlier pixels (percentile, not max-min)", () => {
    const g = fill(100, 100, 128);
    g[0] = 0;
    g[1] = 255;
    // A pure max-min would report 255 here; p99-p1 must report ~0.
    expect(contrastRange(g)).toBeLessThan(5);
  });

  it("is 0 for an empty buffer", () => {
    expect(contrastRange(new Uint8Array(0))).toBe(0);
  });
});

describe("meanIntensity / rgbaToGray", () => {
  it("means what it says", () => {
    expect(meanIntensity(fill(10, 10, 64))).toBe(64);
    expect(meanIntensity(new Uint8Array(0))).toBe(0);
  });

  it("reduces RGBA to Rec.601 luma", () => {
    const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]);
    const gray = rgbaToGray(rgba);
    expect(gray.length).toBe(2);
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBe(0);
  });
});

// ── assessCapture: issue detection ───────────────────────────────────────────

const codes = (a: ReturnType<typeof assessCapture>) => a.issues.map((i) => i.code);
const messageFor = (a: ReturnType<typeof assessCapture>, code: string) =>
  a.issues.find((i) => i.code === code)?.message ?? "";

describe("assessCapture — blur", () => {
  it("flags a uniformly blurred gradient with the steady-hands message", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: blurredGradient(w, h), width: w, height: h });
    expect(codes(a)).toContain("blurry");
    expect(messageFor(a, "blurry")).toBe("Image appears blurred. Hold the phone steady and retake it.");
    expect(a.ok).toBe(false);
  });

  it("does NOT flag a sharp checkerboard as blurred", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: checkerboard(w, h), width: w, height: h });
    expect(codes(a)).not.toContain("blurry");
    expect(a.metrics.laplacianVariance).toBeGreaterThan(DEFAULT_THRESHOLDS.blurVariance);
  });
});

describe("assessCapture — glare", () => {
  it("flags an all-white field and tells the technician to tilt or step out of the light", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: fill(w, h, 255), width: w, height: h });
    // An entirely blown frame is over the overexposed threshold, which is the
    // stronger of the two messages; either way the technician is told what to do.
    expect(codes(a).some((c) => c === "glare" || c === "overexposed")).toBe(true);
    expect(a.metrics.clippedHighlightRatio).toBe(1);
  });

  it("flags a partial glare band with the tilt-the-phone message", () => {
    const w = 400;
    const h = 300;
    const g = checkerboard(w, h);
    // ~20% of the frame blown out: over the glare threshold, under overexposed.
    for (let y = 0; y < 60; y++) for (let x = 0; x < w; x++) g[y * w + x] = 255;
    const a = assessCapture({ gray: g, width: w, height: h });
    expect(codes(a)).toContain("glare");
    expect(messageFor(a, "glare")).toBe(
      "Strong glare may be covering part of the nameplate. Tilt the phone slightly.",
    );
    expect(codes(a)).not.toContain("overexposed");
  });
});

describe("assessCapture — exposure", () => {
  it("flags a near-black underexposed field", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: fill(w, h, 5), width: w, height: h });
    expect(codes(a)).toContain("underexposed");
    expect(messageFor(a, "underexposed")).toMatch(/dark/i);
    expect(a.metrics.underexposedRatio).toBe(1);
  });

  it("flags a flat mid-grey frame as low contrast", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: fill(w, h, 128), width: w, height: h });
    expect(codes(a)).toContain("low_contrast");
    expect(a.metrics.contrastRange).toBe(0);
  });
});

describe("assessCapture — framing", () => {
  it("asks the technician to move closer when the plate is small in frame", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({
      gray: checkerboard(w, h),
      width: w,
      height: h,
      plateAreaRatio: 0.02,
    });
    expect(codes(a)).toContain("plate_too_small");
    expect(messageFor(a, "plate_too_small")).toBe("Move closer so the nameplate fills more of the frame.");
  });

  it("says nothing about framing when plateAreaRatio is unknown", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: checkerboard(w, h), width: w, height: h });
    expect(codes(a)).not.toContain("plate_too_small");
    expect(a.metrics.plateAreaRatio).toBeNull();
  });
});

// ── assessCapture: the severity policy (the part that must never regress) ────

describe("assessCapture — never hard-blocks a borderline photo", () => {
  it("warns but does not block a badly blurred full-size photo", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: blurredGradient(w, h), width: w, height: h });
    expect(a.issues.length).toBeGreaterThan(0);
    expect(a.blocked).toBe(false);
    expect(a.issues.every((i) => i.severity === "warn")).toBe(true);
  });

  it("warns but does not block an all-white glare frame", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: fill(w, h, 255), width: w, height: h });
    expect(a.blocked).toBe(false);
    expect(a.issues.every((i) => i.severity === "warn")).toBe(true);
  });

  it("warns but does not block a near-black frame", () => {
    const w = 400;
    const h = 300;
    const a = assessCapture({ gray: fill(w, h, 2), width: w, height: h });
    expect(a.blocked).toBe(false);
    expect(a.issues.every((i) => i.severity === "warn")).toBe(true);
  });

  it("passes a plausible real-world plate capture with no issues at all", () => {
    const w = 480;
    const h = 320;
    const a = assessCapture({ gray: plausiblePlate(w, h), width: w, height: h, plateAreaRatio: 0.6 });
    expect(a.issues).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.blocked).toBe(false);
  });
});

describe("assessCapture — blocks only genuinely unusable input", () => {
  it("blocks a thumbnail-sized capture", () => {
    const w = 64;
    const h = 48;
    const a = assessCapture({ gray: checkerboard(w, h), width: w, height: h });
    expect(codes(a)).toContain("too_small");
    expect(a.blocked).toBe(true);
    expect(a.issues.find((i) => i.code === "too_small")?.severity).toBe("block");
    expect(messageFor(a, "too_small")).toMatch(/64x48/);
  });

  it("blocks an empty buffer", () => {
    const a = assessCapture({ gray: new Uint8Array(0), width: 0, height: 0 });
    expect(codes(a)).toEqual(["empty"]);
    expect(a.blocked).toBe(true);
    expect(a.metrics.pixels).toBe(0);
  });

  it("blocks a buffer shorter than width*height rather than reading past the end", () => {
    const a = assessCapture({ gray: new Uint8Array(10), width: 400, height: 300 });
    expect(codes(a)).toEqual(["empty"]);
    expect(a.blocked).toBe(true);
  });

  it("does not block a small-but-usable frame just above the resolution floor", () => {
    const w = DEFAULT_THRESHOLDS.minShortEdge + 20;
    const h = w + 40;
    const a = assessCapture({ gray: checkerboard(w, h), width: w, height: h });
    expect(codes(a)).not.toContain("too_small");
    expect(a.blocked).toBe(false);
  });
});

describe("assessCapture — thresholds are overridable", () => {
  it("lets a caller re-tune without editing the module (they are uncalibrated)", () => {
    const w = 400;
    const h = 300;
    const gray = blurredGradient(w, h);
    expect(codes(assessCapture({ gray, width: w, height: h }))).toContain("blurry");
    const relaxed = assessCapture({ gray, width: w, height: h, thresholds: { blurVariance: 0 } });
    expect(codes(relaxed)).not.toContain("blurry");
  });

  it("reports metrics even when no issue fires", () => {
    const w = 480;
    const h = 320;
    const a = assessCapture({ gray: plausiblePlate(w, h), width: w, height: h });
    expect(a.metrics.width).toBe(w);
    expect(a.metrics.height).toBe(h);
    expect(a.metrics.pixels).toBe(w * h);
    expect(a.metrics.meanIntensity).toBeGreaterThan(0);
  });
});
