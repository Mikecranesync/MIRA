// Full-screen image viewer math (P2: pictures must actually reopen — and
// behave like every photo app: pinch about the pinched point, pan only when
// zoomed, double-tap toggles). Pure functions; no DOM.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/image-zoom

import { describe, it, expect } from "vitest";
import {
  clampZoom,
  pinchZoom,
  panBy,
  doubleTapZoom,
  ZOOM_MAX,
  type ZoomState,
} from "../../screens/FilePreview";

const FIT: ZoomState = { scale: 1, tx: 0, ty: 0 };
const VW = 1080;
const VH = 2400;

describe("clampZoom", () => {
  it("bounds scale to [1, ZOOM_MAX]", () => {
    expect(clampZoom({ scale: 0.2, tx: 0, ty: 0 }).scale).toBe(1);
    expect(clampZoom({ scale: 99, tx: 0, ty: 0 }).scale).toBe(ZOOM_MAX);
  });

  it("pins translation to zero at fit scale — the photo can never get lost", () => {
    const z = clampZoom({ scale: 1, tx: 500, ty: -900 });
    // toBeCloseTo: clamping to a zero-width range can yield -0, which renders
    // identically ("translate(-0px)") and behaves identically.
    expect(z.tx).toBeCloseTo(0, 10);
    expect(z.ty).toBeCloseTo(0, 10);
  });
});

describe("pinchZoom", () => {
  it("keeps the pinched point stationary (anchor invariance)", () => {
    // Image-point u renders at screen offset u*s + t from center. Pinch about
    // an arbitrary midpoint; the content under the fingers must not move.
    const start: ZoomState = { scale: 2, tx: 40, ty: -30 };
    const mid = { x: 700, y: 900 };
    const f = 1.5;
    const next = pinchZoom(start, f, mid.x, mid.y, VW, VH);

    const cm = { x: mid.x - VW / 2, y: mid.y - VH / 2 };
    // The image-point that WAS at the midpoint:
    const u = { x: (cm.x - start.tx) / start.scale, y: (cm.y - start.ty) / start.scale };
    const after = { x: u.x * next.scale + next.tx, y: u.y * next.scale + next.ty };
    expect(after.x).toBeCloseTo(cm.x, 6);
    expect(after.y).toBeCloseTo(cm.y, 6);
  });

  it("never exceeds ZOOM_MAX however hard you pinch", () => {
    let z: ZoomState = FIT;
    for (let i = 0; i < 20; i++) z = pinchZoom(z, 1.8, VW / 2, VH / 2, VW, VH);
    expect(z.scale).toBe(ZOOM_MAX);
  });
});

describe("panBy", () => {
  it("pans when zoomed", () => {
    const z = panBy({ scale: 3, tx: 0, ty: 0 }, 25, -40);
    expect(z.tx).toBe(25);
    expect(z.ty).toBe(-40);
  });

  it("clamps pan so the image cannot leave the viewport unbounded", () => {
    const z = panBy({ scale: 2, tx: 0, ty: 0 }, 99999, 99999);
    expect(z.tx).toBeLessThanOrEqual((2 - 1) * 600);
    expect(z.ty).toBeLessThanOrEqual((2 - 1) * 600);
  });
});

describe("doubleTapZoom", () => {
  it("fitted → zooms in about the tapped point", () => {
    const z = doubleTapZoom(FIT, 800, 1200, VW, VH);
    expect(z.scale).toBeGreaterThan(2);
  });

  it("zoomed → resets to fit, centered", () => {
    const z = doubleTapZoom({ scale: 4, tx: 120, ty: -60 }, 100, 100, VW, VH);
    expect(z).toEqual(FIT);
  });
});
