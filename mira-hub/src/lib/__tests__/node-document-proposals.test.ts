import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { proposeDocumentEdgesForNodeTx } from "../node-document-proposals";

// Scripted mock client: each query() shifts the next scripted result, recording
// the SQL + params (same shape as src/lib/__tests__/manual-rag.test.ts).
function makeClient(scripted: Array<{ rows: Array<Record<string, unknown>>; rowCount?: number }>): {
  client: PoolClient;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    const next = scripted.shift() ?? { rows: [] };
    return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const BASE = {
  tenantId: "t-1",
  uploadId: "up-1",
  nodeId: "node-1",
  unsPath: "enterprise.site.line.vfd_07",
  filename: "PowerFlex 525 Manual.pdf",
  chunkCount: 7,
};

describe("proposeDocumentEdgesForNodeTx", () => {
  it("proposes HAS_DOCUMENT node→manual with document_page evidence from chunks", async () => {
    const { client, calls } = makeClient([
      { rows: [{ entity_type: "equipment" }] }, // node lookup
      { rows: [{ id: "manual-kg-1" }] }, // upsert manual entity
      { rows: [ // chunk evidence
        { id: "chunk-a", content: "Set torque to 35 ft-lbs.", source_page: 4 },
        { id: "chunk-b", content: "Fault F004 indicates overcurrent.", source_page: 12 },
      ] },
      { rows: [] }, // upsertInferredProposal: relExists none
      { rows: [] }, // upsertInferredProposal: propExists none
      { rows: [{ id: "prop-1" }] }, // INSERT proposal
      { rows: [] }, // INSERT evidence #1
      { rows: [] }, // INSERT evidence #2
    ]);

    const res = await proposeDocumentEdgesForNodeTx(client, BASE);

    expect(res).toEqual({ manualEntityId: "manual-kg-1", proposalId: "prop-1", evidenceCount: 2 });

    // manual entity keyed by uploadId, entity_type 'manual'
    const upsert = calls.find((c) => c.sql.includes("INSERT INTO kg_entities"));
    expect(upsert?.params).toContain("up-1");
    expect(upsert?.sql).toContain("'manual'");

    // proposal row: HAS_DOCUMENT, proposed/rule, node→manual
    const insProp = calls.find((c) => c.sql.includes("INSERT INTO relationship_proposals"));
    expect(insProp?.params).toEqual(
      expect.arrayContaining(["t-1", "node-1", "manual-kg-1", "HAS_DOCUMENT"]),
    );

    // evidence rows are document_page
    const evRows = calls.filter((c) => c.sql.includes("INSERT INTO relationship_evidence"));
    expect(evRows).toHaveLength(2);
    expect(evRows[0].params).toContain("document_page");
  });

  it("early-exits (proposes nothing) when the node does not exist", async () => {
    const { client, calls } = makeClient([{ rows: [], rowCount: 0 }]); // node lookup → none
    const res = await proposeDocumentEdgesForNodeTx(client, BASE);
    expect(res).toEqual({ manualEntityId: null, proposalId: null, evidenceCount: 0 });
    // only the node lookup ran — no entity upsert / proposal
    expect(calls).toHaveLength(1);
  });

  it("is idempotent: dedupe by an existing open proposal yields no new evidence", async () => {
    const { client } = makeClient([
      { rows: [{ entity_type: "equipment" }] }, // node lookup
      { rows: [{ id: "manual-kg-1" }] }, // upsert manual
      { rows: [] }, // chunks (none queryable yet)
      { rows: [], rowCount: 0 }, // relExists none
      { rows: [{ "?column?": 1 }], rowCount: 1 }, // propExists → already proposed
    ]);
    const res = await proposeDocumentEdgesForNodeTx(client, BASE);
    expect(res.manualEntityId).toBe("manual-kg-1");
    expect(res.proposalId).toBeNull();
    expect(res.evidenceCount).toBe(0);
  });

  it("attaches a fallback evidence row when no chunks are queryable", async () => {
    const { client, calls } = makeClient([
      { rows: [{ entity_type: "component" }] }, // node lookup
      { rows: [{ id: "manual-kg-2" }] }, // upsert manual
      { rows: [] }, // chunks → none
      { rows: [] }, // relExists none
      { rows: [] }, // propExists none
      { rows: [{ id: "prop-2" }] }, // INSERT proposal
      { rows: [] }, // INSERT fallback evidence
    ]);
    const res = await proposeDocumentEdgesForNodeTx(client, BASE);
    expect(res.proposalId).toBe("prop-2");
    expect(res.evidenceCount).toBe(1);
    const evRows = calls.filter((c) => c.sql.includes("INSERT INTO relationship_evidence"));
    expect(evRows).toHaveLength(1);
    expect(evRows[0].params).toContain("document_page");
  });
});
