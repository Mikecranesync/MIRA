// The blank-white-screen guard (#3392).
//
// Two proven ways the Pixel came back from the background to a dead white
// WebView: Android killed the sandboxed renderer, and a return from the system
// photo picker with no renderer kill at all. Both leave a live Activity
// wrapping a WebView that paints nothing. This is the JS half of the recovery
// (the native half lives in MainActivity.java): on resume, decide from what is
// actually in the document whether the UI is there, and reload if it is not.
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/resume-guard

import { describe, it, expect } from "vitest";
import { probeRendered, shouldReloadAfterResume } from "../resume-guard";

function doc(opts: { root?: boolean; children?: number; width?: number; height?: number }) {
  const { root = true, children = 1, width = 1080, height = 2424 } = opts;
  return {
    getElementById: (id: string) =>
      id === "root" && root ? ({ childElementCount: children } as unknown as HTMLElement) : null,
    body: { getBoundingClientRect: () => ({ width, height }) } as unknown as HTMLElement,
  } as unknown as Document;
}

describe("probeRendered", () => {
  it("is ok when the React root has children and the body has a size", () => {
    expect(probeRendered(doc({}))).toBe("ok");
  });
  it("reports an empty root (renderer came back with no DOM)", () => {
    expect(probeRendered(doc({ children: 0 }))).toBe("empty");
  });
  it("reports a missing root", () => {
    expect(probeRendered(doc({ root: false }))).toBe("no-root");
  });
  it("reports a zero-size body (nothing laid out)", () => {
    expect(probeRendered(doc({ height: 0 }))).toBe("zero");
  });
});

describe("shouldReloadAfterResume", () => {
  it("never reloads on the first activation — the app is still booting", () => {
    expect(shouldReloadAfterResume({ wasBackgrounded: false, probe: "empty" })).toBe(false);
  });
  it("reloads when we came back from the background to nothing", () => {
    expect(shouldReloadAfterResume({ wasBackgrounded: true, probe: "empty" })).toBe(true);
    expect(shouldReloadAfterResume({ wasBackgrounded: true, probe: "zero" })).toBe(true);
    expect(shouldReloadAfterResume({ wasBackgrounded: true, probe: "no-root" })).toBe(true);
  });
  it("leaves a healthy UI alone", () => {
    expect(shouldReloadAfterResume({ wasBackgrounded: true, probe: "ok" })).toBe(false);
  });
});
