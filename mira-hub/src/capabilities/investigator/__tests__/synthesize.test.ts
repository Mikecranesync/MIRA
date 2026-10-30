import { describe, expect, it } from "vitest";
import { buildSynthesisPrompt, synthesize } from "../synthesize";
import type { EvidenceItem, InvestigationInput, InvestigationPlan, SpendLedger, SufficiencyCheck, SynthesisModel } from "../types";

function baseInput(overrides: Partial<InvestigationInput> = {}): InvestigationInput {
  return {
    message: "what does F004 mean",
    role: "technician",
    tenantId: "t1",
    nodeId: null,
    docIds: ["doc-1"],
    equipment: { manufacturer: null, model: null, identityStatus: "unknown", drivePackId: null },
    ...overrides,
  };
}

function basePlan(overrides: Partial<InvestigationPlan> = {}): InvestigationPlan {
  return { codes: [], parameters: [], quantities: [], symptoms: [], intent: "other", missingFacts: [], ...overrides };
}

function baseCheck(overrides: Partial<SufficiencyCheck> = {}): SufficiencyCheck {
  return { sufficient: true, uncoveredTerms: [], inapplicableEvidenceIds: [], contradictions: [], reasons: [], ...overrides };
}

function ev(text: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: overrides.id ?? "ev-1",
    source: overrides.source ?? "manual",
    docId: overrides.docId ?? "doc-1",
    title: overrides.title ?? "Manual",
    page: overrides.page ?? 1,
    text,
    toolCallIndex: 0,
    ...overrides,
  };
}

/** A fake SpendLedger that always admits (unless `cap` is given, in which
 *  case any positive reservation is refused once cumulative spend/open
 *  would exceed it) — enough behavior for synthesize.ts's own call
 *  sequencing, without re-testing budget.ts's own file-based accounting
 *  (covered in budget.test.ts). */
class FakeLedger implements SpendLedger {
  public reserveCalls: Array<{ usd: number; label: string }> = [];
  public settleCalls: Array<{ id: string; usd: number; usage: { inputTokens: number; outputTokens: number } }> = [];
  private spent = 0;
  private nextId = 0;
  constructor(private readonly cap: number = Infinity) {}
  reserve(worstCaseUsd: number, label: string): string | null {
    this.reserveCalls.push({ usd: worstCaseUsd, label });
    if (this.spent + worstCaseUsd > this.cap) return null;
    this.nextId += 1;
    return `r${this.nextId}`;
  }
  settle(id: string, actualUsd: number, usage: { inputTokens: number; outputTokens: number }): void {
    this.settleCalls.push({ id, usd: actualUsd, usage });
    this.spent += actualUsd;
  }
  spentUsd(): number {
    return this.spent;
  }
  capUsd(): number {
    return this.cap;
  }
}

function fakeModel(
  text: string,
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 100, outputTokens: 50 },
): { model: SynthesisModel; calls: number[] } {
  const calls: number[] = [];
  const model: SynthesisModel = {
    name: "fake-model",
    complete: async (req) => {
      calls.push(req.maxOutputTokens);
      return { text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    },
  };
  return { model, calls };
}

function throwingModel(): SynthesisModel {
  return {
    name: "fake-model",
    complete: async () => {
      throw new Error("network boom");
    },
  };
}

const VALID_JSON = JSON.stringify({
  mode: "next_check",
  hypothesis: "Likely an incoming power loss.",
  cited_evidence_ids: ["ev-1"],
  uncertainty: "medium",
  next_check: { action: "Check incoming line voltage.", expected: [{ observation: "Voltage within spec", implies: "supply OK" }] },
  follow_up_question: null,
  stop_reason: null,
});

describe("buildSynthesisPrompt", () => {
  it("includes the technician message, evidence ids/text, and the sufficiency findings", () => {
    const input = baseInput();
    const plan = basePlan({ codes: ["F004"], intent: "fault_code" });
    const evidence = [ev("F004: Power Loss.", { id: "ev-1", title: "GS10 Manual" })];
    const check = baseCheck({ uncoveredTerms: ["P036"], reasons: ["no evidence covers: P036"] });
    const { system, user } = buildSynthesisPrompt(input, plan, evidence, check);
    expect(system).toContain("Cite ONLY the evidence ids");
    expect(user).toContain("what does F004 mean");
    expect(user).toContain("[ev-1]");
    expect(user).toContain("F004: Power Loss.");
    expect(user).toContain("P036");
  });

  it("omits the equipment line when neither manufacturer nor model is known", () => {
    const { user } = buildSynthesisPrompt(baseInput(), basePlan(), [], baseCheck());
    expect(user).not.toContain("Equipment:");
  });

  it("includes the equipment line when a manufacturer/model is known", () => {
    const input = baseInput({ equipment: { manufacturer: "AutomationDirect", model: "GS10", identityStatus: "user_confirmed", drivePackId: null } });
    const { user } = buildSynthesisPrompt(input, basePlan(), [], baseCheck());
    expect(user).toContain("AutomationDirect GS10");
  });

  it("lists contradictions when present", () => {
    const check = baseCheck({
      sufficient: true,
      contradictions: [{ quantity: "P036", values: [{ value: "50Hz", evidenceId: "a" }, { value: "60Hz", evidenceId: "b" }] }],
    });
    const { user } = buildSynthesisPrompt(baseInput(), basePlan(), [], check);
    expect(user).toContain("contradictions");
    expect(user).toContain("50Hz (a)");
    expect(user).toContain("60Hz (b)");
  });
});

describe("synthesize — reserve/settle ordering", () => {
  it("reserves BEFORE calling the model, then settles with the model's actual usage", async () => {
    const ledger = new FakeLedger();
    const { model } = fakeModel(VALID_JSON, { inputTokens: 120, outputTokens: 40 });
    const result = await synthesize(model, ledger, { system: "sys", user: "user text" }, 700);
    expect(ledger.reserveCalls).toHaveLength(1);
    expect(ledger.settleCalls).toHaveLength(1);
    expect(ledger.settleCalls[0].usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(result.refused).toBe(false);
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(40);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("a refused reservation NEVER calls the model", async () => {
    const ledger = new FakeLedger(0); // any positive reservation is refused
    const { model, calls } = fakeModel(VALID_JSON);
    const result = await synthesize(model, ledger, { system: "sys", user: "user text" }, 700);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ output: null, inputTokens: 0, outputTokens: 0, costUsd: 0, refused: true });
  });

  it("a model that throws settles 0 and returns output: null without throwing", async () => {
    const ledger = new FakeLedger();
    await expect(
      synthesize(throwingModel(), ledger, { system: "sys", user: "user text" }, 700),
    ).resolves.toEqual({ output: null, inputTokens: 0, outputTokens: 0, costUsd: 0, refused: false });
    expect(ledger.settleCalls).toHaveLength(1);
    expect(ledger.settleCalls[0].usd).toBe(0);
  });
});

describe("synthesize — JSON shape validation", () => {
  it("parses a valid next_check response", async () => {
    const ledger = new FakeLedger();
    const { model } = fakeModel(VALID_JSON);
    const result = await synthesize(model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toMatchObject({ mode: "next_check", hypothesis: "Likely an incoming power loss." });
  });

  it("malformed JSON text -> output null, never throws", async () => {
    const ledger = new FakeLedger();
    const { model } = fakeModel("not json at all {{{");
    const result = await synthesize(model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
    expect(result.refused).toBe(false);
  });

  it("an unknown mode value is rejected", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "diagnose", hypothesis: null, cited_evidence_ids: [], uncertainty: "low", next_check: null, follow_up_question: null, stop_reason: null });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("mode=next_check with next_check=null is rejected", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "next_check", hypothesis: null, cited_evidence_ids: [], uncertainty: "low", next_check: null, follow_up_question: null, stop_reason: null });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("mode=follow_up with a non-null next_check is rejected (co-presence invariant)", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({
      mode: "follow_up",
      hypothesis: null,
      cited_evidence_ids: [],
      uncertainty: "low",
      next_check: { action: "x", expected: [] },
      follow_up_question: "what model is this?",
      stop_reason: null,
    });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("mode=follow_up with an empty follow_up_question is rejected", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "follow_up", hypothesis: null, cited_evidence_ids: [], uncertainty: "low", next_check: null, follow_up_question: "", stop_reason: null });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("an invalid uncertainty band is rejected", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "stop_escalate", hypothesis: null, cited_evidence_ids: [], uncertainty: "extreme", next_check: null, follow_up_question: null, stop_reason: "no evidence" });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("a non-string entry in cited_evidence_ids is rejected", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "stop_escalate", hypothesis: null, cited_evidence_ids: [1, 2], uncertainty: "low", next_check: null, follow_up_question: null, stop_reason: "x" });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toBeNull();
  });

  it("accepts a valid stop_escalate response with no citations", async () => {
    const ledger = new FakeLedger();
    const text = JSON.stringify({ mode: "stop_escalate", hypothesis: null, cited_evidence_ids: [], uncertainty: "high", next_check: null, follow_up_question: null, stop_reason: "no manual available" });
    const result = await synthesize(fakeModel(text).model, ledger, { system: "sys", user: "u" }, 700);
    expect(result.output).toMatchObject({ mode: "stop_escalate", uncertainty: "high" });
  });
});
