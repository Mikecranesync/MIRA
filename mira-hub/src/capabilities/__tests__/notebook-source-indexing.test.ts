/**
 * Garage pilot M8 (plan row PR-5) — a document whose chunks are not all
 * embedded yet reports `enhancing` ("still indexing") rather than fully ready.
 * Embed-on-write is fire-and-forget (`void embedPendingNodeChunks`), so a
 * question asked right after an upload runs on word search alone; the list is
 * what tells the sheet to keep polling and to say so. When embeds are switched
 * off (NODE_EMBED_ON_WRITE=0) nothing will ever embed, so the document must NOT
 * be reported as indexing forever: it is chat_ready_basic.
 *
 * Harness mirrors notebook-source-unreadable-pages.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/notebook-source-indexing.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

const db = vi.hoisted(() => ({
  countsRow: { n: 40, emb: 40, anchored: 40 } as Record<string, unknown>,
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
      if (/FROM knowledge_entries/.test(sql)) return { rows: [{ doc_id: DOC, unreadable_pages: 0, ...db.countsRow }] };
      return { rows: [] };
    }),
  },
}));

async function sources() {
  const { listSources } = await import("@/lib/equipment-notebooks");
  return listSources(TENANT, NB);
}

beforeEach(() => {
  db.sql.length = 0;
  db.countsRow = { n: 40, emb: 40, anchored: 40 };
  vi.resetModules();
  delete process.env.NODE_EMBED_ON_WRITE;
});
afterEach(() => {
  delete process.env.NODE_EMBED_ON_WRITE;
});

describe("listSources reports a document as still indexing until every chunk is embedded", () => {
  it("20 of 40 chunks embedded → enhancing (askable, improving)", async () => {
    db.countsRow = { n: 40, emb: 20, anchored: 40 };
    const [src] = await sources();
    expect(src!.readiness.state).toBe("enhancing");
    expect(src!.readiness.canChat).toBe(true);
  });

  it("control: 40 of 40 → chat_ready_enhanced", async () => {
    const [src] = await sources();
    expect(src!.readiness.state).toBe("chat_ready_enhanced");
  });

  it("with embed-on-write switched off, an unembedded document is chat_ready_basic, never 'indexing'", async () => {
    process.env.NODE_EMBED_ON_WRITE = "0";
    db.countsRow = { n: 40, emb: 0, anchored: 40 };
    const [src] = await sources();
    expect(src!.readiness.state).toBe("chat_ready_basic");
    expect(src!.readiness.canChat).toBe(true);
  });
});
