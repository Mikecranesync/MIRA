/**
 * #5670 review 5 F14: the tracker the canonical host reads every chat response
 * through. Route-backed cuts (direct and progress, against the real chat route)
 * live in capabilities/__tests__/safety-bypass-refusal-route.test.ts; this file
 * pins the tracker's own reading rules and the host's wiring of it.
 *
 * Run: npx vitest run src/factorylm-ui/safety-stop-marker.test.ts
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trackSafetyStop } from "./safety-stop-marker";

const enc = new TextEncoder();
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const noHeaders = { get: () => null };

function readerOf(pieces: string[], end: unknown = null): ReadableStreamDefaultReader<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < pieces.length) c.enqueue(enc.encode(pieces[i++]));
      else if (end === null) c.close();
      else c.error(end);
    },
  }).getReader();
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value, { stream: true });
  }
}

const STOP = { kind: "headers", headers: { "x-safety-flag": "safety-device-bypass", "x-safety-stop": "safety-device-bypass" } };

describe("trackSafetyStop reads the stop the response names", () => {
  it("the direct response's own header", () => {
    expect(trackSafetyStop({ get: (n: string) => (n === "X-Safety-Stop" ? "safety-device-bypass" : null) }).current()).toEqual({
      kind: "safety_notice",
      trigger: "safety-device-bypass",
    });
  });

  it("control: no header, no stop", () => {
    expect(trackSafetyStop(noHeaders).current()).toBeNull();
  });

  it("the progress transport's headers frame, after progress frames, split across chunks", async () => {
    const stop = trackSafetyStop(noHeaders);
    const raw = frame({ kind: "progress", stage: "finding_equipment" }) + frame(STOP) + frame({ kind: "sources", citations: [] });
    const cut = raw.indexOf("x-safety-stop") + 4;
    const text = await drain(stop.watch(readerOf([raw.slice(0, cut), raw.slice(cut)])));
    expect(text).toBe(raw);
    expect(stop.current()).toEqual({ kind: "safety_notice", trigger: "safety-device-bypass" });
  });

  it("a header name in any case", async () => {
    const stop = trackSafetyStop(noHeaders);
    await drain(stop.watch(readerOf([frame({ kind: "headers", headers: { "X-Safety-Stop": "arc flash" } })])));
    expect(stop.current()).toEqual({ kind: "safety_notice", trigger: "arc flash" });
  });

  it("control: a headers frame with only a flag is no stop", async () => {
    const stop = trackSafetyStop(noHeaders);
    await drain(stop.watch(readerOf([frame({ kind: "headers", headers: { "x-safety-flag": "smoke" } }), frame({ kind: "content", content: "x" })])));
    expect(stop.current()).toBeNull();
  });

  it("control: only the transport's leading headers frame counts, never one inside the turn's body", async () => {
    const stop = trackSafetyStop(noHeaders);
    await drain(stop.watch(readerOf([frame({ kind: "sources", citations: [] }) + frame(STOP)])));
    expect(stop.current()).toBeNull();
  });
});

describe("the tracker fills only an absent notice", () => {
  it("a thrown interruption with no notice carries the stop; the same error object is returned", () => {
    const stop = trackSafetyStop({ get: () => "safety-device-bypass" });
    const err = new TypeError("network reset");
    expect(stop.carry(err)).toBe(err);
    expect((err as unknown as { safetyNotice: unknown }).safetyNotice).toEqual({ kind: "safety_notice", trigger: "safety-device-bypass" });
  });

  it("an interruption that already carries a notice keeps it", () => {
    const stop = trackSafetyStop({ get: () => "safety-device-bypass" });
    const err = Object.assign(new TypeError("network reset"), { safetyNotice: { kind: "safety_notice", trigger: "arc flash" } });
    stop.carry(err);
    expect(err.safetyNotice.trigger).toBe("arc flash");
  });

  it("control: with no stop named the error is untouched", () => {
    const err = new TypeError("network reset");
    trackSafetyStop(noHeaders).carry(err);
    expect("safetyNotice" in err).toBe(false);
  });

  it("settle fills a finished result's missing notice and leaves a present one alone", () => {
    const stop = trackSafetyStop({ get: () => "safety-device-bypass" });
    expect(stop.settle({ safetyNotice: null })).toEqual({ safetyNotice: { kind: "safety_notice", trigger: "safety-device-bypass" } });
    const present = { safetyNotice: { kind: "safety_notice" as const, trigger: "arc flash" } };
    expect(stop.settle(present)).toBe(present);
    const none = { safetyNotice: null };
    expect(trackSafetyStop(noHeaders).settle(none)).toBe(none);
  });

  it("the wrapped reader passes a failure through as the same error", async () => {
    const boom = new TypeError("network reset");
    const reader = trackSafetyStop(noHeaders).watch(readerOf([frame({ kind: "progress", stage: "finding_equipment" })], boom));
    await reader.read();
    await expect(reader.read()).rejects.toBe(boom);
  });
});

describe("the canonical host reads every chat response through the tracker (hub-host.tsx send)", () => {
  const src = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const send = src.slice(src.indexOf("x-mira-progress"), src.indexOf("benchGate.endSend()"));

  it("tracks the response, reads through it, seeds and settles the parser, and carries the stop on a throw", () => {
    expect(send).toContain("stop = trackSafetyStop(res.headers);");
    expect(send).toContain("const reader = stop.watch(stream.getReader());");
    expect(send).toMatch(/const result = stop\.settle\(await readNotebookStream\(reader, [\s\S]*?\}, stop\.current\(\), \{/);
    expect(send).toContain("const retained = retainedStreamInterruption(stop ? stop.carry(err) : err);");
    // The parser is never handed a hard-coded null notice again.
    expect(send).not.toMatch(/readNotebookStream\([^)]*\}, null, \{/);
  });
});
