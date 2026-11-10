/**
 * CV-101 journey S6 (2026-11-08, staging b304d5dcf, paid3 trace
 * a8b01dd93e30789a38f2895cf26a8be9): "What are the relay contact ratings at
 * 120 V AC on a Micro850 2080-LC50-48QWB?" in a notebook holding only the
 * Micro820 20-point installation instructions. Retrieval correctly refused the
 * Micro820 pages for a Micro850 ask, but the reply was the generic "Add the
 * manual for the equipment you're asking about" — it never said the manual it
 * HAS is for a different model. The mismatch is now reported by retrieval
 * (only when every refused page declared its own model) and named in the reply.
 *
 * Run: npx vitest run src/capabilities/__tests__/named-model-mismatch.test.ts
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { namedModelMismatchText } from "../named-model-mismatch";

// The real cover of Rockwell 2080-IN009B-EN-P (April 2014).
const MICRO820_COVER =
  "Installation Instructions\nMicro820 20-Point Programmable Controllers\n" +
  "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR";

const row = (heading: string, filename = "2080-IN009B-EN-P.pdf", docId = "d-1") => ({
  doc_id: docId,
  content: "Relay Contact Ratings. 120V AC: make 15 A, break 1.5 A, continuous 2.0 A, 1800 VA make, 180 VA break.",
  source_url: `node-doc/u1/${filename}`,
  source_page: 19,
  page_start: 19,
  section_path: null,
  filename,
  document_heading: heading,
  rank: 0.4,
});

type Diag = { namedModelMismatch?: { requested: string[]; declared: string[] } };

async function ask(rows: Record<string, unknown>[], question: string, docIds = ["d-1"]) {
  const client = { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds,
    validatedDocScope: true,
    identity: { manufacturer: "Rockwell Automation", model: "2080-LC20-20QWB" },
    identityStatus: "user_confirmed" as never,
    diagnostics: diagnostics as never,
  });
  return { hits, diagnostics };
}

const S6_ASK = "What are the relay contact ratings at 120 V AC on a Micro850 2080-LC50-48QWB?";

describe("retrieval reports a named-model mismatch it can prove", () => {
  it("S6: a Micro850 ask against the Micro820 manual is refused AND reported as a Micro820/Micro850 mismatch", async () => {
    const { hits, diagnostics } = await ask([row(MICRO820_COVER)], S6_ASK);
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["MICRO850"], declared: ["MICRO820"] });
  });

  it("control: the Micro820 ask is answered from the same manual and reports no mismatch", async () => {
    const { hits, diagnostics } = await ask([row(MICRO820_COVER)], "What are the relay contact ratings at 120 V AC on a Micro820?");
    expect(hits).toHaveLength(1);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: a refused manual that declares NO model is not claimed to be any model", async () => {
    const { hits, diagnostics } = await ask([row("Installation Instructions", "manual.pdf")], S6_ASK);
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: if any refused page declared nothing, the mismatch is not claimed (the unknown manual might cover it)", async () => {
    const { diagnostics } = await ask([row(MICRO820_COVER), row("Installation Instructions", "other.pdf")], S6_ASK);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });
});

describe("Codex #5350 round 1 — the mismatch is claimed only when the documents prove it", () => {
  it("F1: a model named only by the filename still refuses the row but is not claimed as the manual's model", async () => {
    const { hits, diagnostics } = await ask([row("Installation Instructions", "Micro820.pdf")], "What are the relay contact ratings on a Micro850?");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("F2: a second selected document that returned no candidates withholds the notebook-wide claim", async () => {
    const { hits, diagnostics } = await ask([row(MICRO820_COVER)], S6_ASK, ["d-1", "d-2"]);
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control (F2): when every selected document is refused on its own declared model, the claim stands", async () => {
    const { diagnostics } = await ask([row(MICRO820_COVER), row(MICRO820_COVER, "copy.pdf", "d-2")], S6_ASK, ["d-1", "d-2"]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["MICRO850"], declared: ["MICRO820"] });
  });
});

describe("namedModelMismatchText", () => {
  it("names both models and refuses to answer from the wrong manual", () => {
    const text = namedModelMismatchText({ requested: ["MICRO850"], declared: ["MICRO820"] });
    expect(text).toContain("for the Micro820, not the Micro850 you asked about");
    expect(text).toMatch(/won't answer from it/);
    expect(text).toContain("Add the Micro850 manual");
    // Never a value from the wrong manual.
    expect(text).not.toMatch(/\d+(\.\d+)?\s*A\b/);
  });
  it("PowerFlex identities read as the technician writes them", () => {
    expect(namedModelMismatchText({ requested: ["PF755"], declared: ["PF525"] })).toContain("for the PowerFlex 525, not the PowerFlex 755");
  });
});
