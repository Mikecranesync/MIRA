import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

/**
 * Public development fixtures, not the private benchmark or sealed questions.
 * These 15 cases protect production candidate admission and returned provenance
 * using the existing scripted SQL-candidate seam. They do NOT measure SQL recall,
 * generated answers, full-document ingestion, or deployed/device behavior.
 *
 * Fact anchors: manufacturer GS10 manual, PDF p.26, GS11N-20P2 column;
 * Rockwell 2080-IN009B-EN-P, PDF p.16, power-supply row. Fixture sentences are
 * paraphrases, not copied source passages or an operating recommendation.
 */
const facts = [
  {
    id: "input-current", model: "GS10", catalog: "GS11N-20P2", sibling: "GS13N-20P2",
    manufacturer: "AutomationDirect", filename: "gs10usermanual.pdf", page: 26,
    heading: "DURApulse GS10 Drive User Manual\nModels GS11N-20P2 and GS13N-20P2",
    question: "GS11N-20P2 rated input current.",
    content: "GS11N-20P2: CT input current is 5.1 A; VT input current is 5.8 A.",
    required: ["CT", "5.1 A", "VT", "5.8 A"], table: ["GS11N20P2"],
  },
  {
    id: "input-supply", model: "GS10", catalog: "GS11N-20P2", sibling: "GS13N-20P2",
    manufacturer: "AutomationDirect", filename: "gs10usermanual.pdf", page: 26,
    heading: "DURApulse GS10 Drive User Manual\nModels GS11N-20P2 and GS13N-20P2",
    question: "GS11N-20P2 rated supply voltage.",
    content: "GS11N-20P2 rated supply: one-phase 200–240 VAC at 50/60 Hz.",
    required: ["one-phase", "200–240 VAC", "50/60 Hz"], table: ["GS11N20P2"],
  },
  {
    id: "controller-supply", model: "Micro820", catalog: "2080-LC20-20QBB", sibling: "2080-LC20-20QWB",
    manufacturer: "Allen-Bradley", filename: "micro820-install.pdf", page: 16,
    heading: "Installation Instructions\nMicro820 20-Point Programmable Controllers\nCatalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB, 2080-LC20-20AWB",
    question: "2080-LC20-20QBB supply voltage.",
    content: "2080-LC20-20QBB power supply: 20.4…26.4 V DC, Class 2 or LVLC.",
    required: ["20.4…26.4 V DC", "Class 2", "LVLC"], table: ["2080LC2020QBB"],
  },
] as const;

const contexts = ["baseline", "neutral-rename", "unrelated-document", "document-order", "wrong-model"] as const;
const DOC = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const TENANT = "10000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("NOTEBOOK_RERANK", "0");
  vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Context invariants forbid network/provider calls"); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(facts)("candidate admission: $id", (fact) => {
  it.each(contexts)(`[context-invariant:${fact.id}] %s`, async (context) => {
    const own = {
      doc_id: DOC,
      filename: context === "neutral-rename"
        ? fact.model === "Micro820" ? "2080-IN009B-EN-P.pdf" : "installation-guide.pdf"
        : fact.filename,
      document_heading: fact.heading,
      source_url: "https://fixture.invalid/manual.pdf", source_page: fact.page,
      page_start: fact.page, page_label: `fixture-${fact.page}`, content: fact.content,
      table_models: [...fact.table], table_unqualified: false, rank: 0.9,
    };
    const irrelevant = {
      ...own, doc_id: OTHER, filename: "micro810-install.pdf",
      document_heading: "Micro810 Programmable Controllers\nCatalog Number 2080-LC10-12QBB",
      content: "Unrelated Micro810 dimensions: 90 mm.", table_models: ["2080LC1012QBB"], rank: 0.1,
    };
    const expanded = context === "unrelated-document" || context === "document-order";
    const rows = context === "document-order" ? [irrelevant, own] : expanded ? [own, irrelevant] : [own];
    const pending = [rows];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WITH ORDINALITY") || sql.includes("names_document")
        || sql.includes("quote_literal(lex)")
        || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return { rows: [] };
      return { rows: pending.shift() ?? [] };
    });
    const diagnostics: NonNullable<Parameters<typeof retrieveNodeChunks>[3]["diagnostics"]> = {};
    const docIds = expanded ? context === "document-order" ? [OTHER, DOC] : [DOC, OTHER] : [DOC];
    const question = context === "wrong-model" ? fact.question.replace(fact.catalog, fact.sibling) : fact.question;
    const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, question, {
      nodeId: "context-invariant-fixture", unsPath: null, docIds,
      approvedSourceDocIds: docIds, validatedDocScope: true,
      identity: { manufacturer: fact.manufacturer, model: fact.model },
      identityStatus: "user_confirmed", catalogNumber: fact.catalog, diagnostics,
    });

    if (context === "wrong-model") {
      expect(chunks).toEqual([]);
      expect(query.mock.calls.filter(([sql]) => sql.includes("knowledge_entries"))).toHaveLength(0);
      expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: [fact.sibling], record: fact.catalog });
      return;
    }
    expect(query.mock.calls.some(([sql]) => sql.includes("knowledge_entries"))).toBe(true);
    const supported = chunks.filter((chunk) => chunk.docId === DOC);
    expect(supported).toHaveLength(1);
    expect(supported[0]).toMatchObject({
      content: fact.content, sourcePage: fact.page, pageLabel: `fixture-${fact.page}`,
      sourceUrl: own.source_url, title: own.filename, tableModels: [...fact.table],
    });
    for (const required of fact.required) expect(supported[0].content).toContain(required);
    expect(chunks.some((chunk) => chunk.docId === OTHER)).toBe(false);
  });
});
