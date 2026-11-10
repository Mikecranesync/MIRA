import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { approvalGateEnabled, retrieveNodeChunks } from "@/lib/manual-rag";

// Original device question, without an answer, parameter or page hint.
const QUESTION = "For the GS11N-20P2 drive in this project, which parameter controls acceleration time? Explain what it controls and cite the exact manual page. Do not recommend a new setting or assume the present drive settings.";
const DOC = "52850000-0000-4000-8000-000000000001";
const TENANT = "52850000-0000-4000-8000-000000000002";

// This fixture tests admission of an already-retrieved passage, not SQL recall,
// persistence, generation, or a deployed source-byte/revision match.
function candidate(heading: string, filename = "gs10usermanual.pdf") {
  return {
    doc_id: DOC,
    filename,
    document_heading: heading,
    source_url: "https://test.invalid/gs10usermanual.pdf",
    source_page: 139,
    page_start: 139,
    page_label: "4-69",
    content: "P01.12 Acceleration Time 1. The acceleration time determines the time required to ramp from 0.00 Hz to the maximum operation frequency (P01.00).",
    rank: 0.8,
  };
}

async function retrieve(heading: string, question = QUESTION, notebookModel?: string, filename?: string, expectCandidate = true) {
  const row = candidate(heading, filename);
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
  if (expectCandidate) expect(offered, "the real admission path received a candidate").toBeGreaterThan(0);
  else expect(offered, "identity ambiguity stops before candidate retrieval").toBe(0);
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
  it.each([
    "GS11N - which parameter controls acceleration time?",
    "GS11N-which parameter controls acceleration time?",
    "GS11N - how is acceleration time configured?",
    "GS11N - explain acceleration time",
  ])("#5330: prose after a dash is not a conflicting catalog: %s", async (question) => {
    expect(await retrieve("GS11N-20P2 AC Drive User Manual", question)).toHaveLength(1);
  });

  it.each(["GS10-User-Manual.pdf", "GS10-User-Manual-RevC.pdf", "GS11N-20P2-User-Manual.pdf"])(
    "#5330: a filename fallback does not turn document words into a catalog: %s", async (filename) => {
      expect(await retrieve("AC Drive User Manual", QUESTION, undefined, filename)).toHaveLength(1);
    },
  );

  it("#5330: keeps full numeric catalog identity, including whitespace and case", async () => {
    expect(await retrieve("GS11N - 20p2 AC Drive User Manual", "gs11n - 20P2 acceleration time")).toHaveLength(1);
    expect(await retrieve("GS13N-4010 AC Drive User Manual", "GS13N-4010 acceleration time")).toHaveLength(1);
  });

  it.each(["GS11N-21P0", "GS11N-20P20", "GS11N-20P2X", "GS13N-4010"])(
    "#5330: never discards a numeric-leading catalog conflict: %s", async (catalog) => {
      expect(await retrieve(`${catalog} AC Drive User Manual`)).toEqual([]);
      expect(await retrieve("AC Drive User Manual", QUESTION, undefined, `${catalog}-User-Manual.pdf`)).toEqual([]);
    },
  );

  it("#5330: prose does not make a wrong-family filename eligible", async () => {
    expect(await retrieve("AC Drive User Manual", "GS11N - which parameter controls acceleration time?", undefined, "GS20-User-Manual.pdf")).toEqual([]);
  });

  it("retains the applicable GS10 family passage for the original unhinted question", async () => {
    const hits = await retrieve("DURApulse GS10 AC Drive User Manual");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ docId: DOC, sourcePage: 139, pageLabel: "4-69" });
    expect(hits[0].content).toBe(candidate("DURApulse GS10 AC Drive User Manual").content);
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

  it("composes GS10 family coverage with the current sibling-ambiguity guard", async () => {
    const question = QUESTION.replace("For the GS11N-20P2 drive", "For the GS10 family GS11N-20P2 drive");
    expect(await retrieve("DURApulse GS10 AC Drive User Manual", question)).toHaveLength(1);
  });

  it("still refuses an unresolved choice between two GS family members", async () => {
    const question = QUESTION.replace("GS11N-20P2", "GS11N or GS13N");
    expect(await retrieve("DURApulse GS10 AC Drive User Manual", question, undefined, undefined, false)).toEqual([]);
  });

  it("does not disable the existing GS10 notebook scope when adding family membership", async () => {
    expect(await retrieve("GS20 AC Drive User Manual", "Which parameter controls acceleration time?", "GS10")).toEqual([]);
  });
});
