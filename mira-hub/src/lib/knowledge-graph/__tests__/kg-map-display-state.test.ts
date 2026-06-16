import { describe, it, expect } from "vitest";
import { kgMapDisplayState } from "@/lib/knowledge-graph/graph-view";

describe("kgMapDisplayState — relationship graph guidance (#1984)", () => {
  it("shows actionable guidance when there are no edges at all", () => {
    // The #1984 scenario: 214 nodes, 0 verified, 0 proposed.
    expect(kgMapDisplayState(0, 0)).toBe("guidance");
  });

  it("nudges to review suggestions when proposals exist but none are verified", () => {
    expect(kgMapDisplayState(0, 5)).toBe("review-suggestions");
  });

  it("shows nothing once verified edges exist", () => {
    expect(kgMapDisplayState(3, 0)).toBe("none");
    expect(kgMapDisplayState(3, 5)).toBe("none");
  });
});
