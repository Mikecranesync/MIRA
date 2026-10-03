/**
 * Content capture — with MIRA_OTEL_CAPTURE_CONTENT=1 the turn root carries
 * what the technician typed and what MIRA answered, scrubbed, and not cut to
 * the 512-char attribute clamp; without it, no text reaches a span at all.
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/content-capture.test.ts
 */
import { context, propagation, trace } from "@opentelemetry/api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { recordTurnContent, scrubContent } from "../content-capture";
import { CONTENT_MAX_LEN, __testing__installInMemoryExporter, getTracer, setSpanAttrs } from "../tracing";

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
const saved = process.env.MIRA_OTEL_CAPTURE_CONTENT;

beforeAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  handle = __testing__installInMemoryExporter();
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

beforeEach(() => handle.reset());
afterEach(() => {
  if (saved === undefined) delete process.env.MIRA_OTEL_CAPTURE_CONTENT;
  else process.env.MIRA_OTEL_CAPTURE_CONTENT = saved;
});

function finishTurn(content: { question?: string | null; answer?: string | null }) {
  const span = getTracer().startSpan("mira.turn", { root: true });
  recordTurnContent(span, content);
  span.end();
  const done = handle.finished().find((s) => s.name === "mira.turn");
  if (!done) throw new Error("mira.turn span not exported");
  return done.attributes;
}

describe("recordTurnContent", () => {
  it("records the typed question and the answer when capture is on", () => {
    process.env.MIRA_OTEL_CAPTURE_CONTENT = "1";
    const attrs = finishTurn({ question: "This is a test chat", answer: "Understood — ready to help." });
    expect(attrs["mira.content.question"]).toBe("This is a test chat");
    expect(attrs["mira.content.answer"]).toBe("Understood — ready to help.");
  });

  it("records nothing when capture is off", () => {
    delete process.env.MIRA_OTEL_CAPTURE_CONTENT;
    const attrs = finishTurn({ question: "This is a test chat", answer: "anything" });
    expect(attrs["mira.content.question"]).toBeUndefined();
    expect(attrs["mira.content.answer"]).toBeUndefined();
  });

  it("keeps long content past the 512-char clamp, up to CONTENT_MAX_LEN", () => {
    process.env.MIRA_OTEL_CAPTURE_CONTENT = "1";
    const answer = "a".repeat(CONTENT_MAX_LEN + 100);
    const attrs = finishTurn({ question: "q".repeat(900), answer });
    expect(attrs["mira.content.question"]).toHaveLength(900);
    expect(attrs["mira.content.answer"]).toHaveLength(CONTENT_MAX_LEN);
  });

  it("scrubs IPs, MACs and serial numbers", () => {
    process.env.MIRA_OTEL_CAPTURE_CONTENT = "1";
    const attrs = finishTurn({ question: "drive at 10.0.0.7 mac 00:1A:2B:3C:4D:5E S/N 26020500130" });
    const q = String(attrs["mira.content.question"]);
    expect(q).not.toContain("10.0.0.7");
    expect(q).not.toContain("00:1A:2B:3C:4D:5E");
    expect(q).not.toContain("26020500130");
    expect(q).toContain("[IP]");
  });

  it("still redacts secret-shaped values in content", () => {
    process.env.MIRA_OTEL_CAPTURE_CONTENT = "1";
    const attrs = finishTurn({ question: "my key is Bearer abc.def" });
    expect(attrs["mira.content.question"]).toBe("[REDACTED]");
  });
});

describe("content clamp is scoped to content keys", () => {
  it("non-content keys still clamp at 512", () => {
    const span = getTracer().startSpan("mira.turn", { root: true });
    setSpanAttrs({ "mira.other.text": "x".repeat(900) }, span);
    span.end();
    const done = handle.finished().find((s) => s.name === "mira.turn");
    expect(done?.attributes["mira.other.text"]).toHaveLength(512);
  });

  it("scrubContent truncates to CONTENT_MAX_LEN", () => {
    expect(scrubContent("z".repeat(CONTENT_MAX_LEN * 2))).toHaveLength(CONTENT_MAX_LEN);
  });
});
