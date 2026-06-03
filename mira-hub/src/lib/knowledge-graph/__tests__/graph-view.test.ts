// src/lib/knowledge-graph/__tests__/graph-view.test.ts
import { describe, test, expect } from "vitest";
import { buildGraphPayload, type EntityRow, type RelRow } from "../graph-view";

const entities: EntityRow[] = [
  { id: "a", entity_type: "equipment", name: "VFD-07", uns_path: "ent.site.vfd07" },
  { id: "b", entity_type: "manual", name: "PowerFlex Manual", uns_path: null },
  { id: "c", entity_type: "fault_code", name: "F004", uns_path: null }, // orphan
];

describe("buildGraphPayload", () => {
  test("maps nodes and labels (name, fallback to id)", () => {
    const p = buildGraphPayload(
      [{ id: "x", entity_type: "part", name: null, uns_path: null }],
      [],
    );
    expect(p.nodes[0]).toMatchObject({ id: "x", type: "part", label: "x", degree: 0 });
  });

  test("computes degree on both endpoints", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_manual", confidence: 1, approval_state: "verified" },
    ];
    const p = buildGraphPayload(entities, rels);
    const byId = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
    expect(byId["a"].degree).toBe(1);
    expect(byId["b"].degree).toBe(1);
    expect(byId["c"].degree).toBe(0);
  });

  test("drops links whose endpoint is missing", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "ZZZ", relationship_type: "has_manual", confidence: 1, approval_state: "verified" },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links).toHaveLength(0);
    expect(p.nodes.find((n) => n.id === "a")?.degree).toBe(0);
  });

  test("defaults confidence=1 and state=verified when null", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_manual", confidence: null, approval_state: null },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links[0]).toMatchObject({ confidence: 1, state: "verified" });
  });

  test("carries proposalId through when present", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "SAME_MODEL_AS", confidence: 0.6, approval_state: "proposed", proposal_id: "prop-1" },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links[0]).toMatchObject({ state: "proposed", proposalId: "prop-1" });
  });

  test("verified links have no proposalId", () => {
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_manual", confidence: 1, approval_state: "verified" },
    ];
    const p = buildGraphPayload(entities, rels);
    expect(p.links[0]).not.toHaveProperty("proposalId");
  });
});
