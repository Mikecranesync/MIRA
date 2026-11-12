import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

/**
 * Look-alike passages are EXCLUDED, never demoted (garage pilot plan row 2-B/2-C; ledger L3/L4).
 *
 * Inside one admitted manual, the GS13N (three-phase) specification table is as retrievable as the
 * GS11N table, and on staging it supplied 9 of the 22 wrong rated-current answers and every "460 V"
 * supply-voltage answer for a GS11N-20P2 drive. The record's catalog number was used only to judge a
 * DOCUMENT's cover (manual-rag.ts admit), never a passage.
 *
 * Contract, inside the ONE admission predicate (`admit`), only when the notebook's identity is
 * confirmed AND the record holds a catalog number:
 *   - a chunk whose `metadata.table_models` (stamped at upload, table-rows.ts) is non-empty and does
 *     not include the record's exact key (uppercase alphanumerics) is excluded;
 *   - a chunk with NO table tag whose text names other numbers of the record's family
 *     (manual-applicability's `modelNumbersIn` + `sameModelFamily`) and NOT the record's own number
 *     is excluded (the flat sibling table stored by the old extraction);
 *   - every other chunk (prose, the record's own column, a page naming both) is kept unchanged;
 *   - the exact catalog number is added as one lexical boost term, so BM25 finds the own-column chunk;
 *   - the exclusions are reported in `diagnostics.excludedTables` (page + models) so the answer path
 *     can refuse by name ("this manual's table for GS11N-20P2 was not found — open page N") instead
 *     of answering from a sibling.
 * Without a catalog number on record nothing changes (do-not-regress).
 */

function makeClient(scriptedRows: Array<Record<string, unknown>[]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)") || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return { rows: [] };
    return { rows: scriptedRows.shift() ?? [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const base = {
  source_url: "node-doc/u1/gs10usermanual.pdf", filename: "gs10usermanual.pdf", doc_id: "d-1",
  document_heading: "DURApulse GS10 Drive User Manual", section_path: null, rank: 0.4,
};
const ownColumn = {
  ...base, source_page: 26, page_start: 26, table_models: ["GS11N20P2"],
  content: "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — GS11N-20P2\nGS11N-20P2: CT Rated Input Current 5.1 A\nGS11N-20P2: VT Rated Input Current 5.8 A\n",
};
const siblingColumn = {
  ...base, source_page: 27, page_start: 27, table_models: ["GS13N20P2"],
  content: "230V Class – 3-Phase Model-Specific Specifications — Model Name: GS13N-2xPx — GS13N-20P2\nGS13N-20P2: CT Rated Input Current 1.9 A\nGS13N-20P2: VT Rated Input Current 2.2 A\n",
};
const prose = {
  ...base, source_page: 40, page_start: 40, table_models: null,
  content: "Rated input current is measured at the drive's input terminals with the motor at rated load.",
};
const flatSiblingTable = {
  ...base, source_page: 27, page_start: 27, table_models: null,
  content: "Model Name: GS13N-2xPx GS13N-20P2 GS13N-20P5 GS13N-21P0 GS13N-22P0\nCT Rated Input Current A 1.9 3.4 5.8 9.0",
};
const bothNamed = {
  ...base, source_page: 5, page_start: 5, table_models: null,
  content: "Ordering: GS11N-20P2 (one-phase 230 V) and GS13N-20P2 (three-phase 230 V) share frame size A1.",
};
// A line of the record's OWN table that the layout parser could not tie to a column (table-rows.ts
// keeps it as flat text, tagged with every model of the block and `table_unqualified`). On the real
// GS10 page 26 that is "Cooling Method Convective Fan": two values across five columns, the drive's
// own value unknowable from the line. Gate 7 (cheap lane r4 on #5429, HIGH): such a chunk carried
// the record's key, so it was admitted, and its flat values could answer for the record.
const unresolvedOwnRow = {
  ...base, source_page: 26, page_start: 26, table_unqualified: true,
  table_models: ["GS11N20P2", "GS11N20P5", "GS11N21P0", "GS11N22P0", "GS11N23P0"],
  content: "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — unqualified\nCooling Method Convective Fan\n",
};

const scoped = (extra: Record<string, unknown> = {}) => ({
  nodeId: "n-1", unsPath: null, docIds: ["d-1"], validatedDocScope: true,
  identity: { manufacturer: "AutomationDirect", model: "GS10" }, identityStatus: "user_confirmed" as const,
  catalogNumber: "GS11N-20P2", ...extra,
});

describe("retrieveNodeChunks excludes another model's table passages when the record holds a catalog number", () => {
  it("selects the table tag and boosts the exact catalog number", async () => {
    const { client, calls } = makeClient([[ownColumn]]);
    await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped());
    const lane = calls.find((c) => /knowledge_entries/.test(c.sql) && /content/.test(c.sql));
    expect(lane).toBeDefined();
    expect(lane!.sql).toMatch(/table_models/);
    expect(lane!.sql).toMatch(/table_unqualified/);
    expect(JSON.stringify(calls.map((c) => c.params))).toMatch(/GS11N-20P2|GS11N20P2/i);
  });

  it("keeps the record's own column and prose, drops the sibling's tagged column", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient([[siblingColumn, ownColumn, prose]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped({ diagnostics }));
    expect(out.map((c) => c.content)).toEqual([ownColumn.content, prose.content]);
    expect(diagnostics.excludedTables).toEqual([{ page: 27, models: ["GS13N20P2"] }]);
  });

  it("the kept chunks carry their table tag as exact keys, so the answer path's shadow verifier can bind by row (PR-4)", async () => {
    const { client } = makeClient([[ownColumn, prose]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped());
    expect(out.map((c) => c.tableModels)).toEqual([["GS11N20P2"], []]);
  });

  it("drops an untagged flat passage that names only sibling numbers of the family", async () => {
    const { client } = makeClient([[flatSiblingTable, ownColumn]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped());
    expect(out.map((c) => c.content)).toEqual([ownColumn.content]);
  });

  it("keeps an untagged passage that names the record's own number beside a sibling", async () => {
    const { client } = makeClient([[bothNamed]]);
    const out = await retrieveNodeChunks(client, "t-1", "What frame size is it?", scoped());
    expect(out.map((c) => c.content)).toEqual([bothNamed.content]);
  });

  it("returns nothing, with the exclusion reported, when only sibling tables matched", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient([[siblingColumn, flatSiblingTable]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped({ diagnostics }));
    expect(out).toEqual([]);
    expect(diagnostics.excludedTables).toEqual([{ page: 27, models: ["GS13N20P2"] }, { page: 27, models: ["GS13N20P2", "GS13N20P5", "GS13N21P0", "GS13N22P0"] }]);
  });

  it("changes nothing without a catalog number on record, or with an unconfirmed identity", async () => {
    let c = makeClient([[siblingColumn, ownColumn, flatSiblingTable, prose]]);
    let out = await retrieveNodeChunks(c.client, "t-1", "What is its rated input current?", scoped({ catalogNumber: null }));
    expect(out).toHaveLength(4);
    c = makeClient([[siblingColumn, ownColumn, flatSiblingTable, prose]]);
    out = await retrieveNodeChunks(c.client, "t-1", "What is its rated input current?", scoped({ identityStatus: "candidate" }));
    expect(out).toHaveLength(4);
  });

  it("the exclusion is keyed on the exact number, not the family: a GS11N-20P5 record drops the 20P2 column", async () => {
    const { client } = makeClient([[ownColumn, prose]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its rated input current?", scoped({ catalogNumber: "GS11N-20P5" }));
    expect(out.map((c) => c.content)).toEqual([prose.content]);
  });

  it("reports the record number it scoped by — null when the question suspended it — so the shadow verifier is gated exactly as the exclusion was (PR-4)", async () => {
    const heading = "DURApulse GS10 Drive User Manual\nModels covered: GS11N-20P2, GS13N-20P2";
    let diagnostics: Record<string, unknown> = {};
    let c = makeClient([[ownColumn, prose]]);
    await retrieveNodeChunks(c.client, "t-1", "What is its rated input current?", scoped({ diagnostics }));
    expect(diagnostics.recordNumber).toBe("GS11N-20P2");
    diagnostics = {};
    c = makeClient([[{ ...siblingColumn, document_heading: heading }, { ...ownColumn, document_heading: heading }]]);
    await retrieveNodeChunks(c.client, "t-1", "What is the rated input current of the GS13N-20P2?", scoped({ diagnostics }));
    expect(diagnostics.recordNumber).toBeNull();
    diagnostics = {};
    c = makeClient([[ownColumn, prose]]);
    await retrieveNodeChunks(c.client, "t-1", "What is its rated input current?", scoped({ diagnostics, identityStatus: "candidate" }));
    expect(diagnostics.recordNumber).toBeNull();
  });

  it("a question that itself names a sibling of the family is judged by the existing cover rule, not by the record's table", async () => {
    // The technician may deliberately ask about the sibling. A manual whose cover
    // lists both numbers answers for the sibling; the record's own column is not
    // the subject and the sibling's column must not be thrown away.
    const heading = "DURApulse GS10 Drive User Manual\nModels covered: GS11N-20P2, GS13N-20P2";
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient([[{ ...siblingColumn, document_heading: heading }, { ...ownColumn, document_heading: heading }]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS13N-20P2?", scoped({ diagnostics }));
    expect(out.map((c) => c.content)).toContain(siblingColumn.content);
    expect(diagnostics.excludedTables).toBeUndefined();
  });

  // These two run last on purpose: the scripted mock hands its one row set to whichever lane
  // queries first, and which lane that is depends on process-level state the earlier tests warm.
  it("drops a line of the record's own table that the parser could not tie to a column, and reports it as unresolved, not as a sibling's table", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient([[unresolvedOwnRow, ownColumn, prose]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its cooling method?", scoped({ diagnostics }));
    expect(out.map((c) => c.content)).toEqual([ownColumn.content, prose.content]);
    expect(diagnostics.excludedTables).toEqual([{ page: 26, models: unresolvedOwnRow.table_models, unqualified: true }]);
  });

  it("keeps the unresolved line when no catalog number is on record (do-not-regress)", async () => {
    const { client } = makeClient([[unresolvedOwnRow, prose]]);
    const out = await retrieveNodeChunks(client, "t-1", "What is its cooling method?", scoped({ catalogNumber: null }));
    expect(out.map((c) => c.content)).toEqual([unresolvedOwnRow.content, prose.content]);
  });
});
