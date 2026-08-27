// Transient-layer BACK stack (Commodity PRD §11, Phase 3). Successor to the
// #3429 viewer-close registry tests — the registry generalized and moved; the
// LIFO/idempotency contract it proved on device (BACK closes viewer → sheet →
// conversation, Phase-2 acceptance 2026-08-27) is pinned here unchanged.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/transient-layer

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTransientLayer,
  closeTopTransientLayer,
  _resetTransientLayersForTest,
} from "../transient-layer";

describe("transient-layer BACK registry", () => {
  beforeEach(() => _resetTransientLayersForTest());

  it("returns false when no layer is open — BACK falls through to navigation", () => {
    expect(closeTopTransientLayer()).toBe(false);
  });

  it("closes the registered layer exactly once and consumes BACK", () => {
    let closed = 0;
    const unregister = registerTransientLayer(() => {
      closed += 1;
    });
    expect(closeTopTransientLayer()).toBe(true);
    expect(closed).toBe(1);
    unregister();
    expect(closeTopTransientLayer()).toBe(false);
    expect(closed).toBe(1);
  });

  it("is LIFO when nested and unregister is idempotent", () => {
    const order: string[] = [];
    const un1 = registerTransientLayer(() => order.push("sheet"));
    const un2 = registerTransientLayer(() => order.push("viewer"));
    expect(closeTopTransientLayer()).toBe(true);
    un2();
    un2(); // idempotent — a second call must not touch other entries
    expect(order).toEqual(["viewer"]);
    expect(closeTopTransientLayer()).toBe(true);
    expect(order).toEqual(["viewer", "sheet"]);
    un1();
    expect(closeTopTransientLayer()).toBe(false);
  });
});
