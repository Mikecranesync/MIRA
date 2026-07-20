/**
 * Pure viewport-math tests. The whole screen<->normalized pipeline is verified
 * without a DOM: round-trip identity, letterbox fit, zoom-about-anchor, and pan.
 */

import { describe, expect, it } from "vitest";

import {
  clamp,
  clampNormalized,
  DEFAULT_VIEWPORT,
  fitRect,
  imageScreenRect,
  isInsideImage,
  normalizedToScreen,
  panBy,
  screenToNormalized,
  zoomAt,
  type Size,
  type ViewportState,
} from "./viewport";

const CONTAINER: Size = { width: 800, height: 600 };

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

describe("clamp / clampNormalized / isInsideImage", () => {
  it("clamps scalars", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it("clamps normalized points into the unit square", () => {
    expect(clampNormalized({ x: 1.4, y: -0.2 })).toEqual({ x: 1, y: 0 });
  });
  it("detects points outside the image", () => {
    expect(isInsideImage({ x: 0.5, y: 0.5 })).toBe(true);
    expect(isInsideImage({ x: 1.01, y: 0.5 })).toBe(false);
  });
});

describe("fitRect letterboxing", () => {
  it("letterboxes a wide image (pillarbox top/bottom)", () => {
    // 1600x800 image into 800x600 container -> scale 0.5 -> 800x400 centered.
    const r = fitRect(CONTAINER, { width: 1600, height: 800 });
    expect(r).toEqual({ x: 0, y: 100, width: 800, height: 400 });
  });
  it("letterboxes a tall image (pillarbox left/right)", () => {
    // 600x1200 into 800x600 -> scale 0.5 -> 300x600 centered.
    const r = fitRect(CONTAINER, { width: 600, height: 1200 });
    expect(r).toEqual({ x: 250, y: 0, width: 300, height: 600 });
  });
  it("returns a zero rect for a degenerate image", () => {
    expect(fitRect(CONTAINER, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("screen <-> normalized round-trip", () => {
  const image: Size = { width: 1600, height: 800 };
  const viewports: ViewportState[] = [
    DEFAULT_VIEWPORT,
    { scale: 3, panX: 0, panY: 0 },
    { scale: 2.5, panX: -120, panY: 60 },
    { scale: 8, panX: 40, panY: -200 },
  ];

  for (const vp of viewports) {
    it(`round-trips for vp ${JSON.stringify(vp)}`, () => {
      for (const norm of [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5, y: 0.5 },
        { x: 0.123, y: 0.789 },
      ]) {
        const screen = normalizedToScreen(norm, CONTAINER, image, vp);
        const back = screenToNormalized(screen, CONTAINER, image, vp);
        expect(close(back.x, norm.x)).toBe(true);
        expect(close(back.y, norm.y)).toBe(true);
      }
    });
  }

  it("maps the fit image corners to normalized (0,0) and (1,1) at vp default", () => {
    const fit = fitRect(CONTAINER, image);
    const tl = screenToNormalized({ x: fit.x, y: fit.y }, CONTAINER, image);
    const br = screenToNormalized(
      { x: fit.x + fit.width, y: fit.y + fit.height },
      CONTAINER,
      image,
    );
    expect(close(tl.x, 0)).toBe(true);
    expect(close(tl.y, 0)).toBe(true);
    expect(close(br.x, 1)).toBe(true);
    expect(close(br.y, 1)).toBe(true);
  });
});

describe("zoomAt keeps the anchor pinned to the same image point", () => {
  const image: Size = { width: 1600, height: 800 };

  it("the image point under the anchor is unchanged after zoom", () => {
    const anchor = { x: 300, y: 250 };
    const before = screenToNormalized(anchor, CONTAINER, image, DEFAULT_VIEWPORT);
    const vp = zoomAt(DEFAULT_VIEWPORT, 2, anchor, CONTAINER, image);
    const after = screenToNormalized(anchor, CONTAINER, image, vp);
    expect(close(after.x, before.x, 1e-9)).toBe(true);
    expect(close(after.y, before.y, 1e-9)).toBe(true);
    expect(vp.scale).toBe(2);
  });

  it("clamps scale to [min,max] and is a no-op at the ceiling", () => {
    const anchor = { x: 400, y: 300 };
    const maxed = zoomAt({ scale: 40, panX: 0, panY: 0 }, 2, anchor, CONTAINER, image);
    expect(maxed.scale).toBe(40);
    const floored = zoomAt({ scale: 1, panX: 0, panY: 0 }, 0.1, anchor, CONTAINER, image, 1, 40);
    expect(floored.scale).toBe(1);
  });
});

describe("panBy", () => {
  it("accumulates screen-pixel deltas", () => {
    const vp = panBy(panBy(DEFAULT_VIEWPORT, 10, -5), -3, 8);
    expect(vp).toEqual({ scale: 1, panX: 7, panY: 3 });
  });
  it("shifts the image rect by the pan delta", () => {
    const image: Size = { width: 800, height: 600 };
    const base = imageScreenRect(CONTAINER, image, DEFAULT_VIEWPORT);
    const panned = imageScreenRect(CONTAINER, image, panBy(DEFAULT_VIEWPORT, 25, -10));
    expect(panned.x - base.x).toBe(25);
    expect(panned.y - base.y).toBe(-10);
  });
});
