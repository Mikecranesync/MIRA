/**
 * $0 deterministic proposer's SSE delivery — TASK-S2.
 *
 * Loads the job's current view via the S1 store, runs the pure proposer
 * (propose.ts) against the technician's own turn text, and pipes the
 * route's SSE response through a boundary-safe TransformStream that
 * inserts exactly one `sheet_receipt` frame immediately before the first
 * `data: [DONE]`. If `[DONE]` never appears, nothing is inserted. Any
 * error (missing job, storage unavailable, no body) returns the ORIGINAL
 * response, unchanged — this must never be the reason a chat turn fails.
 */
import type { NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import { loadJob } from "./store";
import { proposeSheetUpdates } from "./propose";

export type SheetReceiptContext = {
  tenantId: string;
  notebookId: string;
  jobId: string;
  techText: string;
  /** F08: the chat message/turn id (e.g. the route's `clientRequestId` /
   *  `turnId`), stable across a retry of the SAME turn and distinct across
   *  two SEPARATE turns. Threaded into `proposeSheetUpdates` so identical
   *  technician words in two different turns get distinct proposal/payload
   *  ids instead of colliding in the store's dedup-by-id check. Optional
   *  only for back-compat with a caller that has not been wired up yet —
   *  omitting it reproduces the pre-fix collision. */
  turnId?: string;
};

const DONE_MARK = "data: [DONE]";
// How much of the decoded tail must be held back at any time so a marker
// split across two chunk boundaries is never missed: enough bytes to hold
// everything but the final character of the marker.
const TAIL = DONE_MARK.length - 1;

/** Boundary-safe: scans a byte stream (decoded incrementally, so a
 *  multi-byte UTF-8 character split across chunks is never corrupted) for
 *  the first `data: [DONE]` and inserts `frameBytes` immediately before
 *  it, without buffering anything beyond the small tail needed to detect a
 *  split marker. Everything after the first match passes through
 *  untouched; if the marker never arrives, `flush` emits the held tail
 *  as-is (no frame). */
function receiptTransform(frameBytes: Uint8Array): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";
  let injected = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (injected) {
        controller.enqueue(chunk);
        return;
      }
      carry += decoder.decode(chunk, { stream: true });
      const idx = carry.indexOf(DONE_MARK);
      if (idx !== -1) {
        if (idx > 0) controller.enqueue(encoder.encode(carry.slice(0, idx)));
        controller.enqueue(frameBytes);
        controller.enqueue(encoder.encode(carry.slice(idx)));
        injected = true;
        carry = "";
        return;
      }
      if (carry.length > TAIL) {
        const safe = carry.slice(0, carry.length - TAIL);
        controller.enqueue(encoder.encode(safe));
        carry = carry.slice(carry.length - TAIL);
      }
    },
    flush(controller) {
      carry += decoder.decode();
      if (carry) controller.enqueue(encoder.encode(carry));
    },
  });
}

/**
 * Wraps `res` so a `sheet_receipt` frame is inserted before `[DONE]`.
 * Status and headers are preserved exactly. Any failure (including
 * `res.body` being null — a non-streaming response) returns `res` itself.
 */
export async function withSheetReceipt(res: Response, ctx: SheetReceiptContext): Promise<Response> {
  try {
    if (!res.body) return res;

    const result = await loadJob(ctx.tenantId, ctx.notebookId, ctx.jobId);
    if (result.status !== "ok") return res;
    const view = result.view;

    const proposals = proposeSheetUpdates(ctx.techText, view, ctx.turnId);
    const frame: NotebookSheetReceiptFrame = {
      kind: "sheet_receipt",
      jobId: ctx.jobId,
      baseSeq: view.seq,
      proposals,
    };
    const frameBytes = new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);

    const body = res.body.pipeThrough(receiptTransform(frameBytes));
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch {
    return res;
  }
}
