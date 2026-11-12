/**
 * Garage pilot PR-6 (plan row 16-A) — the document list reports the
 * `extraction_version` its stored chunks carry, as the read-back the staging
 * gate uses after a reprocess: a document whose chunks ALL carry the current
 * stamp reports it; a document with ANY unstamped (pre-PR-1, flat) chunk
 * reports null — "old flat rows present". A bare min() would skip the NULLs
 * and report 2 for a half-reprocessed document, the exact state this exists
 * to catch.
 *
 * Harness mirrors notebook-source-unreadable-pages.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-source-extraction-version.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

const db = vi.hoisted(() => ({
  countsRow: {} as Record<string, unknown>,
  sql: [] as string[],
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) => {
        db.sql.push(sql);
        if (/FROM equipment_notebook_sources/.test(sql)) {
          return { rows: [{ doc_id: DOC, enabled_by_default: true, match_state: "user_confirmed", source_role: null, match_evidence: null, origin_file_id: null }] };
        }
        return { rows: [] };
      }),
    }),
  ),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      db.sql.push(sql);
      if (/FROM hub_uploads/.test(sql)) return { rows: [{ id: DOC, filename: "gs10.pdf", status: "parsed", kb_chunk_count: 40, file_id: "f1" }] };
      if (/FROM knowledge_entries/.test(sql)) return { rows: [{ doc_id: DOC, n: 40, emb: 40, anchored: 40, unreadable_pages: 0, ...db.countsRow }] };
      return { rows: [] };
    }),
  },
}));

import { listSources } from "@/lib/equipment-notebooks";

beforeEach(() => {
  db.sql.length = 0;
  db.countsRow = {};
});

describe("listSources reports the extraction version of a document's stored chunks", () => {
  it("every chunk stamped 2 → 2, computed as null-when-any-unstamped, else the minimum", async () => {
    db.countsRow = { extraction_version: 2 };
    const [src] = await listSources(TENANT, NB);
    expect(src!.extractionVersion).toBe(2);
    const counts = db.sql.find((s) => /FROM knowledge_entries/.test(s))!;
    expect(counts).toMatch(/extraction_version/);
    // The gate's instrument: a mixed document must read as "old rows present".
    expect(counts).toMatch(/FILTER \(WHERE metadata->>'extraction_version' IS NULL\)/);
    expect(counts).toMatch(/min\(\(metadata->>'extraction_version'\)::int\)/);
  });

  it("any unstamped chunk (a pre-PR-1 flat row still present) → null, never the stamped rows' version", async () => {
    db.countsRow = { extraction_version: null };
    const [src] = await listSources(TENANT, NB);
    expect(src!.extractionVersion).toBeNull();
  });
});
