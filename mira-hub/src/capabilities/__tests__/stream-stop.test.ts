// The notebook chat route must keep draining an include_usage stream after
// `finish_reason: "stop"` until the usage block (or [DONE]) arrives.
//
// Why: OpenAI sends usage on the chunk AFTER the stop marker. Stopping at the
// marker made usage capture a race on network read boundaries, and the staging
// acceptance audit (2026-10-11, run 38154158721, scenario 3) failed with
// `token usage recorded None/None` on an OpenAI-served turn.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/stream-stop

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { finishedAfterChunk } from "../stream-stop";

describe("finishedAfterChunk — canonical seam (include_usage)", () => {
  it("does NOT finish at the stop marker when usage has not arrived yet", () => {
    const r = finishedAfterChunk({ seam: true, finishReason: "stop", sawStop: false, usageSeen: false });
    expect(r).toEqual({ finished: false, sawStop: true });
  });

  it("finishes when the usage chunk lands after the stop marker (OpenAI order)", () => {
    const afterStop = finishedAfterChunk({ seam: true, finishReason: "stop", sawStop: false, usageSeen: false });
    const r = finishedAfterChunk({ seam: true, finishReason: undefined, sawStop: afterStop.sawStop, usageSeen: true });
    expect(r).toEqual({ finished: true, sawStop: true });
  });

  it("finishes immediately when stop and usage ride the same chunk", () => {
    const r = finishedAfterChunk({ seam: true, finishReason: "stop", sawStop: false, usageSeen: true });
    expect(r).toEqual({ finished: true, sawStop: true });
  });

  it("finishes at stop when usage arrived on an EARLIER chunk (Groq order)", () => {
    const r = finishedAfterChunk({ seam: true, finishReason: "stop", sawStop: false, usageSeen: true });
    expect(r.finished).toBe(true);
  });

  it("a usage chunk before any stop does not finish the stream", () => {
    const r = finishedAfterChunk({ seam: true, finishReason: undefined, sawStop: false, usageSeen: true });
    expect(r).toEqual({ finished: false, sawStop: false });
  });

  it("a content chunk with no finish_reason never finishes", () => {
    const r = finishedAfterChunk({ seam: true, finishReason: null, sawStop: false, usageSeen: false });
    expect(r).toEqual({ finished: false, sawStop: false });
  });
});

describe("finishedAfterChunk — legacy inline cascade (seam off): byte-identical behaviour", () => {
  it("finishes at the stop marker regardless of usage", () => {
    expect(finishedAfterChunk({ seam: false, finishReason: "stop", sawStop: false, usageSeen: false }).finished).toBe(true);
    expect(finishedAfterChunk({ seam: false, finishReason: "stop", sawStop: false, usageSeen: true }).finished).toBe(true);
  });
  it("control: a non-stop chunk does not finish", () => {
    expect(finishedAfterChunk({ seam: false, finishReason: undefined, sawStop: false, usageSeen: true }).finished).toBe(false);
    expect(finishedAfterChunk({ seam: false, finishReason: "length", sawStop: false, usageSeen: false }).finished).toBe(false);
  });
});

describe("source contract — the notebook chat route decides through the helper", () => {
  const route = readFileSync(
    resolve(__dirname, "../../app/api/equipment-notebooks/[id]/chat/route.ts"),
    "utf8",
  );
  it("imports and calls finishedAfterChunk inside the stream loop", () => {
    expect(route).toMatch(/import \{ finishedAfterChunk \} from "@\/capabilities\/stream-stop";/);
    expect(route).toMatch(/finishedAfterChunk\(\{\s*seam,/);
  });
  it("no longer finishes on a bare finish_reason === \"stop\" (the race)", () => {
    expect(route).not.toMatch(/finish_reason === "stop"\)\s*finished = true/);
  });
});
