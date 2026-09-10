/**
 * Gate 1 — hybrid-corpus source admission vs NodeChat case 11.
 *
 * `/api/hub/ask` (and the manufacturer lane of asset chat) must search OEM
 * *and* the caller's own private uploads. The upload path never sets
 * `verified = true` (#3437), so a blanket `AND verified = true` hides the
 * manuals the technician just uploaded. Notebook NodeChat is the opposite:
 * with no server-derived approved set, tenant-private rows stay out
 * (approved-source-admission case 11).
 *
 * Lives in the adapter root so the new assertions are not a guarded
 * `src/lib/__tests__/**` add.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveManualChunks, retrieveNodeChunks } from "@/lib/manual-rag";

const T = "11111111-1111-4111-8111-111111111111";
const DOC_A = "aaaaaaaa-0000-4000-8000-000000000001";

const HYBRID_WHERE = "WHERE (is_private = false OR tenant_id = $1)";
const HYBRID_ADMISSION_RE =
  /AND \(verified = true OR \(is_private = true AND tenant_id = \$1\)\)/;

type Call = { sql: string; params: unknown[] };

function makeClient(): { client: PoolClient; calls: Call[] } {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
});

describe("retrieveManualChunks hybrid admission (Hub /ask)", () => {
  it("under the gate admits verified OEM OR the caller's private uploads", async () => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, T, "what does F004 mean");
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.sql, r.sql).toContain(HYBRID_WHERE);
      expect(r.sql, r.sql).toMatch(HYBRID_ADMISSION_RE);
      // Notebook admission (doc_id ANY) must not leak onto the hybrid path.
      expect(r.sql).not.toContain("doc_id = ANY");
      // Bare verified-only would hide tenant-private uploads (#3437).
      expect(r.sql).not.toMatch(/AND verified = true\s*$/m);
    }
  });

  it("is a no-op when the approval gate is off — hybrid WHERE stays", async () => {
    delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
    const { client, calls } = makeClient();
    await retrieveManualChunks(client, T, "what does F004 mean");
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.sql).toContain(HYBRID_WHERE);
      expect(r.sql).not.toMatch(HYBRID_ADMISSION_RE);
      expect(r.sql).not.toContain("AND verified = true");
    }
  });
});

describe("retrieveNodeChunks without an approved set (case 11 preserved)", () => {
  it("keeps the bare verified-only gate and does not admit by tenant membership", async () => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
    const { client, calls } = makeClient();
    await retrieveNodeChunks(client, T, "what does F004 mean", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DOC_A],
    });
    const reads = calls.filter((c) => /FROM knowledge_entries/.test(c.sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.sql).toContain("AND verified = true");
      expect(r.sql).not.toMatch(HYBRID_ADMISSION_RE);
      expect(r.sql).not.toContain("is_private");
    }
  });
});
