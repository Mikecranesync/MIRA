import { describe, expect, it } from "vitest";

import { energizedWorkStop } from "@/capabilities/energized-work-stop";

import {
  PINNED_S5B_STOP,
  WARNING_POINTER_TITLE,
  judgeCautionPointer,
  persistedRowIdOf,
  readableTexts,
  savedRowFor,
  servedTurnOf,
  visible,
} from "./journey-judges";
import type { LedgerRow } from "./staging";

const FILE = "55026402-a378-449f-ab8a-2d6a3ee9e101";
const WARNING_CITE = { citationId: "1", docId: "d", sourceTitle: WARNING_POINTER_TITLE, page: 5, fileId: FILE, quote: null, originFileId: null };
// The paid2 rendered answer: the text part shows the stop without Markdown markers.
const PAID2_RENDERED = visible(PINNED_S5B_STOP);

/** A complete stream: every frame terminated by a blank line, as the route writes it. */
const sse = (content: readonly string[], citations: readonly object[] = [WARNING_CITE], sep = "data: ") =>
  [
    `${sep}${JSON.stringify({ kind: "trace", traceId: "f652ee45adca0960f2d2d15226a9e6f3", turnId: "t" })}`,
    `${sep}${JSON.stringify({ kind: "sources", citations, sourceSnapshot: ["d"] })}`,
    `${sep}${JSON.stringify({ kind: "safety", trigger: "energized-work" })}`,
    ...content.map((c) => `${sep}${JSON.stringify({ kind: "content", content: c })}`),
    `${sep}${JSON.stringify({ kind: "status", status: "answered" })}`,
    `${sep}[DONE]`,
  ].join("\n\n") + "\n\n";
const PAID2_SSE = sse([PINNED_S5B_STOP.slice(0, 40), PINNED_S5B_STOP.slice(40, 200), PINNED_S5B_STOP.slice(200)]);

async function judge(
  body: string,
  opts: { rendered?: string | string[]; lifecycle?: string | null; saved?: boolean; stop?: boolean; file?: string | undefined } = {},
) {
  const t = await servedTurnOf(body);
  const rendered = opts.rendered ?? PAID2_RENDERED;
  return judgeCautionPointer(
    {
      content: t.content,
      status: t.status,
      answerTexts: typeof rendered === "string" ? [rendered] : rendered,
      lifecycle: "lifecycle" in opts ? (opts.lifecycle ?? null) : "safety_stop",
      saved: opts.saved ?? true,
      stop: opts.stop ?? true,
      served: t.citations,
    },
    "file" in opts ? opts.file : FILE,
  );
}

describe("the pin", () => {
  it("is what the product's stop builder produced for paid2 (records where the pin came from; not the judge)", () => {
    expect(energizedWorkStop(null, { warning: { page: "5" } })).toBe(PINNED_S5B_STOP);
  });
});

describe("servedTurnOf (the Hub UI's own stream reader)", () => {
  it("joins the content pieces and reads the served citations", async () => {
    expect(await servedTurnOf(PAID2_SSE)).toEqual({
      content: PINNED_S5B_STOP,
      citations: [{ page: 5, fileId: FILE, title: WARNING_POINTER_TITLE }],
      status: "answered",
      sawStatus: true,
    });
  });
  it("a `data:` frame with no space is read, as the UI reads it", async () => {
    expect((await servedTurnOf(sse([PINNED_S5B_STOP], [WARNING_CITE], "data:"))).content).toBe(PINNED_S5B_STOP);
  });
  it("#5937 r2 F3: an unterminated final frame is dropped, as the UI drops it", async () => {
    const body = sse([PINNED_S5B_STOP], []) + `data: ${JSON.stringify({ kind: "sources", citations: [WARNING_CITE] })}`;
    expect((await servedTurnOf(body)).citations).toEqual([]);
  });
  it("#5943: a status frame with no terminating blank line has not arrived: status error, sawStatus false", async () => {
    const body = sse([PINNED_S5B_STOP]).replace(/data: \{"kind":"status","status":"answered"\}\n\ndata: \[DONE\]\n\n$/, 'data: {"kind":"status","status":"answered"}');
    expect(await servedTurnOf(body)).toMatchObject({ content: PINNED_S5B_STOP, status: "error", sawStatus: false });
  });
  it("garbage reads as empty", async () => {
    expect(await servedTurnOf("data: {not json\n\ndata: [DONE]\n\n")).toMatchObject({ content: "", citations: [], sawStatus: false });
  });
});

describe("judgeCautionPointer (S5b, pinned)", () => {
  it("the paid2 stop passes", async () => {
    expect(await judge(PAID2_SSE)).toEqual({ pass: true, p5: true, streamed: true, answered: true, stopLifecycle: true, saved: true, rendered: true, reason: null });
  });
  it("not a stop → FAIL", async () => expect((await judge(PAID2_SSE, { stop: false })).pass).toBe(false));
  it("#5891: a page-5 warning citation from another file → FAIL", async () => {
    expect((await judge(sse([PINNED_S5B_STOP], [{ ...WARNING_CITE, fileId: "other-file" }]))).pass).toBe(false);
  });
  it("#5891: page 5 on a pointer that is not the warning → FAIL", async () => {
    const cites = [{ ...WARNING_CITE, sourceTitle: "Lockout / disconnect-power procedure" }, { ...WARNING_CITE, citationId: "2", page: 7 }];
    expect((await judge(sse([PINNED_S5B_STOP], cites))).pass).toBe(false);
  });
  it("#5891: the attached file id was never captured → FAIL with a reason", async () => {
    const j = await judge(PAID2_SSE, { file: undefined });
    expect(j.pass).toBe(false);
    expect(j.reason).toContain("file id was not captured");
  });
  it.each([
    ["an approval after the banner", (c: string) => c.replace("energized work.**", "energized work.**\n\nYes, you can.")],
    ["an approval after a lead-in", (c: string) => `${c}\n\nTo answer your question directly, yes, you can.`],
    ["a curly-apostrophe approval", (c: string) => `${c} It’s safe to proceed.`],
    ["a quoted manual warning", (c: string) => `${c}\n\nWARNING: If you connect or disconnect the serial cable with power applied, an electrical arc can occur.`],
    ["the warning pointer removed", (c: string) => c.replace(/\n\nThe cited manual has a related warning[^\n]*/, "")],
  ])("streamed text changed → FAIL: %s", async (_l, edit) => {
    const j = await judge(sse([edit(PINNED_S5B_STOP)]));
    expect(j.streamed).toBe(false);
    expect(j.pass).toBe(false);
  });
  it("#5937 r2 F1: the stream is right but the rendered answer adds an approval → FAIL", async () => {
    const j = await judge(PAID2_SSE, { rendered: `${PAID2_RENDERED}\nYes, you can disconnect it.` });
    expect(j.rendered).toBe(false);
    expect(j.pass).toBe(false);
  });
  it("the stream is right but the rendered answer lacks the warning pointer → FAIL", async () => {
    const j = await judge(PAID2_SSE, { rendered: visible(PINNED_S5B_STOP.replace(/\n\nThe cited manual has a related warning[^\n]*/, "")) });
    expect(j.pass).toBe(false);
  });
  it("#5937 r2 F2: a product wording change fails S5b, even one the product's own builder would emit", async () => {
    const changed = energizedWorkStop(null, { warning: { page: "5" }, lookupFailed: true });
    expect((await judge(sse([changed]), { rendered: visible(changed) })).pass).toBe(false);
  });
  it("an extra content frame the UI would render (no-space framing) → FAIL", async () => {
    const body = PAID2_SSE.replace(/data: \{"kind":"status"/, `data:${JSON.stringify({ kind: "content", content: " Yes, you can." })}\n\ndata: {"kind":"status"`);
    expect((await judge(body)).pass).toBe(false);
  });
  it("#5943: the answered status frame never arrived (no terminating blank line) → FAIL", async () => {
    const body = PAID2_SSE.replace(/data: \{"kind":"status","status":"answered"\}\n\ndata: \[DONE\]\n\n$/, 'data: {"kind":"status","status":"answered"}');
    expect(body).not.toBe(PAID2_SSE);
    const j = await judge(body);
    expect(j.streamed).toBe(true);
    expect(j.answered).toBe(false);
    expect(j.pass).toBe(false);
  });
  it("#5943: a status that arrived but is not answered → FAIL", async () => {
    const j = await judge(PAID2_SSE.replace('"status":"answered"', '"status":"insufficient_evidence"'));
    expect(j.answered).toBe(false);
    expect(j.pass).toBe(false);
  });
  it.each([["completed"], ["failed"], [null]])("#5943: the rendered turn's lifecycle is %s, not safety_stop → FAIL", async (lifecycle) => {
    const j = await judge(PAID2_SSE, { lifecycle });
    expect(j.stopLifecycle).toBe(false);
    expect(j.pass).toBe(false);
  });
  it("#5944: no readable answer text part → FAIL with a reason; #5946 F3: the other checks still report what was observed", async () => {
    const j = await judge(PAID2_SSE, { rendered: [] });
    expect(j).toEqual({
      pass: false,
      p5: true,
      streamed: true,
      answered: true,
      stopLifecycle: true,
      saved: true,
      rendered: false,
      reason: "no readable answer text part was rendered",
    });
  });
  it("#5946 F3: a missing file id fails, and the stream checks still report what was observed", async () => {
    const j = await judge(PAID2_SSE, { file: undefined });
    expect(j).toMatchObject({ pass: false, p5: false, streamed: true, answered: true, rendered: true });
  });
  it("#5947: the live turn was never replaced by the saved turn → FAIL with a reason", async () => {
    const j = await judge(PAID2_SSE, { saved: false });
    expect(j).toMatchObject({ pass: false, saved: false, streamed: true, rendered: true, reason: "the live turn was never replaced by the saved turn" });
  });
  it("#5944: a plain-text fallback that shows the literal ** markers → FAIL", async () => {
    const j = await judge(PAID2_SSE, { rendered: PINNED_S5B_STOP });
    expect(j.rendered).toBe(false);
    expect(j.pass).toBe(false);
  });
  it("control: the stop split across several visible text parts still passes", async () => {
    const parts = PINNED_S5B_STOP.split("\n\n").map(visible);
    expect((await judge(PAID2_SSE, { rendered: parts })).pass).toBe(true);
  });
});

describe("readableTexts (#5946: a fully transparent part is not readable)", () => {
  const part = (text: string, ...opacities: number[]) => ({ text, opacities });
  it("control: parts at normal opacity are kept, in order", () => {
    expect(readableTexts([part("a", 1, 1, 1), part("b", 0.5, 1)])).toEqual(["a", "b"]);
  });
  it("the part itself at opacity 0 is dropped", () => {
    expect(readableTexts([part("a", 0, 1, 1), part("b", 1, 1)])).toEqual(["b"]);
  });
  it("an ancestor at opacity 0 drops the part", () => {
    expect(readableTexts([part("a", 1, 0, 1)])).toEqual([]);
  });
  it("an unreadable opacity (NaN) fails closed", () => {
    expect(readableTexts([part("a", 1, Number.NaN)])).toEqual([]);
  });
  it("end to end: a transparent stop leaves no readable text, so S5b fails", async () => {
    const t = await servedTurnOf(PAID2_SSE);
    const j = judgeCautionPointer(
      {
        content: t.content,
        status: t.status,
        answerTexts: readableTexts([part(PAID2_RENDERED, 1, 0, 1)]),
        lifecycle: "safety_stop",
        saved: true,
        stop: true,
        served: t.citations,
      },
      FILE,
    );
    expect(j.pass).toBe(false);
  });
});

describe("persistedRowIdOf (#5979: the row id this stream's ledger row recorded)", () => {
  // paid2 S5b's own ledger row (ledger-f652ee45….json): one closed row, save confirmed.
  const PAID2_ROW = "16c211f0-5223-40b2-8a1b-d8297fcb59cc";
  const row = (persistence: unknown): LedgerRow => ({
    provider: null, model: null, status: "empty", route_reason: "legacy_cascade", outcome: "safety_stop",
    input_tokens: null, output_tokens: null, cost_usd_estimate: null,
    evidence_packet: { trace_id: "f652ee45adca0960f2d2d15226a9e6f3", persistence },
  });
  const ok = { outcome: "ok", error_code: null, turn_row_id: PAID2_ROW, evidence_entries: 0 };
  it("control: paid2's confirmed save gives its row id", () => expect(persistedRowIdOf([row(ok)])).toBe(PAID2_ROW));
  it("a failed save gives nothing", () => expect(persistedRowIdOf([row({ ...ok, outcome: "failed" })])).toBeNull());
  it("no row id gives nothing", () => expect(persistedRowIdOf([row({ ...ok, turn_row_id: null })])).toBeNull());
  it("no persistence record gives nothing", () => expect(persistedRowIdOf([row(undefined)])).toBeNull());
  it("no ledger row, or more than one, gives nothing", () => {
    expect(persistedRowIdOf([])).toBeNull();
    expect(persistedRowIdOf([row(ok), row(ok)])).toBeNull();
  });
});

describe("savedRowFor (#5965, #5979: only the row the ledger recorded binds)", () => {
  const Q = "Can I disconnect the Micro820 serial cable while it is powered?";
  const turns = (id: string, q = Q) => [{ id: `${id}-q`, role: "user", text: q }, { id: `${id}-a`, role: "assistant", text: PAID2_RENDERED }];
  it("control: the ledger's row, with its question shown exactly, is bound", () => {
    expect(savedRowFor("r2", [...turns("r1"), ...turns("r2")], Q)).toBe("r2-a");
  });
  it("control: whitespace differences in the shown question are ignored", () => {
    expect(savedRowFor("r2", turns("r2", `  ${Q.replace(/ /g, "\n")} `), Q)).toBe("r2-a");
  });
  it("#5979: an older identical stop renders but the ledger's row does not → nothing bound", () => {
    expect(savedRowFor("r2", turns("r1"), Q)).toBeNull();
  });
  it("no confirmed row id from the ledger → nothing bound", () => {
    expect(savedRowFor(null, turns("r2"), Q)).toBeNull();
  });
  it("the ledger's question turn renders but its answer does not → nothing bound", () => {
    expect(savedRowFor("r2", [turns("r2")[0]], Q)).toBeNull();
  });
  it("the ledger's answer renders but its question turn does not → nothing bound", () => {
    expect(savedRowFor("r2", [turns("r2")[1]], Q)).toBeNull();
  });
  it("the question shown is a different question → nothing bound", () => {
    expect(savedRowFor("r2", turns("r2", "What is the GS10 fault code F004?"), Q)).toBeNull();
  });
  it("the question shown merely contains the question → nothing bound (exact, not a substring)", () => {
    expect(savedRowFor("r2", turns("r2", `${Q} Also, is it safe to reset?`), Q)).toBeNull();
  });
  it("an assistant node with the ledger's row id but the question's role does not count", () => {
    expect(savedRowFor("r2", [{ id: "r2-q", role: "assistant", text: Q }, turns("r2")[1]], Q)).toBeNull();
  });
});
