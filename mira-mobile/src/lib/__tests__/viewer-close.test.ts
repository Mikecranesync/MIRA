// #3427: the fullscreen viewer's Close button must respond to real-world taps.
//
// Device evidence (Pixel 9a, 2026-08-26): synthetic click never fired on the
// ✕ while zoomed; a Chromium touch harness proved click synthesis dies when a
// tap's micro-movement exceeds the browser slop (~20px), while pointerup still
// reaches the button. So close is decided on the button's own pointerup with
// our OWN slop guard (isCloseTap), and the open viewer registers in the
// hardware-back chain so BACK closes viewer-then-sheet in order.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/viewer-close

import { describe, it, expect, beforeEach } from "vitest";
import {
  isCloseTap,
  CLOSE_TAP_SLOP,
  registerViewerBack,
  closeTopViewer,
  _resetViewerBackForTest,
} from "../../screens/FilePreview";

describe("isCloseTap", () => {
  it("accepts a perfectly still tap", () => {
    expect(isCloseTap(100, 100, 100, 100)).toBe(true);
  });

  it("accepts jitter beyond the browser's click slop — the bug this fixes", () => {
    // 20px of movement killed the synthesized click in the Chromium harness;
    // pointerup still targeted the button, so this must still close.
    expect(isCloseTap(100, 100, 120, 100)).toBe(true);
  });

  it("rejects a drag that merely ends over the button", () => {
    const far = CLOSE_TAP_SLOP + 1;
    expect(isCloseTap(100, 100, 100 + far, 100)).toBe(false);
    expect(isCloseTap(100, 100, 100, 100 + far)).toBe(false);
  });

  it("uses euclidean distance, not per-axis boxes", () => {
    const d = CLOSE_TAP_SLOP * 0.75;
    // each axis under the slop but the diagonal beyond it
    expect(isCloseTap(0, 0, d, d)).toBe(false);
  });
});

describe("viewer hardware-back registry", () => {
  beforeEach(() => _resetViewerBackForTest());

  it("returns false when no viewer is open", () => {
    expect(closeTopViewer()).toBe(false);
  });

  it("closes the registered viewer exactly once and consumes BACK", () => {
    let closed = 0;
    const unregister = registerViewerBack(() => {
      closed += 1;
    });
    expect(closeTopViewer()).toBe(true);
    expect(closed).toBe(1);
    // the closer runs once; the viewer unmount unregisters
    unregister();
    expect(closeTopViewer()).toBe(false);
    expect(closed).toBe(1);
  });

  it("is LIFO when nested and unregister is idempotent", () => {
    const order: string[] = [];
    const un1 = registerViewerBack(() => order.push("first"));
    const un2 = registerViewerBack(() => order.push("second"));
    expect(closeTopViewer()).toBe(true);
    un2();
    un2(); // idempotent — a second call must not touch other entries
    expect(order).toEqual(["second"]);
    expect(closeTopViewer()).toBe(true);
    expect(order).toEqual(["second", "first"]);
    un1();
    expect(closeTopViewer()).toBe(false);
  });
});
