// #5265 edge profile — the definition's page keeps its own cautions. Samsung
// physical run of 2026-11-08 (build 420236d93e57, #5294 comment 6723075830):
// the GS11N question got P01.12's definition from pdf p.139 but none of the
// cautions printed below it. Fixture: every chunk of that page on the tablet.
import { describe, expect, it } from "vitest";

import fx from "./fixtures/gs10-revc-acceleration-chunks.json";
import { validateAnswer } from "../answer-validation";
import {
  EDGE_CAUTION_CHARS,
  definitionCautions,
  renderEdgePassages,
  selectEdgePassages,
  withDefinitionCautions,
} from "../edge-passages";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { chunkText } from "@/lib/node-knowledge-ingest";
import { stitchChunks } from "../work-packet/document-text";

const URL = "node-doc/f41821d6-68c9-4840-bc37-ea4b36bbc900/GS10-User-Manual-RevC.pdf";
type Fx = { sourcePage: number; pageLabel: string | null; content: string };
const chunks = (fx.retrievalOrder as Fx[]).map((c) => ({
  content: c.content,
  sourceUrl: URL,
  sourcePage: Number(c.sourcePage),
  pageLabel: c.pageLabel,
}));
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
const P0112 = { code: "P01.12", name: "Acceleration Time 1" };
const wholePage = fx.definitionPage.chunks.map((c) => c.content);
const retrievedPage = chunks.filter((c) => c.sourcePage === 139).map((c) => c.content);

const INVALID = "The acceleration and deceleration time are invalid when using P01.44 Auto-acceleration and Auto-deceleration Setting.";
const PROTECTION =
  "Note that setting the acceleration and deceleration time too short may trigger the drive’s protection function (P06.03 Over-current Stall Prevention during Acceleration or P06.01 Over-voltage Stall Prevention), and the actual acceleration and deceleration time are longer than this setting.";
const MOTOR_DAMAGE =
  "Note that setting the acceleration time too short may cause motor damage or trigger drive protection due to over-current during the drive’s acceleration.";

describe("definitionCautions on pdf p.139", () => {
  it("quotes all three P01.12 cautions from the whole page, word for word, in page order", () => {
    expect(definitionCautions(wholePage, P0112)).toEqual([INVALID, PROTECTION, MOTOR_DAMAGE]);
  });

  it("keeps the two in the retrieved chunks when the page read is unavailable", () => {
    expect(definitionCautions(retrievedPage, P0112)).toEqual([INVALID, PROTECTION]);
  });

  it("leaves out the deceleration-only caution, the 'longer than' descriptions and the overlap fragment", () => {
    const got = definitionCautions(wholePage, P0112).join("\n");
    expect(got).not.toContain("setting the deceleration time too short");
    expect(got).not.toContain("With the enabled torque limits");
    expect(got).not.toContain("When you enable P01.24");
    expect(got).not.toMatch(/^Over-voltage Stall Prevention\), and/m);
    expect(got).not.toContain("braking resistors");
  });

  it("every caution is a verbatim (whitespace-normalised) substring of a page chunk", () => {
    const page = wholePage.map((t) => t.replace(/\s+/g, " "));
    for (const s of definitionCautions(wholePage, P0112)) expect(page.some((t) => t.includes(s))).toBe(true);
  });

  it("stays under its character cap and returns nothing for a nameless parameter", () => {
    expect(definitionCautions(wholePage, P0112).join("").length).toBeLessThanOrEqual(EDGE_CAUTION_CHARS);
    expect(definitionCautions(wholePage, { code: "P01.12", name: "1" })).toEqual([]);
  });
});

describe("rendered GS11N answer", () => {
  const passages = withDefinitionCautions(selectEdgePassages(chunks, citations, ORIGINAL), wholePage);
  const answer = renderEdgePassages(passages);

  it("attaches the cautions to the definition passage only, under its own [n]", () => {
    expect(passages[0].definition?.code).toBe("P01.12");
    expect(passages[0].cautions).toEqual([INVALID, PROTECTION, MOTOR_DAMAGE]);
    expect(passages.slice(1).every((p) => p.cautions === undefined)).toBe(true);
    const n = passages[0].citation.citationId;
    expect(answer).toContain(`Also printed on that page about P01.12:\n- "${INVALID}" [${n}]`);
    expect(answer).toContain(`- "${MOTOR_DAMAGE}" [${n}]`);
  });

  it("is not flagged by the deterministic answer floor (the turn stays answered on the edge)", () => {
    const v = validateAnswer({
      answerText: answer,
      question: ORIGINAL,
      general: false,
      served: true,
      refused: false,
      evidenceSufficient: true,
    });
    expect(v).toEqual({ ok: true });
  });

  it("renders exactly as before when the page has no cautions", () => {
    const plain = selectEdgePassages(chunks, citations, ORIGINAL);
    expect(renderEdgePassages(withDefinitionCautions(plain, ["P01.12 Acceleration Time 1 ♦R/W 010C 40269"]))).toBe(renderEdgePassages(plain));
  });
});

describe("Codex #5317 F2: cautions that cross an ingest chunk boundary", () => {
  // Re-split the real page with the ingest chunker until a window boundary falls
  // inside the motor-damage caution, so the fixture is what ingest really writes.
  const text = stitchChunks(wholePage);
  const ingest = (() => {
    for (let size = 200; size <= 1000; size += 10) {
      const pieces = chunkText(text, size, 120);
      if (pieces.length > 1 && !pieces.some((p) => p.replace(/\s+/g, " ").includes(MOTOR_DAMAGE))) return pieces;
    }
    return null;
  })();

  it("the fixture really splits the caution", () => {
    expect(ingest).not.toBeNull();
  });

  it("chunk by chunk the caution is lost (the defect)", () => {
    expect(definitionCautions(ingest!, P0112)).not.toContain(MOTOR_DAMAGE);
  });

  it("from the re-joined page text it is quoted whole, exactly once", () => {
    const got = definitionCautions([stitchChunks(ingest!)], P0112);
    expect(got.filter((c) => c === MOTOR_DAMAGE)).toHaveLength(1);
    expect(got).toEqual([INVALID, PROTECTION, MOTOR_DAMAGE]);
  });

  it("control: the original page's chunks re-joined give the same three cautions as before", () => {
    expect(definitionCautions([stitchChunks(wholePage)], P0112)).toEqual(definitionCautions(wholePage, P0112));
  });
});
