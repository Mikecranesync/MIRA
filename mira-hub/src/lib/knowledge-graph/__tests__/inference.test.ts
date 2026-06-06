// src/lib/knowledge-graph/__tests__/inference.test.ts
import { describe, test, expect } from "vitest";
import {
  inferSameModelPairs,
  inferCoFailedPairs,
  inferComponentManualPairs,
  type SameModelInput,
  type CoFailEvent,
  type ComponentInput,
  type ManualInput,
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

describe("inferComponentManualPairs", () => {
  const C = (id: string, manufacturer: string | null, model: string | null): ComponentInput => ({ id, manufacturer, model });
  const M = (id: string, manufacturer: string | null, model: string | null, title: string | null): ManualInput => ({ id, manufacturer, model, title });

  test("manufacturer + model match → 0.85 mfr_model", () => {
    const r = inferComponentManualPairs([C("c1", "Allen-Bradley", "PowerFlex 525")], [M("m1", "Allen-Bradley", "PowerFlex 525", "PF525 Manual")]);
    expect(r).toEqual([{ componentId: "c1", manualId: "m1", confidence: 0.85, matchType: "mfr_model", reason: expect.any(String) }]);
  });

  test("model match without manufacturer → 0.75 exact_model", () => {
    const r = inferComponentManualPairs([C("c1", null, "GS10")], [M("m1", null, "GS10", "Drive Manual")]);
    expect(r[0]).toMatchObject({ componentId: "c1", manualId: "m1", confidence: 0.75, matchType: "exact_model" });
  });

  test("model appears in manual title → 0.6 model_in_title", () => {
    const r = inferComponentManualPairs([C("c1", "Baldor", "GS10")], [M("m1", null, null, "GS10 VFD User Guide")]);
    expect(r[0]).toMatchObject({ matchType: "model_in_title", confidence: 0.6 });
  });

  test("different model and no title hit → no match", () => {
    expect(inferComponentManualPairs([C("c1", "Baldor", "GS10")], [M("m1", "Baldor", "GS20", "GS20 Guide")])).toEqual([]);
  });

  test("component without model is skipped", () => {
    expect(inferComponentManualPairs([C("c1", "Baldor", null)], [M("m1", "Baldor", "GS10", "GS10")])).toEqual([]);
  });

  test("short model (<3 chars) does not match by title substring", () => {
    expect(inferComponentManualPairs([C("c1", null, "X1")], [M("m1", null, null, "Section X1 wiring")])).toEqual([]);
  });

  test("dedupes to one (highest-confidence) match per component-manual pair", () => {
    const r = inferComponentManualPairs([C("c1", null, "GS10")], [M("m1", null, "GS10", "GS10 Manual")]);
    expect(r).toHaveLength(1);
    expect(r[0].confidence).toBe(0.75);
  });

  test("case- and whitespace-insensitive", () => {
    const r = inferComponentManualPairs([C("c1", " Baldor ", "gs10")], [M("m1", "BALDOR", " GS10", "x")]);
    expect(r[0]).toMatchObject({ matchType: "mfr_model" });
  });
});
