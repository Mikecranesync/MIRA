/**
 * #5370 — a manual's hazard statement must survive the re-ordering step.
 *
 * Measured on staging build 6e5361bff (issue #5370): for an "is it still live?" question, plain
 * search placed the manual's hazard statement sixth, inside the eight passages kept. The
 * cross-encoder scored it low, it fell to fourteenth, and the answer never saw it.
 *
 * The rule: on a question the hazard-vocabulary bridge fires for (notebook-query.ts, #5356), every
 * passage that carries a manual safety statement AND that plain search would have kept is still
 * kept after re-ordering. Nothing else about the order changes, and a question the bridge does not
 * fire for is re-ordered exactly as before.
 *
 * Passages are short stand-ins written for this test, not manual excerpts. The reranker is a stub.
 *
 * Run: npx vitest run src/capabilities/__tests__/hazard-survives-rerank.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { extractManualSafetyStatement } from "../manual-safety-statement";
import { keepWhatPlainSearchKept, orderWithPinnedHead } from "../reranker";

const mk = (page: number, content: string, rank: number, over: Record<string, unknown> = {}) => ({
  content,
  doc_id: "d-1",
  source_url: "node-doc/u1/starter.pdf",
  source_page: page,
  page_start: page,
  section_path: null,
  filename: "starter.pdf",
  document_heading: "Soft Starter User Manual",
  verified: false,
  rank,
  ...over,
});

function clientWith(rows: Record<string, unknown>[]): PoolClient {
  return { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
}

const KEEP = 8;
const ask = (question: string, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  retrieveNodeChunks(clientWith(rows), "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    topK: KEEP,
    docIds: ["d-1"],
    validatedDocScope: true,
    rawQuery: question,
    ...extra,
  });
type Chunk = { sourcePage: number | null; content: string };
const pages = (cs: Chunk[]) => cs.map((c) => c.sourcePage);
const carriesWarning = (c: Chunk) => extractManualSafetyStatement(c.content) !== null;

/** A fake reranker scoring each passage by a lookup on its text. */
function scoringService(score: (passage: string) => number) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
    return new Response(JSON.stringify({ scores: passages.map(score) }), { status: 200 });
  });
}

const HAZARD_QUESTION = "The starter is stopped. Are the motor terminals still live?";
const ORDINARY_QUESTION = "What is the motor terminal torque for the starter?";

// Three passages carry a safety statement; fourteen do not. A fresh copy per call: retrieval
// normalizes rank fields on the row objects it is given.
const WARNING_OFF_STATE = "SHOCK HAZARD: Hazardous voltage is present at the motor terminals even when the starter is stopped. Disconnect main power before servicing.";
const WARNING_CAPACITOR = "WARNING: Hazardous voltage remains on the motor terminals of the starter. Wait five minutes for the capacitors to discharge.";
const WARNING_BYPASS = "DANGER: Hazardous voltage is live on the starter bypass terminals when the motor is stopped. Verify zero energy.";
// The first two share the question's words and the hazard vocabulary without being a safety
// statement, so plain search ranks them first; the three warnings follow, inside the eight kept.
const rows17 = () => [
  mk(901, "Starter troubleshooting: if a dangerous voltage or shock hazard indication shows while the motor terminals carry voltage and the starter is stopped, check the wiring.", 0.95),
  mk(902, "Motor terminals of the starter: voltage ratings, shock and vibration limits, hazard labels and dangerous-goods data for each frame.", 0.93),
  mk(911, WARNING_CAPACITOR, 0.5),
  mk(912, WARNING_BYPASS, 0.38),
  mk(913, WARNING_OFF_STATE, 0.08),
  mk(903, "Starter stopped state: the display shows STOPPED and the motor terminals are not driven.", 0.91),
  mk(904, "Starter terminals: motor terminal torque is 2.5 N·m; line terminal torque is 3.0 N·m.", 0.86),
  mk(905, "Motor connection diagram for the starter: terminals T1, T2 and T3 go to the motor.", 0.8),
  ...[921, 922, 923, 924, 925, 926, 927, 928, 929].map((p, i) =>
    mk(p, `Starter setup note ${i + 1}: the motor terminals and the stopped state are described in the installation chapter.`, 0.3 - i * 0.02),
  ),
];
/** The reranker likes the setup notes and two of the warnings, and scores the off-state warning last. */
const demotesOffStateWarning = (p: string) =>
  p === WARNING_OFF_STATE ? -10 : p.startsWith("Starter setup note") ? 5 : p === WARNING_CAPACITOR || p === WARNING_BYPASS ? 6 : 0;

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

/** What plain search keeps: the same call with the reranker failing, which serves the fallback order. */
async function plainSearch(question: string, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const got = await ask(question, rows, extra);
  vi.unstubAllGlobals();
  return got;
}

describe("keepWhatPlainSearchKept", () => {
  const warn = (s: string) => s.startsWith("W");
  const head = (s: string) => s === "a" || s === "b";
  it("puts back a protected item plain search kept and the re-ordering dropped, in place of the lowest unprotected one", () => {
    const plain = ["a", "b", "c", "W1", "d", "W2", "e", "W3", "x", "y", "z"];
    const reordered = ["a", "b", "W1", "W3", "x", "y", "c", "z", "d", "e", "W2"];
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(["a", "b", "W1", "W3", "x", "y", "c", "W2"]);
  });
  it("puts back every dropped one, not just one, each in its plain-search order", () => {
    const plain = ["a", "b", "W1", "W2", "W3", "c", "d", "e", "x", "y", "z", "q"];
    const reordered = ["a", "b", "x", "y", "z", "q", "c", "d", "e", "W1", "W2", "W3"];
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(["a", "b", "x", "y", "z", "W1", "W2", "W3"]);
  });
  it("control: nothing dropped returns the re-ordered cut unchanged", () => {
    const plain = ["a", "b", "W1", "c", "d", "e", "f", "g", "x"];
    const reordered = ["a", "b", "x", "W1", "c", "d", "e", "f", "g"];
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(reordered.slice(0, 8));
  });
  it("control: a protected item plain search did NOT keep is not pulled in", () => {
    const plain = ["a", "b", "c", "d", "e", "f", "g", "h", "W1"];
    const reordered = ["a", "b", "h", "g", "f", "e", "d", "c", "W1"];
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(reordered.slice(0, 8));
  });
  it("never displaces the locked head, even when everything after it is protected", () => {
    const plain = ["a", "b", "W1", "W2", "W3", "W4", "W5", "W6", "W7"];
    const reordered = ["a", "b", "W7", "W2", "W3", "W4", "W5", "W6", "W1"];
    // W1 was kept by plain search and dropped, but the only unprotected slots are the locked head.
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(reordered.slice(0, 8));
  });
  it("stated limit: with fewer open places than dropped items, the earliest in plain-search order are put back", () => {
    const plain = ["a", "b", "W1", "W2", "W3", "W4", "W5", "c", "x"];
    const reordered = ["a", "b", "W3", "W4", "W5", "x", "c", "W9", "W1", "W2"];
    // Two were dropped (W1, W2); x and c are the only places open. Both go back here...
    expect(keepWhatPlainSearchKept(reordered, plain, 8, warn, head)).toEqual(["a", "b", "W3", "W4", "W5", "W1", "W2", "W9"]);
    // ...and with one place open, only the earlier one does. The other stays dropped.
    const oneOpen = ["a", "b", "W3", "W4", "W5", "W8", "c", "W9", "W1", "W2"];
    expect(keepWhatPlainSearchKept(oneOpen, plain, 8, warn, head)).toEqual(["a", "b", "W3", "W4", "W5", "W8", "W1", "W9"]);
  });
  it("a cut shorter than the list, or an empty list, is handled", () => {
    expect(keepWhatPlainSearchKept([], [], 8, warn, head)).toEqual([]);
    expect(keepWhatPlainSearchKept(["a", "W1"], ["a", "W1"], 8, warn, head)).toEqual(["a", "W1"]);
  });
});

describe("a hazard question: every warning passage plain search kept is still kept after re-ordering", () => {
  it("the fixture has the measured shape: three warnings inside plain search's eight, none in the first two", async () => {
    const plain = await plainSearch(HAZARD_QUESTION, rows17());
    expect(plain).toHaveLength(KEEP);
    expect(plain.filter(carriesWarning)).toHaveLength(3);
    expect(plain.map((c) => (carriesWarning(c) ? "W" : ".")).join("")).toBe("..WWW...");
  });

  it("the warning the reranker scores last is not dropped", async () => {
    const plain = await plainSearch(HAZARD_QUESTION, rows17());
    const svc = scoringService(demotesOffStateWarning);
    vi.stubGlobal("fetch", svc);
    const got = await ask(HAZARD_QUESTION, rows17());
    expect(svc).toHaveBeenCalledTimes(1);
    expect(got).toHaveLength(KEEP);
    for (const kept of plain.filter(carriesWarning)) {
      expect(pages(got), `the warning on p.${kept.sourcePage} is still kept`).toContain(kept.sourcePage);
    }
    expect(got.map((c) => c.content)).toContain(WARNING_OFF_STATE);
  });

  it("the first two passages stay where plain search put them, and the reranker's other picks stay in", async () => {
    const plain = await plainSearch(HAZARD_QUESTION, rows17());
    vi.stubGlobal("fetch", scoringService(demotesOffStateWarning));
    const got = await ask(HAZARD_QUESTION, rows17());
    expect(pages(got).slice(0, 2)).toEqual(pages(plain).slice(0, 2));
    // Exactly one passage gave up its place: 2 pinned + 2 warnings the reranker liked + the
    // restored warning leaves three of the reranker's setup-note picks.
    expect(got.filter((c) => c.content.startsWith("Starter setup note"))).toHaveLength(3);
  });

  it("all three dropped at once: all three are put back", async () => {
    const plain = await plainSearch(HAZARD_QUESTION, rows17());
    vi.stubGlobal("fetch", scoringService((p) => (p.startsWith("Starter setup note") ? 5 : extractManualSafetyStatement(p) ? -10 : 0)));
    const got = await ask(HAZARD_QUESTION, rows17());
    expect(got).toHaveLength(KEEP);
    expect(got.filter(carriesWarning).map((c) => c.sourcePage).sort()).toEqual(plain.filter(carriesWarning).map((c) => c.sourcePage).sort());
  });

  it("control: when the reranker drops no warning, the result is the pinned-head order and nothing else", async () => {
    const all = await plainSearch(HAZARD_QUESTION, rows17(), { topK: 50 });
    const score = (p: string) => (extractManualSafetyStatement(p) ? 9 : p.startsWith("Starter setup note") ? 5 : 0);
    vi.stubGlobal("fetch", scoringService(score));
    const got = await ask(HAZARD_QUESTION, rows17());
    expect(pages(got)).toEqual(pages(orderWithPinnedHead(all, all.map((c) => score(c.content))).slice(0, KEEP)));
  });

  it("a warning passage that plain search did not keep is not pulled in by this rule", async () => {
    const plain = await plainSearch(HAZARD_QUESTION, rows17());
    const late = "CAUTION: Use only the listed fuse types with this starter.";
    const rows = () => [...rows17(), mk(940, late, 0.01)];
    const plainWithLate = await plainSearch(HAZARD_QUESTION, rows());
    expect(pages(plainWithLate), "fixture: the late caution is outside plain search's eight").not.toContain(940);
    vi.stubGlobal("fetch", scoringService((p) => (p === late ? -50 : demotesOffStateWarning(p))));
    const got = await ask(HAZARD_QUESTION, rows());
    expect(pages(got)).not.toContain(940);
    expect(got.filter(carriesWarning)).toHaveLength(plain.filter(carriesWarning).length);
  });
});

describe("what the rule leaves alone", () => {
  it("an ordinary question is re-ordered exactly as before: a warning the reranker drops stays dropped", async () => {
    // The rule is for hazard questions only. For a torque question the cross-encoder's order
    // stands, as measured on 2026-11-04, even where plain search had kept a warning.
    const all = await plainSearch(ORDINARY_QUESTION, rows17(), { topK: 50 });
    expect(all.slice(2, KEEP).map((c) => c.content), "fixture: plain search keeps this warning, after the first two").toContain(WARNING_CAPACITOR);
    const score = (p: string) => (extractManualSafetyStatement(p) ? -10 : p.startsWith("Starter setup note") ? 5 : 0);
    vi.stubGlobal("fetch", scoringService(score));
    const got = await ask(ORDINARY_QUESTION, rows17());
    expect(pages(got)).toEqual(pages(orderWithPinnedHead(all, all.map((c) => score(c.content))).slice(0, KEEP)));
    expect(got.map((c) => c.content)).not.toContain(WARNING_CAPACITOR);
  });

  it("with the lane off, the hazard question is plain search", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    const svc = scoringService(demotesOffStateWarning);
    vi.stubGlobal("fetch", svc);
    const got = await ask(HAZARD_QUESTION, rows17());
    expect(svc).not.toHaveBeenCalled();
    expect(got.map((c) => c.content)).toContain(WARNING_OFF_STATE);
  });

  it("a code the technician just named still leads the cut", async () => {
    const coded = "Fault F0004 on the starter: undervoltage on the line side. Check the supply.";
    const rows = () => [...rows17(), mk(930, coded, 0.3)];
    const question = "F0004 is showing and the starter is stopped. Are the motor terminals still live?";
    const plain = await plainSearch(question, rows());
    vi.stubGlobal("fetch", scoringService(demotesOffStateWarning));
    const got = await ask(question, rows());
    expect(got[0].content).toBe(coded);
    for (const kept of plain.filter(carriesWarning)) expect(pages(got)).toContain(kept.sourcePage);
  });

  it("a warning from a manual refused for this machine never comes back", async () => {
    const micro820 = { filename: "micro820-user-manual.pdf", document_heading: "Micro820 Programmable Controllers User Manual" };
    const micro810 = { filename: "micro810-user-manual.pdf", document_heading: "Micro810 Programmable Controllers User Manual", doc_id: "d-2" };
    const siblingWarning = "SHOCK HAZARD: Hazardous voltage is present at the Micro810 output terminals even when the controller is stopped.";
    const rows = () => [
      mk(951, "Micro820 output terminals: wiring and the stopped state of the outputs.", 0.9, micro820),
      mk(952, "WARNING: Hazardous voltage may be present at the Micro820 output terminals. Disconnect power before servicing.", 0.8, micro820),
      mk(953, "Micro820 serial port wiring for RS-232 and RS-485.", 0.7, micro820),
      mk(954, siblingWarning, 0.95, micro810),
    ];
    vi.stubGlobal("fetch", scoringService((p) => (p === siblingWarning ? 100 : 0)));
    const got = await ask("The Micro820 is stopped. Are the output terminals still live?", rows(), { docIds: ["d-1", "d-2"] });
    expect(got.length).toBeGreaterThan(0);
    expect(got.map((c) => c.content)).not.toContain(siblingWarning);
  });
});
