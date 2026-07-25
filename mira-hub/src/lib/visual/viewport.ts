/**
 * Pure viewport math for the shared visual workspace (PR V1).
 *
 * This is the library-independent core behind §9's `ViewportAdapter`: it maps
 * screen pixels <-> normalized-original coordinates for a raster image that is
 * letterboxed ("fit") into a container and then zoomed/panned by the user. No
 * React, no Canvas, no DOM — every function is pure so the whole coordinate
 * pipeline is unit-testable under vitest's `node` environment.
 *
 * Normalized-original coordinates are the frozen contract space
 * (`factorylm.visual-region.v1`, PRD §6): `(0,0)` is the image's top-left,
 * `(1,1)` its bottom-right, independent of device size, zoom, or pan.
 *
 * V1 supports fit + zoom + pan. Rotation (part of the full `ViewportAdapter`
 * interface) is intentionally deferred to a later PR — PRD §20 V1 scope is
 * "raster image viewer; Point, Box, Highlight, Pan".
 */

export interface Size {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * User zoom/pan on top of the base fit transform. `scale` multiplies the fit
 * (1 = fit-to-container); `panX/panY` are additional screen-pixel offsets.
 */
export interface ViewportState {
  scale: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWPORT: ViewportState = { scale: 1, panX: 0, panY: 0 };

/** Clamp `n` into `[lo, hi]`. */
export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** True only for a finite number strictly greater than zero (guards NaN/∞). */
function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** Clamp a normalized point into the unit square `[0,1] x [0,1]`. */
export function clampNormalized(p: NormalizedPoint): NormalizedPoint {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

/** True if the normalized point lies within the original image bounds. */
export function isInsideImage(p: NormalizedPoint): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/**
 * The base letterbox rect (in screen px) where the image is drawn when zoom=1,
 * pan=0 — the largest aspect-preserving fit centered in the container.
 */
export function fitRect(
  container: Size,
  image: Size,
): { x: number; y: number; width: number; height: number } {
  // Degenerate OR non-finite dimensions (NaN/Infinity from a bad image-size
  // prop) collapse to a zero rect, so screenToNormalized returns {0,0} rather
  // than propagating NaN into a geometry that would throw on canonicalization.
  if (
    !isPositiveFinite(image.width) ||
    !isPositiveFinite(image.height) ||
    !isPositiveFinite(container.width) ||
    !isPositiveFinite(container.height)
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * The image's on-screen rect after applying the viewport (fit * scale, then
 * pan). Zoom is anchored at the container center before pan is added.
 */
export function imageScreenRect(
  container: Size,
  image: Size,
  vp: ViewportState,
): { x: number; y: number; width: number; height: number } {
  const fit = fitRect(container, image);
  const width = fit.width * vp.scale;
  const height = fit.height * vp.scale;
  // Keep the fit's center fixed under scale, then apply pan.
  const cx = fit.x + fit.width / 2;
  const cy = fit.y + fit.height / 2;
  return {
    x: cx - width / 2 + vp.panX,
    y: cy - height / 2 + vp.panY,
    width,
    height,
  };
}

/** Screen pixel -> normalized-original coordinate (may fall outside `[0,1]`). */
export function screenToNormalized(
  screen: ScreenPoint,
  container: Size,
  image: Size,
  vp: ViewportState = DEFAULT_VIEWPORT,
): NormalizedPoint {
  const rect = imageScreenRect(container, image, vp);
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: (screen.x - rect.x) / rect.width,
    y: (screen.y - rect.y) / rect.height,
  };
}

/** Normalized-original coordinate -> screen pixel. */
export function normalizedToScreen(
  norm: NormalizedPoint,
  container: Size,
  image: Size,
  vp: ViewportState = DEFAULT_VIEWPORT,
): ScreenPoint {
  const rect = imageScreenRect(container, image, vp);
  return {
    x: rect.x + norm.x * rect.width,
    y: rect.y + norm.y * rect.height,
  };
}

/**
 * Zoom by `factor` while keeping the screen point `anchor` pinned to the same
 * image location. Returns the new viewport; `scale` is clamped to `[min, max]`.
 */
export function zoomAt(
  vp: ViewportState,
  factor: number,
  anchor: ScreenPoint,
  container: Size,
  image: Size,
  min = 1,
  max = 40,
): ViewportState {
  const nextScale = clamp(vp.scale * factor, min, max);
  if (nextScale === vp.scale) return vp;
  // The image point under the anchor must stay under the anchor after zoom.
  const before = screenToNormalized(anchor, container, image, vp);
  const zoomed: ViewportState = { ...vp, scale: nextScale };
  const after = normalizedToScreen(before, container, image, zoomed);
  return {
    scale: nextScale,
    panX: vp.panX + (anchor.x - after.x),
    panY: vp.panY + (anchor.y - after.y),
  };
}

/** Pan by a screen-pixel delta. */
export function panBy(vp: ViewportState, dx: number, dy: number): ViewportState {
  return { ...vp, panX: vp.panX + dx, panY: vp.panY + dy };
}
