import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

/**
 * #5449 — garage pilot L4 / L14 on staging build 5e79ca713 (2026-11-12 harness):
 * "What supply voltage does it need?" refused 10 of 10 for a GS11N-20P2 record, and the Micro820
 * do-not-regress ask dropped from 2 of 2 to 0 of 2, although the record's own row chunk
 * (`GS11N-20P2: Rated Voltage/Frequency One-phase 200-240 VAC …`, `2080-LC20-20QBB(R): Power supply
 * voltage range 20.4…26.4 V DC`) was stored and correct.
 *
 * Mechanism (replicated read-only on the staging DB): the catalog-number exact lane does put the own
 * row in the pool, at rank 0, and the lexical rerank — scoring the question's words — cuts it behind
 * prose pages (OR rank 0.10 vs 0.70–1.50) because the row label does not carry the question's words
 * ("supply", "need") and the row form carries no page header ("Micro820").
 *
 * Contract: when the record holds a confirmed catalog number, up to two chunks of the record's OWN
 * table rows that share at least one question lexeme keep a seat at the head of the final cut. Rows
 * sharing no lexeme (a fault-code question) stay where the rerank put them; a row the parser could
 * not tie to a column (`table_unqualified`) is never seated (it is excluded upstream); without a
 * catalog number on record nothing changes.
 */

const base = {
  source_url: "node-doc/u1/gs10usermanual.pdf", filename: "gs10usermanual.pdf", doc_id: "d-1",
  document_heading: "DURApulse GS10 Drive User Manual", section_path: null, verified: true,
};
const ownRow = {
  ...base, source_page: 26, page_start: 26, table_models: ["GS11N20P2"], rank: 0,
  lexemes: ["230v", "class", "1-phase", "model-specif", "specif", "gs11n-20p2", "gs11n", "20p2", "rate", "voltag", "frequenc", "one-phas", "200-240", "vac", "oper", "rang", "170", "265"],
  content: "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — GS11N-20P2\nGS11N-20P2: Rated Voltage/Frequency One-phase 200-240 VAC (-15% to +10%), 50/60 Hz\nGS11N-20P2: Operating Voltage Range 170–265 VAC\n",
};
const proseAt = (page: number, text: string) => ({
  ...base, source_page: page, page_start: page, table_models: null, rank: 0.9,
  lexemes: ["suppli", "voltag", "need", "fault", "threshold", "dc", "bus", "drive", "power"],
  content: text,
});
const prose = [
  proseAt(344, "Fault setting parameter N/A Reset method Manual reset Reset condition Reset when the DC bus voltage is below the supply threshold. Improve power supply condition if needed."),
  proseAt(345, "Check that a single-phase power supply is not being used where the drive needs three-phase input voltage; the supply voltage must stay within the fault threshold."),
  proseAt(239, "Set the output voltage of the AC motor drive to the motor's rated voltage when the input voltage exceeds what the motor needs; the supply voltage threshold applies."),
];

/** Routes each statement by shape instead of call order, so the test pins behaviour, not pass order. */
function makeClient(opts: { ownRowInExactLane: boolean; idfRows?: boolean }) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return { rows: [] };
    if (sql.includes("names_document")) {
      return {
        rows: opts.idfRows === false ? [] : [
          { lex: "suppli", df: 3, n: 40, names_document: false },
          { lex: "voltag", df: 4, n: 40, names_document: false },
          { lex: "need", df: 2, n: 40, names_document: false },
        ],
      };
    }
    if (sql.includes("WITH ORDINALITY") || sql.includes("quote_literal(lex)")) return { rows: [] };
    if (sql.includes("ILIKE ANY")) {
      const patterns = (params[2] as string[]) ?? [];
      return { rows: opts.ownRowInExactLane && patterns.some((p) => /GS11N-20P2/i.test(p)) ? [ownRow] : [] };
    }
    if (sql.includes("plainto_tsquery('english', $2)") && !sql.includes("replace(")) return { rows: prose };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const scoped = (extra: Record<string, unknown> = {}) => ({
  nodeId: "n-1", unsPath: null, docIds: ["d-1"], validatedDocScope: true, topK: 2,
  identity: { manufacturer: "AutomationDirect", model: "GS10" }, identityStatus: "user_confirmed" as const,
  catalogNumber: "GS11N-20P2", ...extra,
});

describe("retrieveNodeChunks seats the record's own table row in the final cut (#5449)", () => {
  it("keeps the own-row chunk the exact lane found, at the head, when the question shares a lexeme with it", async () => {
    const { client } = makeClient({ ownRowInExactLane: true });
    const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does it need?", scoped());
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe(ownRow.content);
    expect(out[0].tableModels).toEqual(["GS11N20P2"]);
    expect(out[0].sourcePage).toBe(26);
  });

  it("changes nothing when the own row shares no question lexeme", async () => {
    const { client } = makeClient({ ownRowInExactLane: true, idfRows: false });
    const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does it need?", scoped());
    expect(out.map((c) => c.sourcePage)).toEqual(prose.slice(0, 2).map((p) => p.page_start));
  });

  it("changes nothing without a catalog number on record", async () => {
    const { client } = makeClient({ ownRowInExactLane: true });
    const out = await retrieveNodeChunks(client, "t-1", "What supply voltage does it need?", scoped({ catalogNumber: null }));
    expect(out.map((c) => c.sourcePage)).toEqual(prose.slice(0, 2).map((p) => p.page_start));
  });
});
