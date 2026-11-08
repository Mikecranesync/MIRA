// #5265 edge profile — the parameter a question is about leads the passages,
// quoted from the page that DEFINES it. Fixture: the real GS10 Rev C chunks on
// the tablet, in the retrieval order BRAVO measured (CV101-EDGE-COMPOSITION-RED,
// #5266 comment of 2026-11-08): the definition page (pdf 139) came back fourth
// and the old first-three selection dropped it.
import { describe, expect, it } from "vitest";

import fx from "./fixtures/gs10-revc-acceleration-chunks.json";
import {
  EDGE_PASSAGE_LIMIT,
  definitionSpan,
  identifyParameter,
  printedRevision,
  renderEdgePassages,
  selectEdgePassages,
} from "../edge-passages";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

const URL = "node-doc/f41821d6-68c9-4840-bc37-ea4b36bbc900/GS10-User-Manual-RevC.pdf";
type Fx = { sourcePage: number; pageLabel: string | null; content: string };
const asChunk = (c: Fx) => ({ content: c.content, sourceUrl: URL, sourcePage: c.sourcePage, pageLabel: c.pageLabel });
const chunks = (fx.retrievalOrder as Fx[]).map(asChunk);
const pages = [...new Set(chunks.map((c) => c.sourcePage))];
const citations: EvidenceCitation[] = pages.map((page, i) => ({
  citationId: String(i + 1),
  docId: "f41821d6-68c9-4840-bc37-ea4b36bbc900",
  sourceTitle: "GS10-User-Manual-RevC.pdf",
  page,
  fileId: "8b8e8fa1",
  quote: null,
}));
const ORIGINAL =
  "For the GS11N-20P2 drive in this project, which parameter controls acceleration time? Explain what it controls and cite the exact manual page. Do not recommend a new setting or assume the present drive settings.";

describe("identifyParameter", () => {
  it("reads P01.12 Acceleration Time 1 from the retrieved text for the original question", () => {
    const hit = identifyParameter(chunks, ORIGINAL)!;
    expect(hit.code).toBe("P01.12");
    expect(hit.name.toLowerCase()).toBe("acceleration time 1");
  });

  it("honours a code typed in the question", () => {
    expect(identifyParameter(chunks, "What does P01.13 do?")?.code).toBe("P01.13");
  });

  it("pins nothing on a vague or unrelated question", () => {
    expect(identifyParameter(chunks, "How do I install GSoft2?")).toBeNull();
    expect(identifyParameter(chunks, "What is the torque spec for the gearbox coupling bolts?")).toBeNull();
    expect(identifyParameter(chunks, "Which parameter controls it?")).toBeNull();
  });

  it("does not answer for a code the retrieved text never prints", () => {
    expect(identifyParameter(chunks, "What does P09.99 do?")).toBeNull();
  });
});

describe("definitionSpan", () => {
  const p139 = (fx.retrievalOrder as Fx[]).find((c) => c.content.includes("Type Hex Addr"))!;
  it("spans the code line through the manual's defining sentence, verbatim", () => {
    const span = definitionSpan(p139.content, { code: "P01.12", name: "Acceleration Time 1" }, 900)!;
    expect(span.startsWith("P01.12 Acceleration Time 1")).toBe(true);
    expect(span.endsWith("the maximum operation frequency (P01.00).")).toBe(true);
    expect(p139.content.includes(span)).toBe(true);
  });

  it("treats a summary-table row as no definition", () => {
    const table = (fx.controls.p290_table as Fx).content;
    expect(definitionSpan(table, { code: "P01.12", name: "Acceleration time 1" }, 900)).toBeNull();
  });
});

describe("selectEdgePassages on the original GS11N-20P2 question (failing before: kept 65/290/369)", () => {
  const out = selectEdgePassages(chunks, citations, ORIGINAL);

  it("leads with the P01.12 definition page, pdf 139 (printed 4-69)", () => {
    expect(out[0].citation.page).toBe(139);
    expect(out[0].definition).toEqual({ code: "P01.12", name: "Acceleration Time 1" });
    expect(out[0].text).toContain("The acceleration time determines the time required");
    expect(out[0].pageLabel).toBe("4–69");
    expect(out[0].revision).toBe("1st Ed., Rev C");
  });

  it("then prefers pages that print P01.12, and stays within the limit", () => {
    expect(out).toHaveLength(EDGE_PASSAGE_LIMIT);
    expect(out[1].citation.page).toBe(290);
    expect(out[1].text).toContain("P01.12");
  });

  it("every passage is still a verbatim substring of a retrieved chunk", () => {
    for (const p of out) expect(chunks.some((c) => c.content.includes(p.text.replace(/^…/, "").replace(/…$/, "")))).toBe(true);
  });

  it("renders the definition first with manual, revision, printed page and PDF page", () => {
    const text = renderEdgePassages(out);
    const blocks = text.split("\n\n");
    expect(blocks[1]).toMatch(/^Definition of P01\.12 \(Acceleration Time 1\), as printed:/);
    expect(blocks[1]).toContain("— GS10-User-Manual-RevC.pdf, 1st Ed., Rev C, page 4-69 (PDF page 139)");
    // Never a setting recommendation or a claim about the drive's present value.
    expect(text).not.toMatch(/\bset (it|P01\.12) to\b|\bcurrently\b|\byour drive is\b/i);
  });
});

describe("printedRevision", () => {
  it("returns only what the page prints", () => {
    expect(printedRevision("Page 4–69DURApulse GS10 AC Drive User Manual – 1st Ed., Rev C")).toBe("1st Ed., Rev C");
    expect(printedRevision("Chapter 3 Keypad operation")).toBeNull();
  });
});
