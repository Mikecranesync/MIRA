// Vitest coverage for the read-time relationship-type canonicalizer.
//
// Run: cd mira-hub && bun run test src/lib/knowledge-graph/canonical-relationship-type.test.ts
//
// Pure function, no DB. Authority for the mapping: proposals-writer.ts
// LOWERCASE_TO_CANONICAL_EDGE + mira-crawler/ingest/proposal_writer.py
// _CANONICAL_RELATION_TYPE.

import { describe, it, expect } from "vitest";
import { canonicalizeRelationshipType } from "./canonical-relationship-type";
import { buildGraphPayload, type EntityRow, type RelRow } from "./graph-view";

describe("canonicalizeRelationshipType — known lowercase mappings", () => {
  it("has_component -> HAS_COMPONENT", () => {
    expect(canonicalizeRelationshipType("has_component")).toBe("HAS_COMPONENT");
  });

  it("located_at -> LOCATED_IN", () => {
    expect(canonicalizeRelationshipType("located_at")).toBe("LOCATED_IN");
  });

  it("has_manual -> HAS_DOCUMENT", () => {
    expect(canonicalizeRelationshipType("has_manual")).toBe("HAS_DOCUMENT");
  });

  it("documented_in -> HAS_DOCUMENT", () => {
    expect(canonicalizeRelationshipType("documented_in")).toBe("HAS_DOCUMENT");
  });

  it("has_fault_code -> HAS_FAILURE_MODE", () => {
    expect(canonicalizeRelationshipType("has_fault_code")).toBe("HAS_FAILURE_MODE");
  });

  it("has_work_order -> HAS_WORK_ORDER", () => {
    expect(canonicalizeRelationshipType("has_work_order")).toBe("HAS_WORK_ORDER");
  });

  it("instance_of -> INSTANCE_OF", () => {
    expect(canonicalizeRelationshipType("instance_of")).toBe("INSTANCE_OF");
  });
});

describe("canonicalizeRelationshipType — passthrough", () => {
  it("already-canonical UPPERCASE types pass through unchanged", () => {
    expect(canonicalizeRelationshipType("HAS_COMPONENT")).toBe("HAS_COMPONENT");
    expect(canonicalizeRelationshipType("WIRED_TO")).toBe("WIRED_TO");
  });

  it("unknown out-of-vocabulary types pass through unchanged (e.g. CONTROLS)", () => {
    expect(canonicalizeRelationshipType("CONTROLS")).toBe("CONTROLS");
  });

  it("empty string passes through unchanged", () => {
    expect(canonicalizeRelationshipType("")).toBe("");
  });

  it("does NOT fold parent_of (direction flip requires source/target swap, out of scope for a type-only function)", () => {
    expect(canonicalizeRelationshipType("parent_of")).toBe("parent_of");
  });
});

describe("applied at the graph display-aggregation seam (buildGraphPayload)", () => {
  it("folds has_component + HAS_COMPONENT into one display bucket", () => {
    const entities: EntityRow[] = [
      { id: "a", entity_type: "equipment", name: "A", uns_path: null },
      { id: "b", entity_type: "component", name: "B", uns_path: null },
      { id: "c", entity_type: "equipment", name: "C", uns_path: null },
      { id: "d", entity_type: "component", name: "D", uns_path: null },
    ];
    const rels: RelRow[] = [
      { source_id: "a", target_id: "b", relationship_type: "has_component", confidence: 1, approval_state: "proposed" },
      { source_id: "c", target_id: "d", relationship_type: "HAS_COMPONENT", confidence: 1, approval_state: "verified" },
    ];

    const payload = buildGraphPayload(entities, rels);
    const types = new Set(payload.links.map((l) => l.type));

    expect(types).toEqual(new Set(["HAS_COMPONENT"]));
  });
});
