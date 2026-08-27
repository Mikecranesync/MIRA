/**
 * STRM-2 (abort path) + CMPS-1 (IME guard / auto-grow) pure helpers.
 * Run: npx vitest run src/components/equipment/notebook-chat-utils.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  isAbortError,
  isEnterToSend,
  nextComposerHeight,
  readNotebookStream,
  stoppedTurn,
} from "./notebook-chat-utils";

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function streamOf(chunks: string[], opts: { abortAfter?: number } = {}) {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (opts.abortAfter != null && i === opts.abortAfter) {
        // A fetch() body reader rejects with an AbortError once the signal fires.
        ctrl.error(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      if (i >= chunks.length) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(enc.encode(chunks[i++]));
    },
  });
  return stream.getReader();
}

describe("readNotebookStream", () => {
  it("accumulates content frame by frame and returns the final turn", async () => {
    const chunks = [
      frame({ kind: "content", content: "F004 " }),
      frame({ kind: "content", content: "is undervoltage. [1]" }),
      frame({
        kind: "sources",
        citations: [{ citationId: "1", docId: "d", sourceTitle: "M", page: 1, fileId: null, quote: null }],
        sourceSnapshot: ["d"],
      }),
      frame({ kind: "evidence", basis: "oem_documentation" }),
      frame({ kind: "status", status: "answered" }),
      frame({ kind: "followups", suggestions: ["Next?"] }),
      "data: [DONE]\n\n",
    ];
    const seen: string[] = [];
    const out = await readNotebookStream(streamOf(chunks), (c) => seen.push(c));
    expect(seen).toEqual(["F004 ", "F004 is undervoltage. [1]"]);
    expect(out.content).toBe("F004 is undervoltage. [1]");
    expect(out.status).toBe("answered");
    expect(out.basis).toBe("oem_documentation");
    expect(out.citations).toHaveLength(1);
    expect(out.followups).toEqual(["Next?"]);
  });

  it("handles a frame split across two chunks", async () => {
    const whole = frame({ kind: "content", content: "hello" });
    const out = await readNotebookStream(streamOf([whole.slice(0, 9), whole.slice(9)]), () => {});
    expect(out.content).toBe("hello");
  });

  it("abort mid-stream rejects with AbortError carrying the partial text (STRM-2)", async () => {
    const chunks = [
      frame({ kind: "content", content: "The F004 " }),
      frame({ kind: "content", content: "fault is" }),
      frame({ kind: "content", content: " never reached" }),
    ];
    const seen: string[] = [];
    const p = readNotebookStream(streamOf(chunks, { abortAfter: 2 }), (c) => seen.push(c));
    await expect(p).rejects.toMatchObject({ name: "AbortError", partial: "The F004 fault is" });
    expect(seen).toEqual(["The F004 ", "The F004 fault is"]);
  });
});

describe("stoppedTurn", () => {
  it("keeps the partial text and is NOT an answered turn — no citations, basis, or follow-ups", () => {
    const t = stoppedTurn(
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        citations: [{ citationId: "1" }],
        basis: "oem_documentation",
        followups: ["x"],
      },
      "The F004 fault is",
    );
    expect(t).toMatchObject({
      id: "a1",
      content: "The F004 fault is",
      status: "error",
      stopped: true,
      citations: [],
      basis: null,
      followups: [],
    });
  });
});

describe("isAbortError", () => {
  it("recognises DOMException AbortError and rejects other errors", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("isEnterToSend (CMPS-1 IME guard)", () => {
  it("Enter sends; Shift+Enter does not", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isEnterToSend({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isEnterToSend({ key: "a", shiftKey: false })).toBe(false);
  });
  it("Enter during an IME composition never sends", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(isEnterToSend({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false } })).toBe(true);
  });
});

describe("nextComposerHeight (CMPS-1 auto-grow fallback)", () => {
  it("grows to scrollHeight and caps at the max", () => {
    expect(nextComposerHeight(40, 160)).toBe(40);
    expect(nextComposerHeight(400, 160)).toBe(160);
    expect(nextComposerHeight(-1, 160)).toBe(0);
  });
});
