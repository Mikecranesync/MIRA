import { beforeEach, describe, expect, test, vi } from "vitest";

// Prove the hierarchy backfill PROPOSES equipment LOCATED_IN area/line
// (relationship_proposals via upsertInferredProposal), never inserts a
// parent_of kg_relationships edge directly (#1721).
const { executed, reset } = vi.hoisted(() => {
  const executed: { sql: string; params: unknown[] }[] = [];
  return { executed, reset: () => (executed.length = 0) };
});

vi.mock("@/lib/db", () => {
  let propCounter = 0;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      // findEquipmentWithLocation
      if (sql.includes("properties ? 'location'"))
        return { rows: [{ id: "kg-eq-1", entity_id: "AC-7", name: "Compressor", location: "Line 1" }], rowCount: 1 };
      // findParentByLocation
      if (sql.includes("entity_type IN ('area','line')"))
        return { rows: [{ id: "kg-line-1", entity_id: "line_1", name: "Line 1", entity_type: "line" }], rowCount: 1 };
      if (sql.includes("INSERT INTO relationship_proposals"))
        return { rows: [{ id: `prop-${++propCounter}` }], rowCount: 1 };
      if (sql.includes("FROM kg_relationships")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM relationship_proposals")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { default: { connect: async () => client } };
});

import { runHierarchyBackfill } from "../hierarchy-backfill";

const TENANT = "00000000-0000-0000-0000-000000000001";
const blob = () => executed.map((e) => e.sql).join("\n");

describe("runHierarchyBackfill — proposes, never auto-verifies (#1721)", () => {
  beforeEach(() => reset());

  test("a location match becomes a LOCATED_IN proposal, not a parent_of insert", async () => {
    const result = await runHierarchyBackfill(TENANT, false);
    expect(blob()).toContain("INSERT INTO relationship_proposals");
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(result.relationshipsCreated).toBe(0);
    expect(result.relationshipsProposed).toBe(1);
    expect(result.matchesFound).toBe(1);
  });

  test("proposes equipment LOCATED_IN line (parent_of flipped)", async () => {
    await runHierarchyBackfill(TENANT, false);
    const prop = executed.find((e) => e.sql.includes("INSERT INTO relationship_proposals"));
    expect(prop).toBeDefined();
    // params: [tenant, source_id, source_type, target_id, target_type, rel_type, confidence, reasoning]
    const p = prop!.params as unknown[];
    expect(p[5]).toBe("LOCATED_IN");
    // flip: equipment is the source, the line is the target
    expect(p[1]).toBe("kg-eq-1");
    expect(p[2]).toBe("equipment");
    expect(p[3]).toBe("kg-line-1");
    expect(p[4]).toBe("line");
  });

  test("dry-run proposes nothing but still reports matches", async () => {
    const result = await runHierarchyBackfill(TENANT, true);
    expect(blob()).not.toContain("INSERT INTO relationship_proposals");
    expect(result.matchesFound).toBe(1);
    expect(result.relationshipsProposed).toBe(0);
  });
});
