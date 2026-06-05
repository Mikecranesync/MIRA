import { describe, expect, test } from "vitest";

import {
  isCanonicalProposalRelationshipType,
  mapToCanonicalEdge,
} from "../proposals-writer";

describe("isCanonicalProposalRelationshipType", () => {
  test("accepts canonical CHECK vocabulary", () => {
    for (const t of ["WIRED_TO", "HAS_COMPONENT", "SAME_MODEL_AS", "HAS_FAILURE_MODE"]) {
      expect(isCanonicalProposalRelationshipType(t)).toBe(true);
    }
  });
  test("rejects lowercase / unknown types", () => {
    for (const t of ["feeds", "has_work_order", "frobnicate", ""]) {
      expect(isCanonicalProposalRelationshipType(t)).toBe(false);
    }
  });
});

describe("mapToCanonicalEdge", () => {
  test("canonical types pass through unflipped", () => {
    expect(mapToCanonicalEdge("WIRED_TO")).toEqual({ type: "WIRED_TO", flip: false });
    expect(mapToCanonicalEdge("SAME_MODEL_AS")).toEqual({ type: "SAME_MODEL_AS", flip: false });
  });

  test("direction-preserving lowercase mappings", () => {
    expect(mapToCanonicalEdge("feeds")).toEqual({ type: "UPSTREAM_OF", flip: false });
    expect(mapToCanonicalEdge("requires_part")).toEqual({ type: "HAS_PART", flip: false });
    expect(mapToCanonicalEdge("had_fault")).toEqual({ type: "HAS_FAILURE_MODE", flip: false });
    expect(mapToCanonicalEdge("resolved_by")).toEqual({ type: "RESOLVED_BY", flip: false });
    expect(mapToCanonicalEdge("triggered_pm")).toEqual({ type: "TRIGGERS", flip: false });
    expect(mapToCanonicalEdge("located_at")).toEqual({ type: "LOCATED_IN", flip: false });
    expect(mapToCanonicalEdge("parent_of")).toEqual({ type: "HAS_COMPONENT", flip: false });
    expect(mapToCanonicalEdge("electrically_connected")).toEqual({ type: "WIRED_TO", flip: false });
    expect(mapToCanonicalEdge("mentioned_tag")).toEqual({ type: "HAS_SIGNAL", flip: false });
  });

  test("caused_by flips direction (A caused_by B → B CAUSES A)", () => {
    expect(mapToCanonicalEdge("caused_by")).toEqual({ type: "CAUSES", flip: true });
  });

  test("types with no clean canonical equivalent return null (caller skips)", () => {
    for (const t of ["has_work_order", "controls", "protects", "maintained_by", "frobnicate"]) {
      expect(mapToCanonicalEdge(t)).toBeNull();
    }
  });

  test("every mapped target is itself canonical (round-trip safety)", () => {
    for (const raw of [
      "caused_by", "resolved_by", "feeds", "requires_part", "triggered_pm", "had_fault",
      "mentioned_tag", "exhibited_fault", "located_at", "has_pm", "parent_of",
      "has_component", "electrically_connected", "references_drawing", "similar_to",
    ]) {
      const edge = mapToCanonicalEdge(raw);
      expect(edge).not.toBeNull();
      expect(isCanonicalProposalRelationshipType(edge!.type)).toBe(true);
    }
  });
});
