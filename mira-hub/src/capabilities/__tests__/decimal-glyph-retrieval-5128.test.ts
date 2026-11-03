// #5128 / #5130 — a GS1 chunk stored as "Default Setting: 30�0 sec" must
// leave retrieval as "30.0 sec", so the prompt, the citation quote and the
// claim verifier all read the number the manual prints.
import { describe, it, expect, vi } from "vitest";

const rerankInputs: string[][] = [];
vi.mock("@/lib/notebook-query", async (orig) => {
  const actual = await orig<typeof import("@/lib/notebook-query")>();
  return {
    ...actual,
    rerankChunks: ((expanded: unknown, cands: Array<{ content: string }>, o: unknown) => {
      rerankInputs.push(cands.map((c) => c.content));
      return (actual.rerankChunks as (...a: unknown[]) => unknown)(expanded, cands, o);
    }) as typeof actual.rerankChunks,
  };
});

import { retrieveCitedPageChunks, retrieveManualChunks, retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = "00000000-0000-0000-0000-000000000001";
const GARBLED = "P01�02 Decel Time 1 Range: 0�1 to 600�0 sec Default Setting: 30�0 sec";
const ROW = {
  id: "00000000-0000-0000-0000-0000000000aa",
  doc_id: "d1",
  content: GARBLED,
  source_url: "gs1-ch4.pdf",
  source_page: 9,
  page_start: 9,
  page: 9,
  manufacturer: "AutomationDirect",
  model_number: "GS1",
  rank: 1,
  metadata: { chunk_index: 3 },
};

function clientReturning(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn(async (sql: string) =>
      /FROM\s+knowledge_entries\b/.test(sql) ? { rows } : { rows: [] },
    ),
  };
}

describe("retrieval restores the period lost between digits (#5128)", () => {
  it("retrieveManualChunks hands back 30.0, not the stored glyph", async () => {
    const client = clientReturning([ROW]);
    const chunks = await retrieveManualChunks(client as never, TENANT, "GS1 decel time default", {
      manufacturer: "AutomationDirect",
    });
    expect(client.query).toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content).toContain("Default Setting: 30.0 sec");
      expect(c.content).toContain("P01.02");
      expect(c.content).not.toContain("�");
    }
  });

  it("retrieveCitedPageChunks hands back 30.0 to the cited-page read", async () => {
    const client = clientReturning([ROW]);
    const out = await retrieveCitedPageChunks(client as never, TENANT, [
      { docId: "d1", sourceUrl: "gs1-ch4.pdf", page: 9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("P01.02 Decel Time 1 Range: 0.1 to 600.0 sec Default Setting: 30.0 sec");
  });

  it("retrieveNodeChunks (notebook chat) scores and returns 30.0", async () => {
    rerankInputs.length = 0;
    const client = clientReturning([ROW]);
    const chunks = await retrieveNodeChunks(client as never, TENANT, "decel time default", {
      nodeId: "n1",
      unsPath: null,
      docIds: ["d1"],
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.content).toContain("Default Setting: 30.0 sec");
    expect(rerankInputs.length).toBeGreaterThan(0);
    for (const batch of rerankInputs) for (const t of batch) expect(t).not.toContain("\uFFFD");
  });
});
