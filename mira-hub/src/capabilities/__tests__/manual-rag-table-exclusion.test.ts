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

  // Mike's ruling 2026-11-12 (pilot harness L8, pre-registered bar "refuse"): a question
  // in a project with a confirmed catalog number that names ANOTHER number of the
  // record's family is about a different unit. Nothing is retrieved, the record is not
  // suspended into answering for the sibling, and the reason is reported so the reply
  // names both numbers. On staging 5e79ca713 this ask answered GS13N's own 1.9 A / 2.2 A.
  describe("a question naming a sibling of the record's family is refused, not answered from the sibling's column", () => {
    const heading = "DURApulse GS10 Drive User Manual\nModels covered: GS11N-20P2, GS13N-20P2";
    const rows = () => [[{ ...siblingColumn, document_heading: heading }, { ...ownColumn, document_heading: heading }]];

    it("retrieves nothing and reports siblingOfRecordAsk with both numbers; the record is not scoped by", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS13N-20P2?", scoped({ diagnostics }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
      expect(diagnostics.recordNumber).toBeNull();
      expect(diagnostics.excludedTables).toBeUndefined();
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });

    it("a sibling named in an earlier open question carries into this one and is refused the same way", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "and its VT rated current?", scoped({ diagnostics, subjectQueries: ["What is the rated input current of the GS13N-20P2?"] }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
    });

    it("control: after a refused sibling ask, a question naming the record's OWN number is served (the carry stops at a named model)", async () => {
      // The refused turn stays in the open run (conversation-subject.ts closes a run only on an
      // answered document-based turn), so a bare follow-up would still carry GS13N. A question
      // that names the record's own number disables the carry (earlierQuestions is empty when
      // the question itself names a known model) and must answer from the record's column.
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS11N-20P2?", scoped({ diagnostics, subjectQueries: ["What is the rated input current of the GS13N-20P2?"] }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(diagnostics.recordNumber).toBe("GS11N-20P2");
      expect(out.map((c) => c.content)).toContain(ownColumn.content);
      expect(out.map((c) => c.content)).not.toContain(siblingColumn.content);
    });

    it("a question naming the record's own number beside a sibling is refused too (no other model's value)", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "Is the GS13N-20P2 input current higher than the GS11N-20P2?", scoped({ diagnostics }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
    });

    it("control: without a catalog number on record the sibling question is answered as before", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS13N-20P2?", scoped({ diagnostics, catalogNumber: null }));
      expect(out.map((c) => c.content)).toContain(siblingColumn.content);
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
    });

    it("a safety-stop pass opts out (siblingAsk: \"serve\"): the record is suspended and the sibling's page is served, so a lockout page is never withheld", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS13N-20P2?", scoped({ diagnostics, siblingAsk: "serve" }));
      expect(out.map((c) => c.content)).toContain(siblingColumn.content);
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(diagnostics.recordNumber).toBeNull();
      expect(diagnostics.excludedTables).toBeUndefined();
    });

    // Codex r1 on #5451 (F1, MEDIUM): an unresolved table whose tags are numbers of ANOTHER family
    // (parameter codes, accessory parts) is nobody's look-alike; for this record it is ordinary
    // text and must be served, or a confirmed drive loses every parameter value in its manual.
    // The record's own family's unresolved table (p.394 shape) stays withheld.
    it("an unresolved table tagged with another family's numbers (parameter codes) is served to the confirmed record; the record's family's unresolved table is still withheld", async () => {
      const parameterTable = {
        ...ownColumn, source_page: 227, page_start: 227, table_models: ["P0663", "P0664", "P0665"], table_unqualified: true,
        content: "Parameter Default Minimum Maximum\nP06.63 1000 560 120\nP06.64 0 1 2\nP06.65 0 1000 560\n",
      };
      const familyUnresolved = {
        ...ownColumn, source_page: 394, page_start: 394, table_models: ["GS11N20P2", "GS13N20P2"], table_unqualified: true,
        content: "Model Ø Volts VT Rated Current Arms\nGS11N-20P2 1 230 1.8\nGS13N-20P2 3 230 2.2\n",
      };
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient([[parameterTable, familyUnresolved, ownColumn]]);
      const out = await retrieveNodeChunks(client, "t-1", "What is the default of P06.63?", scoped({ diagnostics }));
      expect(out.map((c) => c.content)).toContain(parameterTable.content);
      expect(out.map((c) => c.content)).not.toContain(familyUnresolved.content);
      expect(diagnostics.excludedTables).toEqual([{ page: 394, models: ["GS11N20P2", "GS13N20P2"], unqualified: true }]);
    });

    it("control: a number of another family in the question (a relay part) is not this rule's business", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient([[ownColumn, prose]]);
      const out = await retrieveNodeChunks(client, "t-1", "Does the CA3KN22BD relay need its own supply?", scoped({ diagnostics }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(out.length).toBeGreaterThan(0);
    });
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
