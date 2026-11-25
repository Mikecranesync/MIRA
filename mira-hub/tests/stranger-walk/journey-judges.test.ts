import { describe, expect, it } from "vitest";

import { energizedWorkStop } from "@/capabilities/energized-work-stop";

import { PINNED_S5B_STOP, WARNING_POINTER_TITLE, judgeCautionPointer, servedTurnOf, visible } from "./journey-judges";

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

async function judge(body: string, opts: { rendered?: string; stop?: boolean; file?: string | undefined } = {}) {
  const t = await servedTurnOf(body);
  return judgeCautionPointer(
    { content: t.content, answerText: opts.rendered ?? PAID2_RENDERED, stop: opts.stop ?? true, served: t.citations },
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
    expect(await servedTurnOf(PAID2_SSE)).toEqual({ content: PINNED_S5B_STOP, citations: [{ page: 5, fileId: FILE, title: WARNING_POINTER_TITLE }] });
  });
  it("a `data:` frame with no space is read, as the UI reads it", async () => {
    expect((await servedTurnOf(sse([PINNED_S5B_STOP], [WARNING_CITE], "data:"))).content).toBe(PINNED_S5B_STOP);
  });
  it("#5937 r2 F3: an unterminated final frame is dropped, as the UI drops it", async () => {
    const body = sse([PINNED_S5B_STOP], []) + `data: ${JSON.stringify({ kind: "sources", citations: [WARNING_CITE] })}`;
    expect((await servedTurnOf(body)).citations).toEqual([]);
  });
  it("garbage reads as empty", async () => {
    expect(await servedTurnOf("data: {not json\n\ndata: [DONE]\n\n")).toEqual({ content: "", citations: [] });
  });
});

describe("judgeCautionPointer (S5b, pinned)", () => {
  it("the paid2 stop passes", async () => {
    expect(await judge(PAID2_SSE)).toEqual({ pass: true, p5: true, streamed: true, rendered: true, reason: null });
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
});
