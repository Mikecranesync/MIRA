import { beforeEach, describe, expect, test, vi } from "vitest";

// Record every SQL statement the fake pg client executes, and answer the
// queries upsertSchematicComponents + upsertInferredProposal issue. Hoisted so
// the vi.mock factory below can close over it.
const { executed, reset } = vi.hoisted(() => {
  const executed: { sql: string; params: unknown[] }[] = [];
  return { executed, reset: () => (executed.length = 0) };
});

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: unknown) => unknown) => {
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        executed.push({ sql, params });
        if (sql.includes("INSERT INTO kg_entities"))
          return { rows: [{ id: `ent-${executed.length}` }], rowCount: 1 };
        if (sql.includes("INSERT INTO relationship_proposals"))
          return { rows: [{ id: `prop-${executed.length}` }], rowCount: 1 };
        if (sql.includes("FROM kg_relationships")) return { rows: [], rowCount: 0 };
        if (sql.includes("FROM relationship_proposals")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    };
    return fn(client);
  },
}));

import { upsertSchematicComponents } from "../queries";

const TENANT = "00000000-0000-0000-0000-000000000001";

function blob() {
  return executed.map((e) => e.sql).join("\n");
}

describe("upsertSchematicComponents — proposes, never auto-verifies (#1721)", () => {
  beforeEach(() => reset());

  const twoEntities = [
    { entity_type: "component", entity_id: "C1", name: "Motor", properties: {} },
    { entity_type: "component", entity_id: "C2", name: "Drive", properties: {} },
  ];

  test("a canonical schematic edge lands as a proposal, NOT a kg_relationships insert", async () => {
    const result = await upsertSchematicComponents(TENANT, {
      schematic_type: "wiring",
      entities: twoEntities,
      relationships: [
        { source_entity_id: "C2", target_entity_id: "C1", relationship_type: "POWERED_BY" },
      ],
    });
    expect(blob()).toContain("INSERT INTO relationship_proposals");
    expect(blob()).toContain("INSERT INTO relationship_evidence");
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(result.relationships_proposed).toBe(1);
    expect(result.relationships_inserted).toBe(0);
    expect(result.entities_upserted).toBe(2);
  });

  test("a non-canonical relationship_type is skipped (no proposal, no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await upsertSchematicComponents(TENANT, {
      schematic_type: "wiring",
      entities: twoEntities,
      relationships: [
        { source_entity_id: "C1", target_entity_id: "C2", relationship_type: "frobnicate" },
      ],
    });
    expect(blob()).not.toContain("INSERT INTO relationship_proposals");
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(result.relationships_proposed).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("an edge whose endpoint is not in the entity set is skipped", async () => {
    const result = await upsertSchematicComponents(TENANT, {
      entities: twoEntities,
      relationships: [
        { source_entity_id: "C1", target_entity_id: "MISSING", relationship_type: "WIRED_TO" },
      ],
    });
    expect(blob()).not.toContain("INSERT INTO relationship_proposals");
    expect(result.relationships_proposed).toBe(0);
  });

  test("entities are still upserted (nodes), only edges become proposals", async () => {
    await upsertSchematicComponents(TENANT, {
      entities: twoEntities,
      relationships: [],
    });
    const entityInserts = executed.filter((e) => e.sql.includes("INSERT INTO kg_entities"));
    expect(entityInserts).toHaveLength(2);
  });
});
