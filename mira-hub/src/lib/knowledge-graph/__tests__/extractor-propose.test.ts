import { beforeEach, describe, expect, test, vi } from "vitest";

// Prove the conversation entity extractor PROPOSES (relationship_proposals via
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
      if (sql.includes("INSERT INTO kg_entities"))
        return { rows: [{ id: `kg-${params[2]}` }], rowCount: 1 };
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

import { extractAndStore } from "../extractor";

const TENANT = "00000000-0000-0000-0000-000000000001";
const blob = () => executed.map((e) => e.sql).join("\n");

describe("extractAndStore — proposes, never auto-verifies (#1721)", () => {
  beforeEach(() => reset());

  test("regex-extracted edges become proposals, not kg_relationships inserts", async () => {
    const result = await extractAndStore(
      TENANT,
      "AC-7",
      "VFD-07 had fault F005, replaced part IR-39868252",
      "conv-1",
      { llmRelationships: false }, // skip LLM Pass 2 — regex pass only
    );
    expect(blob()).toContain("INSERT INTO relationship_proposals");
    expect(blob()).toContain("INSERT INTO kg_triples_log"); // audit trail kept
    expect(blob()).not.toContain("INSERT INTO kg_relationships");
    expect(result.relationships).toBe(0);
    // mentioned_tag (VFD-07) + exhibited_fault (F005) + requires_part (IR-39868252)
    expect(result.relationshipsProposed).toBe(3);
  });

  test("proposes canonical types: HAS_TAG, HAS_FAILURE_MODE, HAS_PART", async () => {
    await extractAndStore(
      TENANT,
      "AC-7",
      "VFD-07 had fault F005, replaced part IR-39868252",
      "conv-1",
      { llmRelationships: false },
    );
    const types = executed
      .filter((e) => e.sql.includes("INSERT INTO relationship_proposals"))
      .map((e) => (e.params as unknown[])[5]);
    expect(types).toContain("HAS_TAG");
    expect(types).toContain("HAS_FAILURE_MODE");
    expect(types).toContain("HAS_PART");
  });
});
