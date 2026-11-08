import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { approvalGateEnabled, retrieveNodeChunks } from "@/lib/manual-rag";

// Original device question, without an answer, parameter or page hint.
const QUESTION = "For the GS11N-20P2 drive in this project, which parameter controls acceleration time? Explain what it controls and cite the exact manual page. Do not recommend a new setting or assume the present drive settings.";
const DOC = "52850000-0000-4000-8000-000000000001";
const TENANT = "52850000-0000-4000-8000-000000000002";

// This fixture tests admission of an already-retrieved passage, not SQL recall,
// persistence, generation, or a deployed source-byte/revision match.
function candidate(heading: string) {
  return {
    doc_id: DOC,
    filename: "gs10usermanual.pdf",
    document_heading: heading,
    source_url: "https://test.invalid/gs10usermanual.pdf",
    source_page: 139,
    page_start: 139,
    page_label: "4-69",
    content: "P01.12 Acceleration Time 1. The acceleration time determines the time required to ramp from 0.00 Hz to the maximum operation frequency (P01.00).",
    rank: 0.8,
  };
}

async function retrieve(heading: string, question = QUESTION, notebookModel?: string) {
  const row = candidate(heading);
  let offered = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document")
      || sql.includes("quote_literal(lex)")
      || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      return { rows: [] };
    }
    offered++;
    return { rows: [row] };
  });
  const hits = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, question, {
    nodeId: "cv101-fixture",
    unsPath: null,
    docIds: [DOC],
    approvedSourceDocIds: [DOC],
    validatedDocScope: true,
    rawQuery: question,
    topK: 6,
    ...(notebookModel ? {
      identity: { manufacturer: "AutomationDirect", model: notebookModel },
      identityStatus: "user_confirmed" as const,
    } : {}),
  });
  expect(offered, "the real admission path received a candidate").toBeGreaterThan(0);
  return hits;
}

beforeEach(() => {
  vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
  expect(approvalGateEnabled()).toBe(true);
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("NOTEBOOK_RERANK", "0");
  vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider/network in the admission fixture"); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CV-101 supported catalog-family admission (#5285)", () => {
  it("retains the applicable GS10 family passage for the original unhinted question", async () => {
    const hits = await retrieve("DURApulse GS10 AC Drive User Manual");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ docId: DOC, sourcePage: 139, pageLabel: "4-69" });
    expect(hits[0].content).toContain("P01.12");
  });

  it("control: changing only the requested model to GS10 already retains it", async () => {
    expect(await retrieve("DURApulse GS10 AC Drive User Manual", QUESTION.replace("GS11N-20P2", "GS10"))).toHaveLength(1);
  });

  it("control: a heading naming the exact catalog remains applicable", async () => {
    expect(await retrieve("GS11N-20P2 AC Drive User Manual")).toHaveLength(1);
  });

  it.each([
    "GS20 AC Drive User Manual",
    "GS13N AC Drive User Manual",
    "GS10 GS13N AC Drive User Manual",
    "GS11N-21P0 AC Drive User Manual",
    "GS10 GS11N-21P0 AC Drive User Manual",
    "GS11N-20P20 AC Drive User Manual",
  ])("does not broaden coverage to %s", async (heading) => {
    expect(await retrieve(heading)).toEqual([]);
  });

  it("does not make the GS10 family cover another drive family", async () => {
    expect(await retrieve("DURApulse GS10 AC Drive User Manual", QUESTION.replace("GS11N-20P2", "GS20"))).toEqual([]);
  });

  it("covers the other reviewed GS10 catalog series without conflating its specific manuals", async () => {
    expect(await retrieve("DURApulse GS10 AC Drive User Manual", QUESTION.replace("GS11N-20P2", "GS13N"))).toHaveLength(1);
  });

  it("uses family coverage for an explicitly confirmed notebook when the question omits its model", async () => {
    expect(await retrieve("GS10 AC Drive User Manual", "Which parameter controls acceleration time?", "GS11N-20P2")).toHaveLength(1);
  });

  it.each(["GS20 AC Drive User Manual", "GS10 GS13N AC Drive User Manual", "GS10 GS11N-21P0 AC Drive User Manual"])(
    "preserves confirmed-notebook rejection for %s", async (heading) => {
      expect(await retrieve(heading, "Which parameter controls acceleration time?", "GS11N-20P2")).toEqual([]);
    },
  );

  it("does not disable the existing GS10 notebook scope when adding family membership", async () => {
    expect(await retrieve("GS20 AC Drive User Manual", "Which parameter controls acceleration time?", "GS10")).toEqual([]);
  });
});
