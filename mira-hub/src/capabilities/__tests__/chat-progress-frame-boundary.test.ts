/**
 * #5479 — a progress frame must never land inside another frame.
 *
 * Seen on staging 2199f449a (CV-101 S12, 2026-11-13): the turn had an open job, so its response
 * went through `withSheetReceipt`, whose transform holds back the last 11 bytes of what it has
 * read while it looks for the end marker. The trace frame therefore left it in two pieces. The
 * early progress stream forwarded the first piece, then wrote `checking_answer`, then the rest:
 *
 *   data: {"kind":"trace",…,"turnId":"5759d440-…-20179data: {"kind":"progress",…}\n\n2b752de"}\n\n
 *
 * Neither frame parses. The rule pinned here: the progress stream forwards the turn's bytes only
 * up to the end of a whole frame, wherever the split came from.
 *
 * Run: npx vitest run src/capabilities/__tests__/chat-progress-frame-boundary.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/capabilities/living-sheet/store", () => ({
  loadJob: vi.fn(async () => ({ status: "ok", view: { seq: 3 } })),
}));
vi.mock("@/capabilities/living-sheet/propose", () => ({ proposeSheetUpdates: vi.fn(() => []) }));

import { reportProgress, withProgressStream } from "../chat-progress";
import { withSheetReceipt } from "../living-sheet/receipt";

const enc = new TextEncoder();
const TRACE = { kind: "trace", traceId: "d0b4258fffb83b632e963c03aa175176", turnId: "5759d440-e377-48f7-8c72-201792b752de" };
const CONTENT = { kind: "content", content: "Every step is marked done — “CV-101”." };
const STATUS = { kind: "status", status: "answered" };
const sse = (frame: unknown) => `data: ${JSON.stringify(frame)}\n\n`;
const DONE = "data: [DONE]\n\n";
const tick = () => new Promise((r) => setTimeout(r, 15));
const request = () => new Request("http://test/chat", { method: "POST", headers: { "x-mira-progress": "1" } });
const sseResponse = (body: ReadableStream<Uint8Array>) => new Response(body, { headers: { "Content-Type": "text/event-stream" } });

/** A turn's response that writes `pieces` one at a time, running `between[i]` after piece i has
 *  had time to reach the reader. */
function turn(pieces: Uint8Array[], between: Record<number, () => void>): Response {
  return sseResponse(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < pieces.length; i++) {
          controller.enqueue(pieces[i]);
          if (between[i]) {
            await tick();
            between[i]();
            await tick();
          }
        }
        controller.close();
      },
    }),
  );
}

async function read(res: Response): Promise<{ raw: string; blocks: string[] }> {
  const raw = await res.text();
  return { raw, blocks: raw.split("\n\n").filter((b) => b.length > 0) };
}
/** Every block is one whole frame: `data: ` + one JSON object, or the end marker. */
function parsed(blocks: string[]): unknown[] {
  return blocks.map((b) => {
    expect(b.startsWith("data: ")).toBe(true);
    const payload = b.slice(6);
    return payload === "[DONE]" ? "[DONE]" : (JSON.parse(payload) as unknown);
  });
}

describe("#5479 — the progress stream writes each frame whole", () => {
  it("a stage reported while a sheet-receipt turn's trace frame is half out lands after it, not inside it", async () => {
    const req = request();
    const res = withProgressStream(req, async () => {
      const inner = turn([enc.encode(sse(TRACE)), enc.encode(sse(CONTENT) + sse(STATUS) + DONE)], {
        0: () => reportProgress(req, "checking_answer"),
      });
      return withSheetReceipt(inner, { tenantId: "t", notebookId: "n", jobId: "j", techText: "What did I note?", turnId: TRACE.turnId });
    });
    const { blocks } = await read(res);
    const frames = parsed(blocks);
    expect(frames).toEqual([
      { kind: "progress", stage: "checking_answer" },
      TRACE,
      CONTENT,
      STATUS,
      { kind: "sheet_receipt", jobId: "j", baseSeq: 3, proposals: [] },
      "[DONE]",
    ]);
  });

  // The second cut is between the frame's two closing newlines: one newline is not a frame end.
  it.each([
    ["inside its JSON", 100],
    ["between its two closing newlines", sse(TRACE).length - 1],
  ])("a frame that arrives in two pieces from any source is kept whole: cut %s", async (_where, cut) => {
    const req = request();
    const whole = enc.encode(sse(TRACE));
    const res = withProgressStream(req, async () =>
      turn([whole.subarray(0, cut), whole.subarray(cut), enc.encode(sse(STATUS) + DONE)], {
        0: () => reportProgress(req, "checking_answer"),
      }),
    );
    expect(parsed((await read(res)).blocks)).toEqual([{ kind: "progress", stage: "checking_answer" }, TRACE, STATUS, "[DONE]"]);
  });

  it("control: a stage reported between two whole frames is written between them, at once", async () => {
    const req = request();
    const res = withProgressStream(req, async () =>
      turn([enc.encode(sse(TRACE)), enc.encode(sse(STATUS) + DONE)], { 0: () => reportProgress(req, "checking_answer") }),
    );
    expect(parsed((await read(res)).blocks)).toEqual([TRACE, { kind: "progress", stage: "checking_answer" }, STATUS, "[DONE]"]);
  });

  it("control: a whole frame is forwarded when it arrives, not held for the next one", async () => {
    const req = request();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const res = withProgressStream(req, async () =>
      sseResponse(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(enc.encode(sse(TRACE)));
            await gate;
            controller.enqueue(enc.encode(DONE));
            controller.close();
          },
        }),
      ),
    );
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(sse(TRACE));
    release();
    await reader.cancel();
  });

  it("no byte is lost or changed: split characters, and a last frame with no blank line after it", async () => {
    const req = request();
    const body = enc.encode(sse(TRACE) + sse(CONTENT) + "data: [DONE]");
    // Cut inside the three-byte dash of CONTENT and inside the trace frame.
    const dash = body.indexOf(0xe2);
    const res = withProgressStream(req, async () =>
      turn([body.subarray(0, 40), body.subarray(40, dash + 1), body.subarray(dash + 1)], {
        0: () => reportProgress(req, "generating_answer"),
        1: () => reportProgress(req, "checking_answer"),
      }),
    );
    const { raw, blocks } = await read(res);
    expect(parsed(blocks)).toEqual([
      { kind: "progress", stage: "generating_answer" },
      TRACE,
      { kind: "progress", stage: "checking_answer" },
      CONTENT,
      "[DONE]",
    ]);
    expect(raw.endsWith("data: [DONE]")).toBe(true);
  });
});
