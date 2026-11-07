// #5265 edge profile — passage selection and wording ("AI finds, manual speaks").
import { describe, expect, it } from "vitest";

import {
  EDGE_NO_PASSAGE_TEXT,
  EDGE_PASSAGE_LIMIT,
  EDGE_PASSAGES_LEAD,
  isNavigationChunk,
  renderEdgePassages,
  selectEdgePassages,
} from "../edge-passages";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

// Real chunks from FAA-H-8083-1B on the tablet (2026-11-07): the glossary entry,
// the index page that out-ranked the how-to, and the chapter 3 introduction.
const GLOSSARY =
  "G-3 Empty weight center of gravity (EWCG). This is the center of gravity of the aircraft in the empty condition, containing only the items specified in the aircraft empty weight.";
const INDEX_PAGE =
  "3-4 E E6-B flight compute ........................................... 10-1,10-2 effects of weight .............................................................1-3 electronic calculator .....................................................10-2";
const CHAPTER_3 = "3-1 Introduction Chapter 2, Weight and Balance Theory, explained the theory of weight and balance.";
const URL = "hub-upload://wb";
const chunk = (content: string, sourcePage: number) => ({ content, sourceUrl: URL, sourcePage });
const cite = (citationId: string, page: number): EvidenceCitation => ({
  citationId,
  docId: "6b629d79-65ae-4cc2-90ac-b8cc4f28fc43",
  sourceTitle: "FAA-H-8083-1B Weight and Balance",
  page,
  fileId: null,
  quote: null,
});
const Q = "How do I find the empty weight center of gravity of an airplane?";

describe("isNavigationChunk", () => {
  it("flags a table-of-contents/index chunk and keeps prose", () => {
    expect(isNavigationChunk(INDEX_PAGE)).toBe(true);
    expect(isNavigationChunk(GLOSSARY)).toBe(false);
    expect(isNavigationChunk(CHAPTER_3)).toBe(false);
  });
});

describe("selectEdgePassages", () => {
  const chunks = [chunk(GLOSSARY, 107), chunk(INDEX_PAGE, 111), chunk(CHAPTER_3, 33)];
  const citations = [cite("1", 107), cite("2", 111), cite("3", 33)];

  it("pairs each chunk with its citation by page and drops the index page", () => {
    const out = selectEdgePassages(chunks, citations, Q);
    expect(out.map((p) => p.citation.citationId)).toEqual(["1", "3"]);
  });

  it("quotes the chunk verbatim, never rewrites it", () => {
    for (const p of selectEdgePassages(chunks, citations, Q)) {
      expect(chunks.some((c) => c.content.includes(p.text))).toBe(true);
    }
  });

  it("keeps one passage per cited page and at most EDGE_PASSAGE_LIMIT", () => {
    const many = Array.from({ length: 8 }, (_, i) => chunk(`${CHAPTER_3} part ${i}`, 30 + i));
    const manyCites = many.map((c, i) => cite(String(i + 1), c.sourcePage));
    expect(selectEdgePassages([...many, many[0]], manyCites, Q)).toHaveLength(EDGE_PASSAGE_LIMIT);
  });

  it("returns nothing when only navigation chunks were retrieved", () => {
    expect(selectEdgePassages([chunk(INDEX_PAGE, 111)], [cite("1", 111)], Q)).toEqual([]);
  });
});

describe("renderEdgePassages", () => {
  it("leads with the fixed sentence and carries an [n] marker and page per passage", () => {
    const text = renderEdgePassages(selectEdgePassages([chunk(GLOSSARY, 107)], [cite("1", 107)], Q));
    expect(text.startsWith(EDGE_PASSAGES_LEAD)).toBe(true);
    expect(text).toContain(`"${GLOSSARY}" [1]`);
    expect(text).toContain("— FAA-H-8083-1B Weight and Balance, page 107");
  });

  it("puts the manual's own safety statement after the lead, ahead of the passages", () => {
    const text = renderEdgePassages(selectEdgePassages([chunk(GLOSSARY, 107)], [cite("1", 107)], Q), {
      marker: "WARNING",
      statement: "Disconnect power before servicing.",
      page: 107,
    });
    const parts = text.split("\n\n");
    expect(parts[0]).toBe(EDGE_PASSAGES_LEAD);
    expect(parts[1]).toBe('WARNING (page 107): "Disconnect power before servicing."');
    expect(parts[2]).toContain("[1]");
  });

  it("says plainly when nothing matched and refers to a qualified person", () => {
    expect(renderEdgePassages([])).toBe(EDGE_NO_PASSAGE_TEXT);
    expect(EDGE_NO_PASSAGE_TEXT).toContain("qualified person");
  });
});
