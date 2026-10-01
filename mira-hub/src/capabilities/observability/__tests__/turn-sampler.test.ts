import { afterEach, describe, expect, it } from "vitest";
import { ROOT_CONTEXT, SpanKind, TraceFlags, context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, SamplingDecision } from "@opentelemetry/sdk-trace-base";

import { autoInstrumentEnabled, turnOnlySampler, turnSampleRatio } from "../turn-sampler";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

function root(name: string, ratio = 1) {
  return turnOnlySampler(ratio).shouldSample(ROOT_CONTEXT, TRACE, name, SpanKind.INTERNAL, {}, []).decision;
}

function child(parentSampled: boolean, name: string) {
  const parent = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE,
    spanId: "b7ad6b7169203331",
    traceFlags: parentSampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: false,
  });
  return turnOnlySampler(1).shouldSample(parent, TRACE, name, SpanKind.CLIENT, {}, []).decision;
}

describe("turn-only sampling (#4103)", () => {
  it("keeps a trace rooted at mira.turn", () => {
    expect(root("mira.turn")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it.each(["GET", "POST", "pg-pool.connect", "moby.filesync.v1.FileSync/DiffCopy", "retrieval.execute"])(
    "drops a trace rooted at %s",
    (name) => {
      expect(root(name)).toBe(SamplingDecision.NOT_RECORD);
    },
  );

  it("children of a kept turn are kept, children of a dropped root are dropped", () => {
    expect(child(true, "pg.query")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(child(false, "pg.query")).toBe(SamplingDecision.NOT_RECORD);
  });

  it("a zero ratio drops even turns (downgrade lever)", () => {
    expect(root("mira.turn", 0)).toBe(SamplingDecision.NOT_RECORD);
  });

  it("reads the ratio from the environment, clamped, with bad values meaning 1", () => {
    delete process.env.MIRA_OTEL_TURN_SAMPLE_RATIO;
    expect(turnSampleRatio()).toBe(1);
    process.env.MIRA_OTEL_TURN_SAMPLE_RATIO = "0.25";
    expect(turnSampleRatio()).toBe(0.25);
    process.env.MIRA_OTEL_TURN_SAMPLE_RATIO = "7";
    expect(turnSampleRatio()).toBe(1);
    process.env.MIRA_OTEL_TURN_SAMPLE_RATIO = "-1";
    expect(turnSampleRatio()).toBe(0);
    process.env.MIRA_OTEL_TURN_SAMPLE_RATIO = "abc";
    expect(turnSampleRatio()).toBe(1);
  });

  it("automatic instrumentation is opt-in", () => {
    delete process.env.MIRA_OTEL_AUTO_INSTRUMENT;
    expect(autoInstrumentEnabled()).toBe(false);
    process.env.MIRA_OTEL_AUTO_INSTRUMENT = "1";
    expect(autoInstrumentEnabled()).toBe(true);
  });
});

describe("the turn routes' root span under a framework request span (#4103)", () => {
  // Next.js opens its own span around every route handler. A `mira.turn`
  // started as its child inherits that root's NOT_RECORD decision, so the
  // routes start it with `{ root: true }`.
  const tracer = new BasicTracerProvider({ sampler: turnOnlySampler(1) }).getTracer("t");

  it("a child mira.turn inside a dropped request span is dropped", () => {
    const req = tracer.startSpan("POST /api/equipment-notebooks/[id]/chat");
    expect(req.isRecording()).toBe(false);
    const turn = tracer.startSpan("mira.turn", {}, trace.setSpan(context.active(), req));
    expect(turn.isRecording()).toBe(false);
  });

  it("a root:true mira.turn inside the same request span is kept", () => {
    const req = tracer.startSpan("POST /api/equipment-notebooks/[id]/chat");
    const turn = tracer.startSpan("mira.turn", { root: true }, trace.setSpan(context.active(), req));
    expect(turn.isRecording()).toBe(true);
  });
});

describe("remote parents never bypass the turn filter (#4107 review F1)", () => {
  const remote = (sampled: boolean) =>
    trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE,
      spanId: "b7ad6b7169203331",
      traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
      isRemote: true,
    });

  it.each([
    [true, 1],
    [true, 0],
    [false, 1],
    [false, 0],
  ])("a GET continuing a remote parent (sampled=%s, ratio=%s) is dropped", (sampled, ratio) => {
    const d = turnOnlySampler(ratio).shouldSample(remote(sampled), TRACE, "GET /api/health", SpanKind.SERVER, {}, []);
    expect(d.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it("a root:true mira.turn under a sampled remote request is kept, and its local child follows it", () => {
    const tracer = new BasicTracerProvider({ sampler: turnOnlySampler(1) }).getTracer("t");
    const turn = tracer.startSpan("mira.turn", { root: true }, remote(true));
    expect(turn.isRecording()).toBe(true);
    const child = tracer.startSpan("retrieval.execute", undefined, trace.setSpan(context.active(), turn));
    expect(child.isRecording()).toBe(true);
  });

  // Codex #4194 F1: a detached manual-acquisition root is its own trace, linked
  // to the turn that started it. It is kept exactly when that turn was kept.
  describe("detached manual_acquisition.run roots", () => {
    const link = (sampled: boolean) => ({
      context: {
        traceId: "1af7651916cd43dd8448eb211c80319c",
        spanId: "c7ad6b7169203331",
        traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
      },
    });
    const acq = (links: ReturnType<typeof link>[]) =>
      turnOnlySampler(1).shouldSample(ROOT_CONTEXT, TRACE, "manual_acquisition.run", SpanKind.INTERNAL, {}, links)
        .decision;

    it("kept when linked to a sampled turn", () => {
      expect(acq([link(true)])).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    });
    it("dropped when its turn was dropped, or when it has no turn at all", () => {
      expect(acq([link(false)])).toBe(SamplingDecision.NOT_RECORD);
      expect(acq([])).toBe(SamplingDecision.NOT_RECORD);
    });
    it("no other root name gets in through a link", () => {
      expect(
        turnOnlySampler(1).shouldSample(ROOT_CONTEXT, TRACE, "GET", SpanKind.INTERNAL, {}, [link(true)]).decision,
      ).toBe(SamplingDecision.NOT_RECORD);
    });
  });
});
