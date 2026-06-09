/**
 * Regression test for PR #1742 — GraphCanvas painters must not crash the
 * /knowledge/map page when d3-force emits a non-finite x/y on the first tick.
 *
 * Bug (prod, 2026-06-06): react-force-graph-2d's simulation emits NaN/Infinity
 * coords on the first synchronous tick before positions settle. The custom
 * `nodeCanvasObject` / `nodePointerAreaPaint` painters called
 * `ctx.createRadialGradient(NaN, ...)` / `ctx.arc(NaN, ...)`, which throw
 * "The provided double value is non-finite" — propagating through React's
 * commit phase and tripping the error boundary (whole page blanks).
 *
 * Fix: both painters early-return when coords aren't finite.
 *
 * This test calls GraphCanvas() directly to obtain the ForceGraph2D element,
 * reads the two painter callbacks off its props, and exercises them against a
 * canvas-2d context mock that throws on non-finite coords (mirroring real
 * browser behavior). Pre-fix this test throws; post-fix it passes.
 *
 * No DOM render needed (vitest env is "node"): GraphCanvas is a pure function
 * component, so `GraphCanvas(props).props.nodeCanvasObject` is the painter.
 */
import { describe, expect, it } from "vitest";

import { GraphCanvas } from "../GraphCanvas";

/** Mock 2D context that mimics the browser: createRadialGradient/arc throw on
 *  non-finite coords, exactly the crash #1742 fixed. Records what got painted. */
function makeCtx() {
  const painted: string[] = [];
  const assertFinite = (...vals: number[]) => {
    for (const v of vals) {
      if (!Number.isFinite(v)) {
        throw new Error("IndexSizeError: The provided double value is non-finite.");
      }
    }
  };
  const ctx = {
    painted,
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
      assertFinite(x0, y0, r0, x1, y1, r1);
      painted.push("createRadialGradient");
      return { addColorStop() {} };
    },
    beginPath() {},
    arc(x: number, y: number, r: number) {
      assertFinite(x, y, r);
      painted.push("arc");
    },
    fill() {},
    stroke() {},
    fillText() {},
    measureText() {
      return { width: 0 };
    },
    // setters the painter assigns to — no-ops
    set fillStyle(_v: unknown) {},
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: unknown) {},
    set font(_v: unknown) {},
    set textAlign(_v: unknown) {},
  };
  return ctx as unknown as CanvasRenderingContext2D & { painted: string[] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function painters(): { node: any; hit: any } {
  // GraphCanvas returns <ForceGraph2D {...props} />; the painters live on props.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = GraphCanvas({ data: { nodes: [], links: [] } }) as any;
  return { node: el.props.nodeCanvasObject, hit: el.props.nodePointerAreaPaint };
}

describe("GraphCanvas painters — non-finite coord guard (#1742)", () => {
  it("nodeCanvasObject does NOT throw on NaN coords (would crash the page pre-fix)", () => {
    const { node } = painters();
    const ctx = makeCtx();
    const bad = { id: "n1", label: "x", type: "equipment", degree: 1, x: NaN, y: NaN };
    expect(() => node(bad, ctx, 1)).not.toThrow();
    // guard short-circuits before any drawing call
    expect(ctx.painted).toEqual([]);
  });

  it("nodeCanvasObject does NOT throw on Infinity coords", () => {
    const { node } = painters();
    const ctx = makeCtx();
    const bad = { id: "n2", label: "y", type: "component", degree: 0, x: Infinity, y: 3 };
    expect(() => node(bad, ctx, 1)).not.toThrow();
    expect(ctx.painted).toEqual([]);
  });

  it("nodePointerAreaPaint does NOT throw on NaN coords", () => {
    const { hit } = painters();
    const ctx = makeCtx();
    const bad = { id: "n3", label: "z", type: "fault_code", degree: 2, x: NaN, y: NaN };
    expect(() => hit(bad, "#abc", ctx)).not.toThrow();
    expect(ctx.painted).toEqual([]);
  });

  it("still paints normally once coords are finite (guard is transient, not a kill-switch)", () => {
    const { node } = painters();
    const ctx = makeCtx();
    const good = { id: "n4", label: "ok", type: "equipment", degree: 3, x: 10, y: 20 };
    expect(() => node(good, ctx, 1)).not.toThrow();
    // finite node reaches the drawing calls (glow gradient + core marker)
    expect(ctx.painted).toContain("createRadialGradient");
    expect(ctx.painted).toContain("arc");
  });
});
