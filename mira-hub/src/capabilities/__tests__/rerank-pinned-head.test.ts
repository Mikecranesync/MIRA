/**
 * Pinned-head rerank (NOTEBOOK_RERANK=1): the lexical top 2 stay first and in order; only the
 * passages after them are reordered by the cross-encoder. A full rerank demoted exact part and
 * fault-code hits that lexical search already ranked first; pinning holds them.
 * Evidence: docs/evals/retrieval-eval/2026-11-04-pinned-rerank-k8.md.
 *
 * Run: npx vitest run src/capabilities/__tests__/rerank-pinned-head.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { notebookQuestionTopK, orderByScores, orderWithPinnedHead } from "../reranker";

const mk = (page: number, content: string, rank: number, over: Record<string, unknown> = {}) => ({
  content,
  doc_id: "d-1",
  source_url: "node-doc/u1/manual.pdf",
  source_page: page,
  page_start: page,
  section_path: null,
  filename: "manual.pdf",
  document_heading: "Drive User Manual",
  verified: false,
  rank,
  ...over,
});

function clientWith(rows: Record<string, unknown>[]): PoolClient {
  return { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
}

const ask = (question: string, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  retrieveNodeChunks(clientWith(rows), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    topK: 8,
    docIds: ["d-1"],
    validatedDocScope: true,
    rawQuery: question,
    ...extra,
  });
const pages = (cs: { sourcePage: number | null }[]) => cs.map((c) => c.sourcePage);

/** A fake service scoring each passage by a lookup on its text (default 0). */
function scoringService(score: (passage: string) => number) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
    return new Response(JSON.stringify({ scores: passages.map(score) }), { status: 200 });
  });
}

beforeEach(() => {
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("RERANKER_URL", "http://mira-reranker:8088");
  vi.stubEnv("NOTEBOOK_RERANK_POOL", "");
  vi.stubEnv("NOTEBOOK_RERANK", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("orderWithPinnedHead", () => {
  it("keeps the first 2 in place and sorts the rest by score, highest first", () => {
    expect(orderWithPinnedHead(["a", "b", "c", "d", "e"], [0, 0, 1, 9, 5])).toEqual(["a", "b", "d", "e", "c"]);
  });
  it("the pinned 2 stay put however high the others score", () => {
    expect(orderWithPinnedHead(["a", "b", "c"], [-9, -9, 100])).toEqual(["a", "b", "c"]);
  });
  it("equal scores after the head keep their lexical order (stable)", () => {
    expect(orderWithPinnedHead(["a", "b", "c", "d", "e"], [0, 0, 3, 3, 3])).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("2 items or fewer are returned unchanged", () => {
    expect(orderWithPinnedHead(["a", "b"], [0, 9])).toEqual(["a", "b"]);
    expect(orderWithPinnedHead(["a"], [9])).toEqual(["a"]);
    expect(orderWithPinnedHead([], [])).toEqual([]);
  });
  it("control: pinning 0 is a full rerank", () => {
    expect(orderWithPinnedHead(["a", "b", "c"], [1, 2, 3], 0)).toEqual(orderByScores(["a", "b", "c"], [1, 2, 3]));
  });
});

describe("notebookQuestionTopK", () => {
  it("is 8 only when NOTEBOOK_RERANK is exactly 1, otherwise today's 6", () => {
    expect(notebookQuestionTopK()).toBe(8);
    for (const v of ["", "0", "true", "yes"]) {
      vi.stubEnv("NOTEBOOK_RERANK", v);
      expect(notebookQuestionTopK()).toBe(6);
    }
  });
});

describe("retrieveNodeChunks with the pinned-head rerank", () => {
  // A fresh copy per call: retrieval normalizes rank fields on the row objects it is given.
  const rows5 = () => [
    mk(10, "Drive mounting dimensions and clearance requirements for the enclosure.", 0.9),
    mk(20, "Keypad navigation: press MODE to cycle through the parameter groups.", 0.8),
    mk(30, "Analog input scaling for a 4-20 mA speed reference signal.", 0.7),
    mk(40, "Ground the shield of the motor cable at the drive end only.", 0.6),
    mk(50, "If the drive trips when the load stops quickly, lengthen the deceleration time or add a braking resistor.", 0.5),
  ];

  it("a reworded question: the passage the reranker prefers rises to third, the lexical top 2 stay first", async () => {
    const svc = scoringService((p) => (p.includes("deceleration time") ? 10 : 0));
    vi.stubGlobal("fetch", svc);
    const got = pages(await ask("why does it shut off every time the conveyor stops hard", rows5()));
    expect(svc).toHaveBeenCalledTimes(1);
    expect(got.slice(0, 3)).toEqual([10, 20, 50]);
  });

  it("an exact catalog number lexical search ranks first stays first when the reranker scores it last", async () => {
    const rows = [
      mk(60, "Catalog number 22A-B4P5N104: 0.5 HP, 240V single phase input, frame A.", 0.95),
      ...rows5(),
    ];
    vi.stubGlobal("fetch", scoringService((p) => (p.includes("22A-B4P5N104") ? -100 : 1)));
    const got = pages(await ask("what horsepower is a 22A-B4P5N104", rows));
    expect(got[0]).toBe(60);
  });

  it("control: with the lane off the same catalog question is today's lexical order", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const svc = scoringService(() => 0);
    vi.stubGlobal("fetch", svc);
    const rows = [mk(60, "Catalog number 22A-B4P5N104: 0.5 HP, 240V single phase input, frame A.", 0.95), ...rows5()];
    const got = pages(await ask("what horsepower is a 22A-B4P5N104", rows));
    expect(svc).not.toHaveBeenCalled();
    expect(got[0]).toBe(60);
  });

  it("a missing manual (no admitted rows): nothing is returned and the reranker is never called", async () => {
    const svc = scoringService(() => 1);
    vi.stubGlobal("fetch", svc);
    expect(await ask("What is the overload trip class?", [])).toEqual([]);
    expect(svc).not.toHaveBeenCalled();
  });

  it("a sibling model's manual is rejected before ranking, however high the reranker would score it", async () => {
    const micro820 = { filename: "micro820-user-manual.pdf", document_heading: "Micro820 Programmable Controllers User Manual" };
    const micro810 = { filename: "micro810-user-manual.pdf", document_heading: "Micro810 Programmable Controllers User Manual", doc_id: "d-2" };
    const rows = [
      mk(11, "Micro820 embedded I/O: 12 inputs and 8 outputs on the 20-point controller.", 0.9, micro820),
      mk(12, "Micro820 supply voltage is 24V DC.", 0.8, micro820),
      mk(13, "Micro820 serial port wiring for RS-232 and RS-485.", 0.7, micro820),
      mk(14, "Micro810 embedded I/O: 8 inputs and 4 outputs on the 12-point controller.", 0.95, micro810),
    ];
    vi.stubGlobal("fetch", scoringService((p) => (p.includes("Micro810") ? 100 : 0)));
    const got = await ask("How many embedded inputs does the Micro820 have?", rows, { docIds: ["d-1", "d-2"] });
    expect(got.length).toBeGreaterThan(0);
    expect(pages(got)).not.toContain(14);
  });
});
