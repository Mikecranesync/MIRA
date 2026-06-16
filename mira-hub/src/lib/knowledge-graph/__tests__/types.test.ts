import { describe, test, expect } from "vitest";
import {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  isEntityType,
  isRelationshipType,
} from "../types";

describe("entity type allowlist", () => {
  test("includes the legacy types", () => {
    for (const t of ["equipment", "work_order", "manual", "fault_code", "part"]) {
      expect(isEntityType(t)).toBe(true);
    }
  });

  test("includes the multi-hop additions", () => {
    for (const t of ["plant", "area", "line", "component", "resolution", "technician", "pm_task"]) {
      expect(isEntityType(t)).toBe(true);
    }
  });

  test("includes the schematic additions", () => {
    expect(isEntityType("electrical_component")).toBe(true);
  });

  test("rejects unknown types", () => {
    expect(isEntityType("widget")).toBe(false);
    expect(isEntityType("")).toBe(false);
  });

  test("has no duplicate entries", () => {
    expect(new Set(ENTITY_TYPES).size).toBe(ENTITY_TYPES.length);
  });
});

describe("relationship type allowlist", () => {
  test("includes the legacy relationships", () => {
    for (const t of [
      "mentioned_tag",
      "exhibited_fault",
      "requires_part",
      "has_work_order",
      "has_pm",
      "located_at",
    ]) {
      expect(isRelationshipType(t)).toBe(true);
    }
  });

  test("includes the hierarchy + causal additions", () => {
    for (const t of [
      "parent_of",
      "has_component",
      "feeds",
      "caused_by",
      "resolved_by",
      "had_fault",
      "similar_to",
    ]) {
      expect(isRelationshipType(t)).toBe(true);
    }
  });

  test("includes the schematic additions", () => {
    for (const t of ["electrically_connected", "controls", "protects", "references_drawing"]) {
      expect(isRelationshipType(t)).toBe(true);
    }
  });

  test("rejects unknown relationships", () => {
    expect(isRelationshipType("does_a_thing")).toBe(false);
    expect(isRelationshipType("")).toBe(false);
  });

  test("has no duplicate entries", () => {
    expect(new Set(RELATIONSHIP_TYPES).size).toBe(RELATIONSHIP_TYPES.length);
  });
});
