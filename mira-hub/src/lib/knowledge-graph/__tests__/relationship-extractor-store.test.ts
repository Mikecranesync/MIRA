import { beforeEach, describe, expect, test, vi } from "vitest";

// Prove the LLM relationship-extractor PROPOSES (relationship_proposals via
// upsertInferredProposal), never inserts kg_relationships directly (#1721).
const { executed, reset } = vi.hoisted(() => {
  const executed: { sql: string; params: unknown[] }[] = [];
  return { executed, reset: () => (executed.length = 0) };
});

vi.mock("@/lib/llm/cascade", () => ({
  cascadeComplete: async () => ({
    content: JSON.stringify({
      relationships: [
        { source: "motor", predicate: "caused_by", target: "fault1", confidence: 0.9 },
      ],
    }),
    provider: "groq",
  }),
}));

vi.mock("@/lib/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (sql.includes("FROM kg_entities"))
        return {
          rows: [
            { ref: "motor", id: "id-motor", entity_type: "component" },
            { ref: "fault1", id: "id-fault1", entity_type: "fault_code" },
          ],
          rowCount: 2,
        };
      if (sql.includes("INSERT INTO relationship_proposals"))
        return { rows: [{ id: "prop-1" }], rowCount: 1 };
      if (sql.includes("FROM kg_relationships")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM relationship_proposals")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { default: { connect: async () => client } };
});

import { extractRelationships } from "../relationship-extractor";

const TENANT = "00000000-0000-0000-0000-000000000001";
const blob = () => executed.map((e) => e.sql).join("\n");

describe("extractRelationships — proposes, never auto-verifies (#1721)", () => {
  beforeEach(() => reset());

  test("a high-confidence LLM edge becomes a proposal, not a kg_relationships insert", async () => {
    const stats = await extractRelationships(
      TENANT,
      "the motor caused fault1",
      [
        { ref: "motor", type: "component" },
        { ref: "fault1", type: "fault_code" },
      ],
      "conv-1",
    );
    expect(blob()).toContain("INSERT INTO relationship_proposals");
    expect(blob()).toContain("INSERT INTO kg_triples_log"); // audit trail kept
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(stats.storedRelationships).toBe(1);
    expect(stats.storedTriples).toBe(1);
  });

  test("caused_by is proposed as CAUSES with flipped direction (B CAUSES A)", async () => {
    await extractRelationships(
      TENANT,
      "the motor caused fault1",
      [
        { ref: "motor", type: "component" },
        { ref: "fault1", type: "fault_code" },
      ],
      "conv-1",
    );
    const prop = executed.find((e) => e.sql.includes("INSERT INTO relationship_proposals"));
    expect(prop).toBeDefined();
    // params: [tenant, source_id, source_type, target_id, target_type, rel_type, confidence, reasoning]
    const p = prop!.params as unknown[];
    expect(p).toContain("CAUSES");
    // flip: source becomes fault1 (LLM target), target becomes motor (LLM source)
    expect(p[1]).toBe("id-fault1");
    expect(p[3]).toBe("id-motor");
  });
});
