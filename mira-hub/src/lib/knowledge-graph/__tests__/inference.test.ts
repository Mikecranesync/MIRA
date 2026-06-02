// src/lib/knowledge-graph/__tests__/inference.test.ts
import { describe, test, expect } from "vitest";
import {
  inferSameModelPairs,
  inferCoFailedPairs,
  type SameModelInput,
  type CoFailEvent,
} from "../inference";

describe("inferSameModelPairs", () => {
  test("pairs two units with identical manufacturer+model", () => {
    const eq: SameModelInput[] = [
      { id: "a", manufacturer: "Baldor", model: "GS10" },
      { id: "b", manufacturer: "Baldor", model: "GS10" },
    ];
    const p = inferSameModelPairs(eq);
    expect(p).toEqual([{ sourceId: "a", targetId: "b", key: "baldor|gs10" }]);
  });

  test("three identical units yield 3 unordered pairs (source<target)", () => {
    const eq: SameModelInput[] = [
      { id: "c", manufacturer: "Siemens", model: "S120" },
      { id: "a", manufacturer: "Siemens", model: "S120" },
      { id: "b", manufacturer: "Siemens", model: "S120" },
    ];
    const p = inferSameModelPairs(eq);
    expect(p.map((x) => [x.sourceId, x.targetId])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  test("different model → no pair", () => {
    const eq: SameModelInput[] = [
      { id: "a", manufacturer: "Baldor", model: "GS10" },
      { id: "b", manufacturer: "Baldor", model: "GS20" },
    ];
    expect(inferSameModelPairs(eq)).toEqual([]);
  });

  test("null/empty manufacturer or model is skipped", () => {
    const eq: SameModelInput[] = [
      { id: "a", manufacturer: null, model: "GS10" },
      { id: "b", manufacturer: "", model: "GS10" },
      { id: "c", manufacturer: "Baldor", model: null },
    ];
    expect(inferSameModelPairs(eq)).toEqual([]);
  });

  test("grouping is case- and whitespace-insensitive", () => {
    const eq: SameModelInput[] = [
      { id: "a", manufacturer: " Baldor ", model: "gs10" },
      { id: "b", manufacturer: "BALDOR", model: " GS10" },
    ];
    expect(inferSameModelPairs(eq)).toEqual([
      { sourceId: "a", targetId: "b", key: "baldor|gs10" },
    ]);
  });
});

describe("inferCoFailedPairs", () => {
  test("two equipment within window → one pair, count 1", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "a", at: 0 },
      { equipmentId: "b", at: 10 },
    ];
    expect(inferCoFailedPairs(ev, 3600)).toEqual([{ sourceId: "a", targetId: "b", count: 1 }]);
  });

  test("outside window → no pair", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "a", at: 0 },
      { equipmentId: "b", at: 100 },
    ];
    expect(inferCoFailedPairs(ev, 20)).toEqual([]);
  });

  test("same equipment twice → no self pair", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "a", at: 0 },
      { equipmentId: "a", at: 10 },
    ];
    expect(inferCoFailedPairs(ev, 3600)).toEqual([]);
  });

  test("three equipment in one window → 3 pairs", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "eqA", at: 0 },
      { equipmentId: "eqB", at: 10 },
      { equipmentId: "eqC", at: 20 },
    ];
    const p = inferCoFailedPairs(ev, 3600);
    expect(p.map((x) => [x.sourceId, x.targetId])).toEqual([
      ["eqA", "eqB"],
      ["eqA", "eqC"],
      ["eqB", "eqC"],
    ]);
  });

  test("repeated co-occurrences increment count", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "a", at: 0 },
      { equipmentId: "b", at: 5 },
      { equipmentId: "a", at: 100 },
      { equipmentId: "b", at: 105 },
    ];
    expect(inferCoFailedPairs(ev, 20)).toEqual([{ sourceId: "a", targetId: "b", count: 2 }]);
  });

  test("pair endpoints are normalized source<target regardless of event order", () => {
    const ev: CoFailEvent[] = [
      { equipmentId: "z", at: 0 },
      { equipmentId: "a", at: 5 },
    ];
    expect(inferCoFailedPairs(ev, 3600)).toEqual([{ sourceId: "a", targetId: "z", count: 1 }]);
  });
});
