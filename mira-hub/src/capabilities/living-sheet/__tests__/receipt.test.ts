/**
 * TASK-S2 — withSheetReceipt. Unit tests against mocked loadJob/propose so
 * the SSE-injection mechanics (boundary safety, fall-through-on-error) are
 * exercised in isolation from the real store/DB.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const loadJobMock = vi.hoisted(() => vi.fn());
const proposeSheetUpdatesMock = vi.hoisted(() => vi.fn());

vi.mock("../store", () => ({ loadJob: loadJobMock }));
vi.mock("../propose", () => ({ proposeSheetUpdates: proposeSheetUpdatesMock }));

import { withSheetReceipt, type SheetReceiptContext } from "../receipt";

const CTX: SheetReceiptContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  notebookId: "22222222-2222-4222-8222-222222222222",
  jobId: "33333333-3333-4333-8333-333333333333",
  techText: "motor current 48 A",
};

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const SOME_VIEW = { seq: 7, jobId: CTX.jobId } as unknown;

beforeEach(() => {
  loadJobMock.mockReset();
  proposeSheetUpdatesMock.mockReset();
});

describe("withSheetReceipt", () => {
  it("inserts exactly one sheet_receipt frame immediately before [DONE]", async () => {
    loadJobMock.mockResolvedValue({ status: "ok", view: SOME_VIEW });
    proposeSheetUpdatesMock.mockReturnValue([{ proposalId: "p1" }]);
    const res = new Response(streamOf(['data: {"kind":"trace"}\n\n', "data: [DONE]\n\n"]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const out = await withSheetReceipt(res, CTX);
    const body = await readAll(out);

    const doneIdx = body.indexOf("data: [DONE]");
    const receiptIdx = body.indexOf('"kind":"sheet_receipt"');
    expect(doneIdx).toBeGreaterThan(-1);
    expect(receiptIdx).toBeGreaterThan(-1);
    expect(receiptIdx).toBeLessThan(doneIdx);
    expect(body.indexOf('"kind":"sheet_receipt"', receiptIdx + 1)).toBe(-1); // exactly one
    // frame shape
    const frameLine = body.slice(body.lastIndexOf("data: ", receiptIdx), body.indexOf("\n\n", receiptIdx) + 1);
    const frame = JSON.parse(frameLine.replace(/^data: /, "").trim());
    expect(frame).toEqual({ kind: "sheet_receipt", jobId: CTX.jobId, baseSeq: 7, proposals: [{ proposalId: "p1" }] });
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toBe("text/event-stream");
  });

  it("still sends the frame with proposals: [] when the proposer finds nothing", async () => {
    loadJobMock.mockResolvedValue({ status: "ok", view: SOME_VIEW });
    proposeSheetUpdatesMock.mockReturnValue([]);
    const res = new Response(streamOf(["data: [DONE]\n\n"]), { status: 200 });
    const body = await readAll(await withSheetReceipt(res, CTX));
    expect(body).toContain('"proposals":[]');
  });

  it("detects [DONE] split across two chunk boundaries", async () => {
    loadJobMock.mockResolvedValue({ status: "ok", view: SOME_VIEW });
    proposeSheetUpdatesMock.mockReturnValue([]);
    const res = new Response(streamOf(["data: [DO", "NE]\n\n"]), { status: 200 });
    const body = await readAll(await withSheetReceipt(res, CTX));
    expect(body).toContain('"kind":"sheet_receipt"');
    expect(body).toContain("data: [DONE]");
    expect(body.indexOf('"kind":"sheet_receipt"')).toBeLessThan(body.indexOf("data: [DONE]"));
  });

  it("[DONE] never appears -> stream passes through untouched, nothing inserted", async () => {
    loadJobMock.mockResolvedValue({ status: "ok", view: SOME_VIEW });
    proposeSheetUpdatesMock.mockReturnValue([{ proposalId: "p1" }]);
    const chunks = ['data: {"kind":"trace"}\n\n', 'data: {"kind":"usage"}\n\n'];
    const res = new Response(streamOf(chunks), { status: 200 });
    const body = await readAll(await withSheetReceipt(res, CTX));
    expect(body).toBe(chunks.join(""));
    expect(body).not.toContain("sheet_receipt");
  });

  it("job_not_found -> returns the original response unchanged", async () => {
    loadJobMock.mockResolvedValue({ status: "job_not_found" });
    const chunks = ["data: [DONE]\n\n"];
    const res = new Response(streamOf(chunks), { status: 200 });
    const out = await withSheetReceipt(res, CTX);
    const body = await readAll(out);
    expect(body).toBe(chunks.join(""));
    expect(proposeSheetUpdatesMock).not.toHaveBeenCalled();
  });

  it("loadJob throwing -> returns the original response unchanged", async () => {
    loadJobMock.mockRejectedValue(new Error("db unavailable"));
    const chunks = ["data: [DONE]\n\n"];
    const res = new Response(streamOf(chunks), { status: 200 });
    const out = await withSheetReceipt(res, CTX);
    const body = await readAll(out);
    expect(body).toBe(chunks.join(""));
  });

  it("a non-streaming response (null body) is returned unchanged", async () => {
    const res = new Response(null, { status: 204 });
    const out = await withSheetReceipt(res, CTX);
    expect(out).toBe(res);
    expect(loadJobMock).not.toHaveBeenCalled();
  });

  it("preserves status and headers on the wrapped response", async () => {
    loadJobMock.mockResolvedValue({ status: "ok", view: SOME_VIEW });
    proposeSheetUpdatesMock.mockReturnValue([]);
    const res = new Response(streamOf(["data: [DONE]\n\n"]), {
      status: 207,
      statusText: "Multi",
      headers: { "x-custom": "yes" },
    });
    const out = await withSheetReceipt(res, CTX);
    expect(out.status).toBe(207);
    expect(out.headers.get("x-custom")).toBe("yes");
  });
});
