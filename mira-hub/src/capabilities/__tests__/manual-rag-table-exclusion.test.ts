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

    // CV-101 complete-machine benchmark FU-A4 (staging 6da4ab674, 2026-11-13, thread FU-A): after the
    // sibling ask above was refused, the technician said "ok back to mine, what frame size is it".
    // The refused sibling question is still open (conversation-subject.ts: a refusal leaves its
    // subject open), so the carry rule re-applied GS13N-20P2 to a turn that named no number and
    // refused it again with "Your question is about the GS13N-20P2" — and there is no way back to
    // the record without typing its catalog number. The carry itself is Mike's L8 ruling and is
    // kept by the case above. Mike's decision 2026-11-13 (option A): an explicit return to the
    // technician's own unit ends the carry; typing nothing after a sibling still means the sibling.
    describe("an explicit return to the record ('ok back to mine') ends the carry (Mike 2026-11-13, option A)", () => {
      const retrieved = (calls: Array<{ sql: string }>) => calls.filter((c) => /knowledge_entries/.test(c.sql)).length;

      it("after a refused sibling ask, 'ok back to mine' is about the record again, not the sibling", async () => {
        const diagnostics: Record<string, unknown> = {};
        const { client, calls } = makeClient(rows());
        const out = await retrieveNodeChunks(client, "t-1", "ok back to mine, what frame size is it", scoped({ diagnostics, subjectQueries: ["what about the GS13N-20P2, same thing?", "hey what supply voltage does this drive need"] }));
        expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
        expect(retrieved(calls)).toBeGreaterThan(0);
        expect(out.map((c) => c.content)).toContain(ownColumn.content);
        expect(out.map((c) => c.content)).not.toContain(siblingColumn.content);
      });

      it("a return read in an earlier open question ends the carry for the questions after it too", async () => {
        // The return itself may be refused for some other reason and stay open; the next bare
        // follow-up must not read past it to the look-alike and refuse once more.
        const diagnostics: Record<string, unknown> = {};
        const { client, calls } = makeClient(rows());
        const out = await retrieveNodeChunks(client, "t-1", "and how much does it weigh?", scoped({ diagnostics, subjectQueries: ["ok back to mine, what frame size is it", "what about the GS13N-20P2, same thing?", "hey what supply voltage does this drive need"] }));
        expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
        expect(retrieved(calls)).toBeGreaterThan(0);
        expect(out.map((c) => c.content)).toContain(ownColumn.content);
      });

      it("control: the return phrase never overrides a sibling named in the same question", async () => {
        const diagnostics: Record<string, unknown> = {};
        const { client } = makeClient(rows());
        const out = await retrieveNodeChunks(client, "t-1", "ok back to mine - what is the rated input current of the GS13N-20P2?", scoped({ diagnostics, subjectQueries: ["hey what supply voltage does this drive need"] }));
        expect(out).toEqual([]);
        expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
      });

      it("control: words that are not a return ('my other drive', 'back to the') keep the carry", async () => {
        for (const question of ["what about my other drive, same thing?", "back to the question, what is its VT rated current?"]) {
          const diagnostics: Record<string, unknown> = {};
          const { client } = makeClient(rows());
          const out = await retrieveNodeChunks(client, "t-1", question, scoped({ diagnostics, subjectQueries: ["What is the rated input current of the GS13N-20P2?"] }));
          expect(out, question).toEqual([]);
          expect(diagnostics.siblingOfRecordAsk, question).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
        }
      });

      // Codex r1 on #5464 (F1, MEDIUM): "before we go back to mine" / "do not go back to mine yet"
      // mention a return and keep the sibling — as this question and as an earlier open one.
      it("control: a negated or deferred return keeps the sibling, in this question and in an earlier one", async () => {
        const negated = [
          "before we go back to mine, what is its rated input current?",
          "do not go back to mine yet, what is its rated input current?",
          // Codex r2 on #5464 (F1): deferred or cancelled AFTER the phrase.
          "let's go back to mine later; what is its rated input current?",
          "go back to mine? No, stay on this one. What is its rated input current?",
          // Codex r3 on #5464 (F1), Mike B: the reversal in the NEXT clause cancels the return.
          "go back to mine. No, stay on this one. What is its rated input current?",
        ];
        for (const question of negated) {
          const diagnostics: Record<string, unknown> = {};
          const { client } = makeClient(rows());
          const out = await retrieveNodeChunks(client, "t-1", question, scoped({ diagnostics, subjectQueries: ["What is the rated input current of the GS13N-20P2?"] }));
          expect(out, question).toEqual([]);
          expect(diagnostics.siblingOfRecordAsk, question).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
        }
        for (const earlier of negated) {
          const diagnostics: Record<string, unknown> = {};
          const { client } = makeClient(rows());
          const out = await retrieveNodeChunks(client, "t-1", "and its VT rated current?", scoped({ diagnostics, subjectQueries: [earlier, "What is the rated input current of the GS13N-20P2?"] }));
          expect(out, earlier).toEqual([]);
          expect(diagnostics.siblingOfRecordAsk, earlier).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
        }
      });

      it("a return is a start of the open run: it is never refused as out of reach", async () => {
        const diagnostics: Record<string, unknown> = {};
        const { client, calls } = makeClient(rows());
        const out = await retrieveNodeChunks(client, "t-1", "ok back to mine, what frame size is it", scoped({ diagnostics, subjectQueries: ["what about the GS13N-20P2, same thing?"], subjectOutOfReach: true }));
        expect(diagnostics.subjectOutOfReach).toBeUndefined();
        expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
        expect(retrieved(calls)).toBeGreaterThan(0);
        expect(out.map((c) => c.content)).toContain(ownColumn.content);
      });

      it("control: without a return, a model-less question past the end of the read is still out of reach", async () => {
        const diagnostics: Record<string, unknown> = {};
        const { client, calls } = makeClient(rows());
        const out = await retrieveNodeChunks(client, "t-1", "what frame size is it", scoped({ diagnostics, subjectQueries: ["and its VT rated current?"], subjectOutOfReach: true }));
        expect(out).toEqual([]);
        expect(diagnostics.subjectOutOfReach).toBe(true);
        expect(retrieved(calls)).toBe(0);
      });
    });

    // Codex r2 on #5451 (F3, MEDIUM): "GS13N - 20P2" (spaces around the hyphen, a tablet keyboard's
    // habit) is read by the identity reader (model-token.ts accepts whitespace around that hyphen)
    // but split by the generic number reader into GS13N + 20P2, so the refusal never fired and the
    // record's own GS11N values would have answered a question about the look-alike — the exact
    // wrong-model class the pilot exists to stop. Both readers now feed the refusal.
    it("a sibling spelled with spaces around the hyphen (GS13N - 20P2) is refused the same way", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of GS13N - 20P2?", scoped({ diagnostics }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });

    it("the spaced spelling in an earlier open question carries and is refused too", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "and its VT rated current?", scoped({ diagnostics, subjectQueries: ["What is the rated input current of GS13N - 20P2?"] }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
    });

    // Codex r3 on #5451 (F3, MEDIUM): the SAME class mirrored onto the record. A record confirmed as
    // "GS11N - 20P2" (spaces around the hyphen, as typed) was read by the generic number reader alone
    // and split into GS11N + 20P2, so a GS11N-20P5 question was not a sibling of anything, its column
    // was admitted and another unit's values answered. One shared reader now reads the record and the
    // questions: the identity reader's full catalog identities, bare family roots dropped.
    it("a record confirmed with spaces around the hyphen (GS11N - 20P2) still refuses a sibling ask (GS11N-20P5)", async () => {
      const fiveColumn = { ...siblingColumn, table_models: ["GS11N20P5"], content: "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — GS11N-20P5\nGS11N-20P5: CT Rated Input Current 6.3 A\n" };
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[{ ...fiveColumn, document_heading: heading }, { ...ownColumn, document_heading: heading }]]);
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of GS11N-20P5?", scoped({ diagnostics, catalogNumber: "GS11N - 20P2" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS11N-20P5"], record: "GS11N - 20P2" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });

    it("the spaced record refuses the carried form too", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "and its VT rated current?", scoped({ diagnostics, catalogNumber: "GS11N - 20P2", subjectQueries: ["What is the rated input current of the GS13N-20P2?"] }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N - 20P2" });
    });

    it("control: the spaced record still serves its OWN column for a question naming its own number", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient(rows());
      const out = await retrieveNodeChunks(client, "t-1", "What is the rated input current of the GS11N-20P2?", scoped({ diagnostics, catalogNumber: "GS11N - 20P2" }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(out.map((c) => c.content)).toContain(ownColumn.content);
      expect(out.map((c) => c.content)).not.toContain(siblingColumn.content);
    });

    // Codex r4 on #5451 (F4, MEDIUM, a regression of the r3 reader): "Micro820 2080-LC20-20QWB" —
    // the identity reader finds the product name (MICRO820), so the identity-first reading dropped
    // the generic catalog number beside it, the sibling refusal missed, and the record's own
    // 2080-LC20-20QBB voltage row answered for the other unit. Both readers' numbers are kept; only
    // a fragment of a longer number in the same text (a bare root, a split half) is dropped.
    it("a product name beside a sibling catalog number (Micro820 2080-LC20-20QWB) does not hide the sibling", async () => {
      const cover = "Micro820 Controllers 2080-LC20-20QBB 2080-LC20-20QWB Installation Instructions";
      const qbb = {
        ...base, source_page: 15, page_start: 15, table_models: ["2080LC2020QBB"], document_heading: cover,
        content: "2080-LC20-20QBB: Power supply voltage range 20.4…26.4 V DC\n",
      };
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[qbb]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does the Micro820 2080-LC20-20QWB need?", scoped({ diagnostics, catalogNumber: "2080-LC20-20QBB" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["2080-LC20-20QWB"], record: "2080-LC20-20QBB" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });

    // Codex r5 on #5451 (F5, MEDIUM): the fragment rule compared keys across the whole text, so a
    // separately named CA3KN22BD (a prefix of the record CA3KN22BD3, and a variant sibling by the
    // reader's own rule) was dropped and the record's voltage row answered for the other unit.
    // Fragments belong to one occurrence: the identity reader's own root/full pair is the only
    // pair this reader ever collapses; every other number the text names is kept whole.
    const relayCover = "TeSys K CA3KN Control Relays CA3KN22BD CA3KN22BD3 Instruction Sheet";
    const relayRow = (model: string, volts: string) => ({
      ...base, source_page: 2, page_start: 2, table_models: [model], document_heading: relayCover,
      content: `${model}: Supply voltage ${volts} V DC\n`,
    });
    it("a separately named prefix sibling (CA3KN22BD beside the record CA3KN22BD3) is refused, not dropped as a fragment", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[relayRow("CA3KN22BD3", "24")]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does CA3KN22BD need when paired with CA3KN22BD3?", scoped({ diagnostics, catalogNumber: "CA3KN22BD3" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["CA3KN22BD"], record: "CA3KN22BD3" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });
    it("the mirror: a longer sibling (CA3KN22BD3) named beside the record CA3KN22BD is refused too", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[relayRow("CA3KN22BD", "24")]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does CA3KN22BD3 need when paired with CA3KN22BD?", scoped({ diagnostics, catalogNumber: "CA3KN22BD" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["CA3KN22BD3"], record: "CA3KN22BD" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });
    // Codex r6 on #5451: the one rule left — collapsing a shorter identity-read number into a
    // longer one as its "root" — also collapsed a separately named complete number (GS11N-20P2
    // beside record GS11N-20P2A; 6AV2124-0GC01-0AX beside 6AV2124-0GC01-0AX0), both variant
    // siblings. No rule remains: a bare family root (GS11N) pairs with no full number under
    // sameModelFamily, so keeping it costs nothing, and every complete number is kept whole.
    const variantCover = "DURApulse GS10 Drive User Manual\nModels covered: GS11N-20P2, GS11N-20P2A";
    it("a shorter identity-read number named beside its longer variant (GS11N-20P2 beside the record GS11N-20P2A) is refused", async () => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[{ ...base, table_models: ["GS11N20P2A"], document_heading: variantCover, content: "GS11N-20P2A: Supply voltage 24 V DC\n" }]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does GS11N-20P2 need when paired with GS11N-20P2A?", scoped({ diagnostics, catalogNumber: "GS11N-20P2A" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS11N-20P2"], record: "GS11N-20P2A" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });
    it("the same with identity-read Siemens order numbers (6AV2124-0GC01-0AX beside the record 6AV2124-0GC01-0AX0)", async () => {
      const cover = "SIMATIC HMI TP700 Comfort 6AV2124-0GC01-0AX0 6AV2124-0GC01-0AX Operating Instructions";
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[{ ...base, source_page: 9, page_start: 9, table_models: ["6AV21240GC010AX0"], document_heading: cover, content: "6AV2124-0GC01-0AX0: Supply voltage 24 V DC\n" }]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does 6AV2124-0GC01-0AX need when paired with 6AV2124-0GC01-0AX0?", scoped({ diagnostics, catalogNumber: "6AV2124-0GC01-0AX0" }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["6AV2124-0GC01-0AX"], record: "6AV2124-0GC01-0AX0" });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });
    // Controls for the two r6 record shapes: the longer number asked by its own name is served.
    // Without these, a reader that dropped the LONGER number (or refused every variant pair)
    // would pass the two must-refuse cells above.
    it("control: the longer variant record (GS11N-20P2A) asked by its own number is served", async () => {
      const diagnostics: Record<string, unknown> = {};
      const row = { ...base, table_models: ["GS11N20P2A"], document_heading: variantCover, content: "GS11N-20P2A: Supply voltage 24 V DC\n" };
      const { client, calls } = makeClient([[row]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does GS11N-20P2A need?", scoped({ diagnostics, catalogNumber: "GS11N-20P2A" }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(out.map((c) => c.content)).toEqual([row.content]);
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql)).length).toBeGreaterThan(0);
    });
    it("control: the longer Siemens record (6AV2124-0GC01-0AX0) asked by its own number is served", async () => {
      const cover = "SIMATIC HMI TP700 Comfort 6AV2124-0GC01-0AX0 6AV2124-0GC01-0AX Operating Instructions";
      const diagnostics: Record<string, unknown> = {};
      const row = { ...base, source_page: 9, page_start: 9, table_models: ["6AV21240GC010AX0"], document_heading: cover, content: "6AV2124-0GC01-0AX0: Supply voltage 24 V DC\n" };
      const { client, calls } = makeClient([[row]]);
      const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does 6AV2124-0GC01-0AX0 need?", scoped({ diagnostics, catalogNumber: "6AV2124-0GC01-0AX0" }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(out.map((c) => c.content)).toEqual([row.content]);
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql)).length).toBeGreaterThan(0);
    });
    // The space the five Codex rounds walked one cell at a time, as one matrix: every spelling of
    // the record × every spelling of the sibling ask refuses, and every spelling of the record's
    // own number is served.
    const recordSpellings = ["GS11N-20P2", "GS11N - 20P2", "GS11N20P2"];
    const siblingSpellings = ["GS13N-20P2", "GS13N - 20P2", "GS13N20P2", "GS11N-20P5", "GS11N - 20P5", "GS11N20P5"];
    it.each(recordSpellings.flatMap((r) => siblingSpellings.map((q) => [r, q])))("record %j × sibling ask %j refuses", async (record, sibling) => {
      const diagnostics: Record<string, unknown> = {};
      const { client, calls } = makeClient([[ownColumn]]);
      const out = await retrieveNodeChunks(client, "t-1", `What is the rated input current of ${sibling}?`, scoped({ diagnostics, catalogNumber: record }));
      expect(out).toEqual([]);
      expect(diagnostics.siblingOfRecordAsk).toMatchObject({ record });
      expect(calls.filter((c) => /knowledge_entries/.test(c.sql))).toHaveLength(0);
    });
    it.each(recordSpellings.flatMap((r) => recordSpellings.map((q) => [r, q])))("record %j × own-number ask %j is served", async (record, own) => {
      const diagnostics: Record<string, unknown> = {};
      const { client } = makeClient([[ownColumn]]);
      const out = await retrieveNodeChunks(client, "t-1", `What is the rated input current of ${own}?`, scoped({ diagnostics, catalogNumber: record }));
      expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
      expect(out.map((c) => c.content)).toEqual([ownColumn.content]);
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
