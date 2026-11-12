/**
 * Garage pilot L2 (plan row 5-A) — the document list counts the pages whose
 * numbers could not be read (chunks stamped text_repair: unmapped_glyph at
 * ingest) as `unreadablePages` on each source row, next to its readiness.
 * Readiness itself is unchanged: a document with unreadable numbers is still
 * askable; the count is what tells the technician "N pages did not read cleanly".
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-source-unreadable-pages.test.ts
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
      if (/FROM hub_uploads/.test(sql)) return { rows: [{ id: DOC, filename: "ch1.pdf", status: "parsed", kb_chunk_count: 40, file_id: "f1" }] };
      if (/FROM knowledge_entries/.test(sql)) return { rows: [{ doc_id: DOC, n: 40, emb: 40, anchored: 40, ...db.countsRow }] };
      return { rows: [] };
    }),
  },
}));

import { listSources } from "@/lib/equipment-notebooks";

beforeEach(() => {
  db.sql.length = 0;
  db.countsRow = {};
});

describe("listSources reports the pages whose numbers could not be read", () => {
  it("counts the pages flagged unmapped_glyph (ch1.pdf: 11 of 18) and leaves readiness askable", async () => {
    db.countsRow = { unreadable_pages: 11 };
    const [src] = await listSources(TENANT, NB);
    expect(src).toBeDefined();
    expect(src!.unreadablePages).toBe(11);
    expect(src!.readiness.canChat).toBe(true);
    expect(src!.readiness.state).toBe("chat_ready_enhanced");
    const counts = db.sql.find((s) => /FROM knowledge_entries/.test(s))!;
    expect(counts).toMatch(/unmapped_glyph/);
    expect(counts).toMatch(/DISTINCT source_page/);
  });

  it("control: a clean manual reports 0", async () => {
    db.countsRow = { unreadable_pages: 0 };
    const [src] = await listSources(TENANT, NB);
    expect(src!.unreadablePages).toBe(0);
  });
});
