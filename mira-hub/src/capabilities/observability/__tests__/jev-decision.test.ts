/**
 * The two properties that matter for a shadow judge wired into a live route:
 * it cannot change the turn, and it cannot leak what it was not given.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDecisionRequest,
  evaluateTurnDecision,
  JEV_DECISION_QUESTIONS,
  JEV_QUESTION_SET_VERSION,
} from "../jev-decision";
import { buildTurnDecisionState, renderDecisionState } from "../turn-decision-state";

const STATE = buildTurnDecisionState({
  question: "the screen is blank, what do I check  first",
  answer: "Check the DC bus voltage. r0949 holds the fault detail.",
  assetIdentity: "SIEMENS TP700 Comfort",
  observations: ["A panel nameplate reads SIEMENS SIMATIC HMI TP700 Comfort at 192.168.1.50, S/N ABC123456."],
  evidence: [{ source: "G120 List Manual", family: "SINAMICS G120", content: "r0949 Fault value." }],
  gates: {
    decision: "answered",
    evidence_sufficient: true,
    citations_shipped: 1,
    ungrounded_unit_claim: false,
    system_prompt_kind: "grounded",
    retrieval_strategy: "oem_corpus",
  },
  traceId: "abc",
  attemptId: "def",
});

afterEach(() => {
  delete process.env.MIRA_JEV_DECISION;
});

describe("the payload", () => {
  it("sends all twelve questions in ONE request", () => {
    const body = buildDecisionRequest(STATE);
    expect(Object.keys(body.questions)).toHaveLength(12);
    // Measured 2026-09-23: 1 question = 312 input tokens, 4 = 380, 12 = ~1000
    // dominated by the state. Batching is what makes per-turn evaluation viable,
    // so a split into N requests is a regression worth failing on.
    expect(Object.keys(JEV_DECISION_QUESTIONS)).toHaveLength(12);
  });

  it("names exactly one typed choice question and eleven probabilities", () => {
    const kinds = Object.values(JEV_DECISION_QUESTIONS).map((q) => q.type);
    expect(kinds.filter((k) => k === "choice")).toHaveLength(1);
    expect(kinds.filter((k) => k === "noul")).toHaveLength(11);
  });

  it("names no manufacturer, model or equipment category in any question", () => {
    // The whole finding of docs/proofs/2026-09-23-3962-detector-comparison.md is
    // that a closed vocabulary is what made the deterministic detector score
    // 0/11. A question that smuggles one back in re-creates that ceiling.
    const text = JSON.stringify(JEV_DECISION_QUESTIONS).toLowerCase();
    for (const banned of ["siemens", "sinamics", "allen", "rockwell", "vfd", "hmi", "bearing", "drive ", "contactor", "plc"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("scrubs vendor-identifying shapes out of the state it sends", () => {
    const rendered = renderDecisionState(STATE);
    expect(rendered).not.toContain("192.168.1.50");
    expect(rendered).toContain("[IP]");
    expect(rendered).not.toContain("ABC123456");
  });

  it("carries no tenant, user, notebook or credential field", () => {
    const body = JSON.stringify(buildDecisionRequest(STATE)).toLowerCase();
    for (const forbidden of ["tenant", "cookie", "authorization", "session", "user_id", "owner", "notebook", "email", "bearer"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("failure is a value, never an exception", () => {
  it("records `disabled` and makes no request when the flag is off", async () => {
    const fetchImpl = vi.fn();
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.skipped_reason).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records `no_key` rather than sending an unauthenticated request", async () => {
    process.env.MIRA_JEV_DECISION = "1";
    const prev = process.env.JEV_API_KEY;
    delete process.env.JEV_API_KEY;
    const fetchImpl = vi.fn();
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.skipped_reason).toBe("no_key");
    expect(fetchImpl).not.toHaveBeenCalled();
    if (prev) process.env.JEV_API_KEY = prev;
  });

  it("returns a record on HTTP failure instead of throwing", async () => {
    process.env.MIRA_JEV_DECISION = "1";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.skipped_reason).toBe("http_503");
    expect(r.signals).toEqual({});
  });

  it("returns a record on a network error instead of throwing", async () => {
    process.env.MIRA_JEV_DECISION = "1";
    const fetchImpl = vi.fn().mockRejectedValue(new Error("econnreset"));
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.skipped_reason).toBe("error");
  });

  it("calls an all-answers-missing response malformed, NOT a set of zero scores", async () => {
    // A judge that silently reads "no answer" as "0.0" would manufacture
    // confident verdicts out of an outage. This is the assertion that stops it.
    process.env.MIRA_JEV_DECISION = "1";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answers: {} }) });
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.skipped_reason).toBe("malformed");
    expect(r.signals).toEqual({});
  });

  it("keeps the partial signals a partial response did return", async () => {
    process.env.MIRA_JEV_DECISION = "1";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "jev-1.13.0",
        answers: { follows_evidence: { noul: 0.2 }, failure_class: { choice: "retrieval_mismatch", confidence: 0.8, probabilities: { retrieval_mismatch: 0.8 } } },
        usage: { input_tokens: 1000 },
      }),
    });
    const r = await evaluateTurnDecision(STATE, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.skipped_reason).toBeNull();
    expect(r.signals.follows_evidence).toBe(0.2);
    expect(r.signals.family_match).toBeUndefined();
    expect(r.failure_class).toBe("retrieval_mismatch");
    expect(r.question_set_version).toBe(JEV_QUESTION_SET_VERSION);
  });
});
