/**
 * #4687 — the web Hub's stream reader understands the opted-in progress stream:
 * `progress` frames are reported in order, and an `http_error` frame (the server
 * opened the stream before its handler failed validation/auth) becomes a typed
 * error AFTER the read — never an interrupted, half-delivered answer.
 *
 * Run: npx vitest run src/factorylm-ui/notebook-chat-progress.test.ts
 */
import { describe, expect, it } from "vitest";
import { NotebookHttpError, readNotebookStream } from "@/components/equipment/notebook-chat-utils";
import { livePartsWhileRunning } from "@/factorylm-ui/to-interaction";

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
function streamOf(chunks: string[]) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i >= chunks.length) return ctrl.close();
      ctrl.enqueue(enc.encode(chunks[i++]));
    },
  }).getReader();
}

describe("readNotebookStream — progress frames", () => {
  it("reports each stage in order and still delivers the answer", async () => {
    const stages: string[] = [];
    const out = await readNotebookStream(
      streamOf([
        frame({ kind: "progress", stage: "finding_equipment" }),
        frame({ kind: "progress", stage: "searching_documentation" }),
        frame({ kind: "progress", stage: "generating_answer" }),
        frame({ kind: "headers", headers: { "x-mira-trace-id": "t" } }),
        frame({ kind: "content", content: "Check the overload." }),
        frame({ kind: "status", status: "answered" }),
        "data: [DONE]\n\n",
      ]),
      () => {},
      null,
      { onProgress: (s) => stages.push(s) },
    );
    expect(stages).toEqual(["finding_equipment", "searching_documentation", "generating_answer"]);
    expect(out.content).toBe("Check the overload.");
    expect(out.status).toBe("answered");
  });

  it("ignores a progress frame with an unknown stage instead of showing it", async () => {
    const stages: string[] = [];
    await readNotebookStream(streamOf([frame({ kind: "progress", stage: "secret_internal_step" }), frame({ kind: "status", status: "answered" })]), () => {}, null, {
      onProgress: (s) => stages.push(s),
    });
    expect(stages).toEqual([]);
  });

  it("turns an http_error frame into a NotebookHttpError with the route's status and code", async () => {
    const p = readNotebookStream(
      streamOf([frame({ kind: "progress", stage: "finding_equipment" }), frame({ kind: "http_error", status: 401, body: { error: "unauthorized" } }), "data: [DONE]\n\n"]),
      () => {},
    );
    await expect(p).rejects.toBeInstanceOf(NotebookHttpError);
    await p.catch((e: NotebookHttpError) => {
      expect(e.status).toBe(401);
      expect(e.code).toBe("unauthorized");
      expect("partial" in e).toBe(false); // not an interrupted answer
    });
  });
});

describe("livePartsWhileRunning", () => {
  it("shows the progress stage until real answer text arrives, then only the text", () => {
    expect(livePartsWhileRunning("", undefined)).toEqual([]);
    expect(livePartsWhileRunning("", "searching_documentation")).toEqual([{ type: "progress", stage: "searching_documentation" }]);
    expect(livePartsWhileRunning("Check the", "checking_answer")).toEqual([{ type: "text", text: "Check the" }]);
  });
});
