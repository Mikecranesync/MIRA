// src/lib/knowledge-graph/__tests__/analysis.test.ts
import { describe, test, expect } from "vitest";
import { buildGraphPayload, type EntityRow, type RelRow } from "../graph-view";
import { analyzeGraph, MIN_EDGES_FOR_ANALYSIS } from "../analysis";

// Two 8-node cliques bridged by a single edge → > MIN_EDGES_FOR_ANALYSIS edges
// and an unambiguous 2-community structure.
function denseTwoClusters(): { entities: EntityRow[]; rels: RelRow[] } {
  const mk = (id: string): EntityRow => ({ id, entity_type: "component", name: id, uns_path: null });
  const A = Array.from({ length: 8 }, (_, i) => `a${i}`);
  const B = Array.from({ length: 8 }, (_, i) => `b${i}`);
  const entities = [...A, ...B].map(mk);
  const rels: RelRow[] = [];
  const clique = (ns: string[]) => {
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++)
        rels.push({ source_id: ns[i], target_id: ns[j], relationship_type: "RELATED", confidence: 1, approval_state: "verified" });
  };
  clique(A);
  clique(B);
  rels.push({ source_id: "a0", target_id: "b0", relationship_type: "RELATED", confidence: 1, approval_state: "verified" }); // bridge
  return { entities, rels };
}

describe("analyzeGraph — dense graph", () => {
  const { entities, rels } = denseTwoClusters();
  const payload = buildGraphPayload(entities, rels);
  const a = analyzeGraph(payload);

  test("is available above the edge threshold", () => {
    expect(a.available).toBe(true);
    expect(a.edgeCount).toBeGreaterThanOrEqual(MIN_EDGES_FOR_ANALYSIS);
  });

  test("detects at least two communities", () => {
    expect(a.communityCount).toBeGreaterThanOrEqual(2);
  });

  test("normalizes centrality to 0..1 with a max of 1", () => {
    const vals = Object.values(a.stats).map((s) => s.centrality);
    expect(vals.length).toBe(16);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeCloseTo(1, 5);
  });

  test("godNodes are sorted by centrality, capped, and labeled", () => {
    expect(a.godNodes.length).toBeGreaterThan(0);
    expect(a.godNodes.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < a.godNodes.length; i++)
      expect(a.godNodes[i - 1].centrality).toBeGreaterThanOrEqual(a.godNodes[i].centrality);
    expect(a.godNodes[0].label).toBeTruthy();
  });
});

describe("analyzeGraph — realistic sparse graph (below threshold)", () => {
  // 5 nodes, 4 edges — the shape most real tenants have today.
  const entities: EntityRow[] = ["n0", "n1", "n2", "n3", "n4"].map((id) => ({
    id, entity_type: "equipment", name: id, uns_path: null,
  }));
  const rels: RelRow[] = [
    { source_id: "n0", target_id: "n1", relationship_type: "HAS_DOCUMENT", confidence: 1, approval_state: "verified" },
    { source_id: "n0", target_id: "n2", relationship_type: "HAS_DOCUMENT", confidence: 1, approval_state: "verified" },
    { source_id: "n1", target_id: "n3", relationship_type: "HAS_DOCUMENT", confidence: 1, approval_state: "verified" },
    { source_id: "n2", target_id: "n4", relationship_type: "HAS_DOCUMENT", confidence: 1, approval_state: "verified" },
  ];
  const a = analyzeGraph(buildGraphPayload(entities, rels));

  test("reports unavailable, not degenerate noise", () => {
    expect(a.available).toBe(false);
    expect(a.edgeCount).toBe(4);
    expect(a.minEdges).toBe(MIN_EDGES_FOR_ANALYSIS);
    expect(a.stats).toEqual({});
    expect(a.godNodes).toEqual([]);
    expect(a.communityCount).toBe(0);
  });
});

describe("analyzeGraph — robustness", () => {
  test("ignores self-loops and parallel edges, drops dangling endpoints", () => {
    const entities: EntityRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `x${i}`, entity_type: "part", name: `x${i}`, uns_path: null,
    }));
    const rels: RelRow[] = [];
    // a ring (25 edges) → above threshold
    for (let i = 0; i < 25; i++)
      rels.push({ source_id: `x${i}`, target_id: `x${(i + 1) % 25}`, relationship_type: "R", confidence: 1, approval_state: "verified" });
    // noise: self-loop, duplicate, dangling
    rels.push({ source_id: "x0", target_id: "x0", relationship_type: "R", confidence: 1, approval_state: "verified" });
    rels.push({ source_id: "x0", target_id: "x1", relationship_type: "R", confidence: 1, approval_state: "verified" });
    rels.push({ source_id: "x0", target_id: "ghost", relationship_type: "R", confidence: 1, approval_state: "verified" });
    const a = analyzeGraph(buildGraphPayload(entities, rels));
    expect(a.available).toBe(true);
    // 25 ring edges; self-loop + parallel collapsed; dangling dropped by buildGraphPayload
    expect(a.edgeCount).toBe(25);
    expect(Object.keys(a.stats).length).toBe(25);
  });
});
