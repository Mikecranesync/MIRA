/**
 * Gate D (isolation) at the retrieval layer — the allowed-doc set is enforced
 * in SQL, never by app-side filtering. PRD §12 hard requirements 3 & 4.
 * Run: npx vitest run src/lib/__tests__/notebook-isolation.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../manual-rag";

type Call = { sql: string; params: unknown[] };

function client(rowsPerCall: Record<string, unknown>[][]) {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      // kg_entities subtree probe returns [] (no unsPath given ⇒ not called);
      // retrieval passes return scripted rows.
      return { rows: rowsPerCall[i++] ?? [] };
    }),
  };
}

const DOC_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC_B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("retrieveNodeChunks docIds enforcement (Gate D)", () => {
  it("emits an ANY(uuid[]) doc predicate bound to EXACTLY the allowed set, on the retrieval query", async () => {
    const c = client([
      [
        {
          content: "F004 is undervoltage.",
          doc_id: DOC_A,
          source_url: `node-doc/${DOC_A}/pf525.pdf`,
          source_page: 87,
          page_start: 87,
          section_path: null,
          filename: "pf525.pdf",
          verified: true,
          rank: 0.9,
        },
      ],
    ]);
    const chunks = await retrieveNodeChunks(c as never, "t1", "what does F004 mean", {
      nodeId: "n1",
      unsPath: null, // standalone notebook node — no subtree expansion
      docIds: [DOC_A],
    });
    const retrieval = c.calls.find((q) => /FROM knowledge_entries/.test(q.sql));
    expect(retrieval).toBeTruthy();
    // The doc filter is a SQL predicate, applied in-query (not post-filter).
    expect(retrieval!.sql).toContain("doc_id = ANY($5::uuid[])");
    expect(retrieval!.sql).toContain("(metadata->>'node_id') = ANY($3::text[])");
    // Bound to exactly the allowed set — a sibling doc id is not present.
    expect(retrieval!.params[4]).toEqual([DOC_A]);
    expect(retrieval!.params[4]).not.toContain(DOC_B);
    // The returned chunk carries doc_id for per-citation attribution.
    expect(chunks[0].docId).toBe(DOC_A);
  });

  it("omits the doc predicate entirely when no docIds are supplied (unchanged node behavior)", async () => {
    const c = client([[]]);
    await retrieveNodeChunks(c as never, "t1", "q", { nodeId: "n1", unsPath: null });
    const retrieval = c.calls.find((q) => /FROM knowledge_entries/.test(q.sql));
    expect(retrieval!.sql).not.toContain("doc_id = ANY");
    expect(retrieval!.params).toHaveLength(4); // no $5
  });
});
