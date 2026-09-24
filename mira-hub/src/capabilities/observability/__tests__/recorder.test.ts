/**
 * TurnRecorder — stage merges, timings, and the never-throws contract.
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/recorder.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spanAttrCalls: Record<string, unknown>[] = [];
vi.mock("../tracing", () => ({
  setSpanAttrs: vi.fn((attrs: Record<string, unknown>) => {
    spanAttrCalls.push(attrs);
  }),
  activeTraceId: vi.fn(() => null),
}));

import { startTurnRecorder } from "../turn-recorder";

const INIT = {
  kind: "chat" as const,
  tenantId: "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe",
  notebookId: "93d8c68e-d252-451d-8b52-e0a830543437",
  threadId: "thrd_1",
  clientRequestId: "cr-1",
  ownerUserId: "u-1",
  environment: "staging",
  gitSha: "dd41c7f8e3bac27fc0b8f2bcdbbbc4ebdb5bbf2c",
  serviceVersion: "v3.351.7",
};

beforeEach(() => {
  spanAttrCalls.length = 0;
  vi.clearAllMocks();
});

describe("startTurnRecorder — initialization", () => {
  it("builds a fully-shaped packet from init, defaulting the rest", () => {
    const rec = startTurnRecorder(INIT);
    expect(rec.packet.kind).toBe("chat");
    expect(rec.packet.ids.tenant_id).toBe(INIT.tenantId);
    expect(rec.packet.ids.notebook_id).toBe(INIT.notebookId);
    expect(rec.packet.ids.thread_id).toBe("thrd_1");
    expect(rec.packet.ids.client_request_id).toBe("cr-1");
    expect(rec.packet.environment).toBe("staging");
    expect(rec.packet.git_sha).toBe(INIT.gitSha);
  });

  it("uses an explicit traceId over activeTraceId() when given", () => {
    const rec = startTurnRecorder({ ...INIT, traceId: "abc123" });
    expect(rec.traceId).toBe("abc123");
    expect(rec.packet.trace_id).toBe("abc123");
  });

  it("falls back to activeTraceId() (stubbed null today) when no traceId is given", () => {
    const rec = startTurnRecorder(INIT);
    expect(rec.traceId).toBeNull();
    expect(rec.packet.trace_id).toBeNull();
  });

  it("applies `mode` from init onto request.mode", () => {
    const rec = startTurnRecorder({ ...INIT, mode: "grounded" });
    expect(rec.packet.request.mode).toBe("grounded");
  });

  it("defaults request.mode to general when init omits mode", () => {
    const rec = startTurnRecorder(INIT);
    expect(rec.packet.request.mode).toBe("general");
  });

  it("stamps startedAt as a real timestamp", () => {
    const before = Date.now();
    const rec = startTurnRecorder(INIT);
    const after = Date.now();
    expect(rec.startedAt).toBeGreaterThanOrEqual(before);
    expect(rec.startedAt).toBeLessThanOrEqual(after);
  });
});

describe("stage() — merges partial data into the named section", () => {
  it("merges retrieval data and mirrors it as mira.retrieval.* span attrs (design §3)", () => {
    const rec = startTurnRecorder(INIT);
    rec.stage("retrieval", {
      strategy: "skipped_general_mode",
      executed: false,
      candidate_count: 0,
      returned_doc_ids: [],
      oem_corpus_searched: false,
      zero_result_reason: "general_mode_no_sources",
      prior_visual_observations_considered: 1,
    });
    expect(rec.packet.retrieval.strategy).toBe("skipped_general_mode");
    expect(rec.packet.retrieval.executed).toBe(false);
    expect(rec.packet.retrieval.prior_visual_observations_considered).toBe(1);

    expect(spanAttrCalls).toHaveLength(1);
    expect(spanAttrCalls[0]).toEqual({
      "mira.retrieval.strategy": "skipped_general_mode",
      "mira.retrieval.executed": false,
      "mira.retrieval.candidate_count": 0,
      "mira.retrieval.returned_doc_ids": [],
      "mira.retrieval.oem_corpus_searched": false,
      "mira.retrieval.zero_result_reason": "general_mode_no_sources",
      "mira.retrieval.prior_visual_observations_considered": 1,
    });
  });

  it("a second stage() call merges rather than replaces the section", () => {
    const rec = startTurnRecorder(INIT);
    rec.stage("identity", { ran: true, state: "candidate" });
    rec.stage("identity", { candidate_count: 3 });
    expect(rec.packet.identity.ran).toBe(true);
    expect(rec.packet.identity.state).toBe("candidate");
    expect(rec.packet.identity.candidate_count).toBe(3);
  });

  it("does not mirror a nested object (e.g. generation.attempts) as a span attr", () => {
    const rec = startTurnRecorder(INIT);
    rec.stage("generation", {
      attempts: [{ provider: "Groq", model: "m", outcome: "served", latency_ms: 1, route_reason: null, response_id: null }],
      served_provider: "Groq",
    });
    expect(spanAttrCalls[0]).toEqual({ "mira.generation.served_provider": "Groq" });
  });

  it("never throws for an unknown stage name, and records it as a packet error instead", () => {
    const rec = startTurnRecorder(INIT);
    expect(() => (rec as unknown as { stage: (s: string, d: unknown) => void }).stage("not_a_real_stage", { x: 1 })).not.toThrow();
    expect(rec.packet.errors.length).toBeGreaterThan(0);
    expect(rec.packet.errors[0].stage).toBe("recorder");
  });
});

describe("timing()", () => {
  it("sets one timings_ms field without touching the others", () => {
    const rec = startTurnRecorder(INIT);
    rec.timing("vision", 3100);
    rec.timing("generation", 5200);
    expect(rec.packet.timings_ms.vision).toBe(3100);
    expect(rec.packet.timings_ms.generation).toBe(5200);
    expect(rec.packet.timings_ms.identity).toBeNull();
  });
});

describe("error()", () => {
  it("appends to packet.errors", () => {
    const rec = startTurnRecorder(INIT);
    rec.error("generation", "timeout");
    rec.error("persist", "42703");
    expect(rec.packet.errors).toEqual([
      { stage: "generation", code: "timeout" },
      { stage: "persist", code: "42703" },
    ]);
  });
});

describe("generationAttempt()", () => {
  it("appends the attempt and sets served_provider/served_model on a served outcome", () => {
    const rec = startTurnRecorder(INIT);
    rec.generationAttempt({
      provider: "Groq",
      model: "openai/gpt-oss-120b",
      outcome: "http_error",
      latency_ms: 400,
      route_reason: "primary",
      response_id: null,
    });
    rec.generationAttempt({
      provider: "Cerebras",
      model: "some-model",
      outcome: "served",
      latency_ms: 1800,
      route_reason: "fallback:Groq",
      response_id: "resp-1",
    });
    expect(rec.packet.generation.attempts).toHaveLength(2);
    expect(rec.packet.generation.served_provider).toBe("Cerebras");
    expect(rec.packet.generation.served_model).toBe("some-model");
  });

  it("does not set served_provider/served_model on a non-served attempt", () => {
    const rec = startTurnRecorder(INIT);
    rec.generationAttempt({
      provider: "Groq",
      model: "m",
      outcome: "exception",
      latency_ms: 100,
      route_reason: "primary",
      response_id: null,
    });
    expect(rec.packet.generation.served_provider).toBeNull();
  });
});

describe("finish() — never throws, always returns a shape", () => {
  it("computes timings_ms.total from startedAt when never set explicitly", () => {
    const rec = startTurnRecorder(INIT);
    const { packet } = rec.finish();
    expect(typeof packet.timings_ms.total).toBe("number");
    expect(packet.timings_ms.total as number).toBeGreaterThanOrEqual(0);
  });

  it("does not override an explicitly-set total", () => {
    const rec = startTurnRecorder(INIT);
    rec.timing("total", 9999);
    const { packet } = rec.finish();
    expect(packet.timings_ms.total).toBe(9999);
  });

  it("runs anomaly detection by default", () => {
    const rec = startTurnRecorder(INIT);
    rec.stage("request", { has_visual_evidence: true });
    rec.stage("answer_gate", { decision: "answered" });
    const { anomalies } = rec.finish();
    expect(anomalies.map((a) => a.code)).toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("skips anomaly detection when anomalyChecks: false", () => {
    const rec = startTurnRecorder(INIT);
    rec.stage("request", { has_visual_evidence: true });
    rec.stage("answer_gate", { decision: "answered" });
    const { anomalies } = rec.finish({ anomalyChecks: false });
    expect(anomalies).toEqual([]);
  });

  it("never throws even when the packet was corrupted by garbage stage() input", () => {
    const rec = startTurnRecorder(INIT);
    // Break a field detectAnomalies dereferences (.length) — finish() must
    // still return cleanly rather than propagate the TypeError.
    (rec as unknown as { stage: (s: string, d: unknown) => void }).stage("ids", { file_ids: null });
    (rec as unknown as { stage: (s: string, d: unknown) => void }).stage("request", { has_visual_evidence: "yes" });
    expect(() => rec.finish()).not.toThrow();
    const { packet, anomalies } = rec.finish();
    expect(packet).toBeDefined();
    expect(Array.isArray(anomalies)).toBe(true);
  });

  it("never throws when init itself is missing required fields", () => {
    expect(() =>
      startTurnRecorder({} as unknown as Parameters<typeof startTurnRecorder>[0]),
    ).not.toThrow();
  });
});
