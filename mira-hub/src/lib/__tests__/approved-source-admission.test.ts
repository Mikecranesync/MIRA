/**
 * Workstream A — server-derived approved source admission (#3437 / #3468).
 * PRD: docs/prd/2026-08-29-technician-beta-recovery-prd.md §7.2 / §7.4.
 *
 * Unit-level contract (SQL shape + call-site authority). The behavioural
 * matrix against a real Postgres is approved-source-admission.integration.test.ts.
 *
 * Run: cd mira-hub && npx vitest run src/lib/__tests__/approved-source-admission
 *
 * Rules:
 *  - under the approval gate, retrieveNodeChunks admits a v2 chunk when
 *    `verified = true` (shared-corpus rule) OR when it is a tenant-private row
 *    whose doc_id is in the SERVER-derived approved set — as a SQL predicate on
 *    both retrieval lanes, never app-side;
 *  - the approved set is intersected with the validated doc scope (it can
 *    narrow, never widen), and is a no-op when the gate is off;
 *  - with no approved set the predicate is byte-identical to before
 *    (`AND verified = true`) — the Hub NodeChat path is unchanged (case 11);
 *  - the notebook chat route passes validateChatSources' OUTPUT (the derived
 *    set), never the client's requested ids (§6.4 server-owned admission);
 *  - admin namespace verification keeps its documented governance behaviour:
 *    it flips namespace_direct_uploads.verified (retention) and touches no
 *    knowledge_entries row (case 10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "../manual-rag";

const T = "11111111-1111-4111-8111-111111111111";
const DOC_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC_B = "bbbbbbbb-0000-4000-8000-000000000002";
const DOC_FORGED = "ffffffff-0000-4000-8000-00000000000f";

type Call = { sql: string; params: unknown[] };

function makeClient(): { client: PoolClient; calls: Call[] } {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const ADMISSION_RE = /verified = true OR \(is_private = true AND doc_id = ANY\(\$(\d+)::uuid\[\]\)\)/;

afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
});

describe("retrieveNodeChunks approvedSourceDocIds — SQL admission predicate", () => {
  beforeEach(() => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  });

  it("admits tenant-private rows of the approved set OR verified rows, bound as a uuid[] param on BOTH lanes", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "what does F004 mean", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DOC_A, DOC_B],
      approvedSourceDocIds: [DOC_A, DOC_B],
      validatedDocScope: true,
    });
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      const m = r.sql.match(ADMISSION_RE);
      expect(m, r.sql).toBeTruthy();
      // The bare gate must be gone — otherwise the OR branch is dead code.
      expect(r.sql).not.toMatch(/AND verified = true\s*\n/);
      const idx = Number(m![1]) - 1;
      expect(r.params[idx]).toEqual([DOC_A, DOC_B]);
    }
    const bm25 = reads.find((r) => /ts_rank_cd/.test(r.sql))!;
    const exact = reads.find((r) => /ILIKE ANY/.test(r.sql))!;
    expect(bm25).toBeTruthy();
    expect(exact).toBeTruthy();
    // Tenant ownership stays a first-class predicate on the same row.
    expect(bm25.sql).toContain("WHERE tenant_id = $1");
    expect(exact.sql).toContain("WHERE tenant_id = $1");
  });

  it("intersects the approved set with the validated doc scope — it can narrow, never widen (case 9)", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "q", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DOC_A],
      approvedSourceDocIds: [DOC_A, DOC_FORGED],
      validatedDocScope: true,
    });
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    for (const r of reads) {
      const m = r.sql.match(ADMISSION_RE)!;
      expect(r.params[Number(m[1]) - 1]).toEqual([DOC_A]);
    }
  });

  it("falls back to the bare global rule when the intersection is empty (fail-closed)", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "q", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DOC_A],
      approvedSourceDocIds: [DOC_FORGED],
      validatedDocScope: true,
    });
    for (const r of calls.filter((c) => /FROM knowledge_entries/.test(c.sql))) {
      expect(r.sql).not.toMatch(ADMISSION_RE);
      expect(r.sql).toContain("AND verified = true");
    }
  });

  it("case 11: with NO approved set the predicate is byte-identical to the pre-existing gate (NodeChat unchanged)", async () => {
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "q", { nodeId: "n1", unsPath: null, docIds: [DOC_A] });
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    for (const r of reads) {
      expect(r.sql).toContain("AND verified = true");
      expect(r.sql).not.toMatch(ADMISSION_RE);
      expect(r.sql).not.toContain("is_private");
    }
    // …and the docIds predicate/param layout is exactly the Gate D shape.
    const bm25 = reads.find((r) => /ts_rank_cd/.test(r.sql))!;
    expect(bm25.sql).toContain("doc_id = ANY($5::uuid[])");
    expect(bm25.params).toHaveLength(5);
  });

  it("is a no-op when the approval gate is off", async () => {
    delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "q", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DOC_A],
      approvedSourceDocIds: [DOC_A],
      validatedDocScope: true,
    });
    for (const r of calls.filter((c) => /FROM knowledge_entries/.test(c.sql))) {
      expect(r.sql).not.toContain("verified = true");
      expect(r.sql).not.toContain("is_private");
    }
  });
});
