import { beforeEach, describe, expect, test, vi } from "vitest";

// Prove the CMMS → KG sync PROPOSES (relationship_proposals via
// upsertInferredProposal), never inserts kg_relationships directly (#1721).
const { executed, reset } = vi.hoisted(() => {
  const executed: { sql: string; params: unknown[] }[] = [];
  return { executed, reset: () => (executed.length = 0) };
});

vi.mock("@/lib/db", () => {
  let propCounter = 0;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      // Entity upserts echo back id/type/entity_id derived from params so the
      // sync's lookup maps (eqById/woById/...) resolve.
      if (sql.includes("INSERT INTO kg_entities"))
        return {
          rows: [{ id: `kg-${params[2]}`, entity_type: params[1], entity_id: String(params[2]) }],
          rowCount: 1,
        };
      if (sql.includes("INSERT INTO relationship_proposals"))
        return { rows: [{ id: `prop-${++propCounter}` }], rowCount: 1 };
      if (sql.includes("FROM kg_relationships")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM relationship_proposals")) return { rows: [], rowCount: 0 };
      // resolveTenantParentPath
      if (sql.includes("entity_type IN ('site'"))
        return { rows: [{ uns_path: "enterprise.plant_a.line_1" }], rowCount: 1 };
      if (sql.includes("FROM cmms_equipment"))
        return {
          rows: [
            { id: "eq-1", equipment_number: "AC-7", manufacturer: null, model_number: null,
              serial_number: null, equipment_type: null, location: "Bay 3", department: null,
              criticality: null, description: "Compressor", uns_path: null },
          ],
          rowCount: 1,
        };
      if (sql.includes("FROM work_orders"))
        return { rows: [{ id: "wo-1", work_order_number: "WO-1", equipment_id: "eq-1", title: "Fix it", status: null, priority: null, source: null }], rowCount: 1 };
      if (sql.includes("FROM pm_schedules"))
        return { rows: [{ id: "pm-1", equipment_id: "eq-1", task: "Lube", interval_value: 30, interval_unit: "days", criticality: null, next_due_at: null }], rowCount: 1 };
      if (sql.includes("FROM knowledge_entries")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { default: { connect: async () => client } };
});

import { syncCmmsToKg } from "../cmms-sync";

const TENANT = "00000000-0000-0000-0000-000000000001";
const blob = () => executed.map((e) => e.sql).join("\n");

describe("syncCmmsToKg — proposes, never auto-verifies (#1721)", () => {
  beforeEach(() => reset());

  test("CMMS edges become proposals, not kg_relationships inserts", async () => {
    const result = await syncCmmsToKg(TENANT);
    expect(blob()).toContain("INSERT INTO relationship_proposals");
    expect(blob()).toContain("INSERT INTO kg_triples_log"); // audit trail kept
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(result.relationships).toBe(0);
    expect(result.relationshipsProposed).toBe(3); // located_at + work_order + pm
  });

  test("proposes canonical types: LOCATED_IN, HAS_WORK_ORDER, HAS_PM_SCHEDULE", async () => {
    await syncCmmsToKg(TENANT);
    const types = executed
      .filter((e) => e.sql.includes("INSERT INTO relationship_proposals"))
      .map((e) => (e.params as unknown[])[5]); // rel_type is the 6th param
    expect(types).toContain("LOCATED_IN");
    expect(types).toContain("HAS_WORK_ORDER");
    expect(types).toContain("HAS_PM_SCHEDULE");
  });

  test("work-order edge is equipment → HAS_WORK_ORDER → work_order", async () => {
    await syncCmmsToKg(TENANT);
    const wo = executed.find(
      (e) => e.sql.includes("INSERT INTO relationship_proposals") && (e.params as unknown[])[5] === "HAS_WORK_ORDER",
    );
    expect(wo).toBeDefined();
    // params: [tenant, source_id, source_type, target_id, target_type, rel_type, confidence, reasoning]
    const p = wo!.params as unknown[];
    expect(p[1]).toBe("kg-eq-1");
    expect(p[2]).toBe("equipment");
    expect(p[3]).toBe("kg-wo-1");
    expect(p[4]).toBe("work_order");
  });
});
