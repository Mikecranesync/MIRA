import { describe, test, expect } from "vitest";
import { extractTrace, type TraceGroundingLike } from "../trace";

describe("extractTrace", () => {
  test("root first, then component ids", () => {
    const g: TraceGroundingLike = { components: [{ id: "c1" }, { id: "c2" }], edges: [] };
    expect(extractTrace(g, "root").entityIds).toEqual(["root", "c1", "c2"]);
  });

  test("dedups component equal to root and repeats", () => {
    const g: TraceGroundingLike = { components: [{ id: "root" }, { id: "c1" }, { id: "c1" }] };
    expect(extractTrace(g, "root").entityIds).toEqual(["root", "c1"]);
  });

  test("null root → components only", () => {
    const g: TraceGroundingLike = { components: [{ id: "c1" }] };
    expect(extractTrace(g, null).entityIds).toEqual(["c1"]);
  });

  test("skips non-string / empty ids", () => {
    const g: TraceGroundingLike = { components: [{ id: 42 }, { id: "" }, { id: "ok" }] };
    expect(extractTrace(g, null).entityIds).toEqual(["ok"]);
  });

  test("edges coerced with defaults", () => {
    const g: TraceGroundingLike = {
      components: [],
      edges: [
        { s_name: "A", t_name: "B", relationship_type: "has_manual", confidence: 0.9 },
        {},
      ],
    };
    expect(extractTrace(g, null).edges).toEqual([
      { sName: "A", tName: "B", type: "has_manual", confidence: 0.9 },
      { sName: "", tName: "", type: "", confidence: 0 },
    ]);
  });
});
