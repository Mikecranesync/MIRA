import { describe, expect, it } from "vitest";
import { investigate, distinctCodes, ROUND2_EXTRA_EVIDENCE } from "../runner";
import type {
  EvidenceItem,
  InvestigationInput,
  InvestigatorTools,
  SpendLedger,
  SynthesisModel,
} from "../types";

function baseInput(overrides: Partial<InvestigationInput> = {}): InvestigationInput {
  return {
    message: "what does F004 mean",
    role: "technician",
    tenantId: "t1",
    nodeId: "node-1",
    docIds: ["doc-1"],
    equipment: { manufacturer: "AutomationDirect", model: "GS10", identityStatus: "user_confirmed", drivePackId: null },
    ...overrides,
  };
}

let evCounter = 0;
function ev(text: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  evCounter += 1;
  return {
    id: overrides.id ?? `ev-${evCounter}`,
    source: overrides.source ?? "manual",
    docId: overrides.docId ?? "doc-1",
    title: overrides.title ?? "GS10 Manual",
    page: overrides.page ?? 1,
    text,
    toolCallIndex: 0,
    ...overrides,
  };
}

interface FakeToolsSpec {
  searchManual?: EvidenceItem[];
  lookupCode?: Record<string, EvidenceItem[]>;
  lookupParameter?: Record<string, EvidenceItem[]>;
  drivePackLookup?: EvidenceItem[];
}

/** Records every call it receives (for assertions) and returns canned
 *  evidence per the spec above; equipmentHistory/liveData always report
 *  "unavailable" with no items, per InvestigatorTools's own offline
 *  contract. */
function fakeTools(spec: FakeToolsSpec = {}): InvestigatorTools & { calls: { tool: string; input: unknown }[] } {
  const calls: { tool: string; input: unknown }[] = [];
  return {
    calls,
    async searchManual(q) {
      calls.push({ tool: "search_manual", input: q });
      return spec.searchManual ?? [];
    },
    async lookupCode(q) {
      calls.push({ tool: "lookup_code", input: q });
      return spec.lookupCode?.[q.code] ?? [];
    },
    async lookupParameter(q) {
      calls.push({ tool: "lookup_parameter", input: q });
      return spec.lookupParameter?.[q.parameter] ?? [];
    },
    async drivePackLookup(q) {
      calls.push({ tool: "drive_pack_lookup", input: q });
      return spec.drivePackLookup ?? [];
    },
    async equipmentHistory(q) {
      calls.push({ tool: "equipment_history", input: q });
      return { status: "unavailable", items: [] };
    },
    async liveData(q) {
      calls.push({ tool: "live_data", input: q });
      return { status: "unavailable", items: [] };
    },
  };
}

function fakeModel(
  text: string,
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 50, outputTokens: 30 },
): SynthesisModel & { calls: number } {
  let calls = 0;
  return {
    name: "fake-model",
    get calls() {
      return calls;
    },
    async complete() {
      calls += 1;
      return { text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    },
  } as SynthesisModel & { calls: number };
}

/** A simple in-memory SpendLedger — admits everything under `cap` (default
 *  unlimited). budget.ts's own file-based accounting is covered by
 *  budget.test.ts; this fake only needs to behave like the interface for
 *  runner.ts's call sequencing. */
function fakeLedger(cap = Infinity): SpendLedger {
  let spent = 0;
  let nextId = 0;
  return {
    reserve(worstCaseUsd) {
      if (spent + worstCaseUsd > cap) return null;
      nextId += 1;
      return `r${nextId}`;
    },
    settle(_id, actualUsd) {
      spent += actualUsd;
    },
    spentUsd() {
      return spent;
    },
    capUsd() {
      return cap;
    },
  };
}

const VALID_NEXT_CHECK = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    mode: "next_check",
    hypothesis: "Likely a power-loss fault.",
    cited_evidence_ids: ["ev-1"],
    uncertainty: "medium",
    next_check: { action: "Check incoming line voltage.", expected: [{ observation: "Voltage within spec", implies: "supply OK" }] },
    follow_up_question: null,
    stop_reason: null,
    ...overrides,
  });

describe("investigate — hazard gate", () => {
  it("a hazard STOP runs 0 tool calls and 0 model calls", async () => {
    const tools = fakeTools();
    const model = fakeModel(VALID_NEXT_CHECK());
    const result = await investigate(baseInput({ message: "how do I bypass the e-stop so I can keep running?" }), {
      tools,
      model,
      ledger: fakeLedger(),
      arm: "H1",
    });
    expect(result.mode).toBe("safety_stop");
    expect(result.trace.stopReason).toBe("hazard_stop");
    expect(tools.calls).toHaveLength(0);
    expect(model.calls).toBe(0);
    expect(result.trace.toolCalls).toHaveLength(0);
    expect(result.trace.model.calls).toBe(0);
    expect(result.trace.plan).toBeNull();
    expect(result.hazardBanner).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it("a hazard FLAG carries a hazardBanner forward and still investigates", async () => {
    const tools = fakeTools({ searchManual: [ev("DC bus voltage: 620 V nominal.")] });
    const model = fakeModel(VALID_NEXT_CHECK({ cited_evidence_ids: [] }));
    const result = await investigate(baseInput({ message: "The DC bus reads 620V on my multimeter — is that within spec?" }), {
      tools,
      model,
      ledger: fakeLedger(),
      arm: "H1",
    });
    expect(result.trace.hazard.kind).toBe("flag");
    expect(result.hazardBanner).not.toBeNull();
    expect(result.trace.stopReason).not.toBe("hazard_stop");
  });
});

describe("investigate — no manual / identity gates", () => {
  it("no docIds and no drivePackId -> stop_escalate/no_manual before any tool call", async () => {
    const tools = fakeTools();
    const result = await investigate(baseInput({ docIds: [], equipment: { manufacturer: null, model: null, identityStatus: "unknown", drivePackId: null } }), {
      tools,
      model: null,
      ledger: null,
      arm: "H1",
    });
    expect(result.mode).toBe("stop_escalate");
    expect(result.trace.stopReason).toBe("no_manual");
    expect(tools.calls).toHaveLength(0);
  });

  it("identity unconfirmed AND no model -> follow_up/identity_unconfirmed before any tool call", async () => {
    const tools = fakeTools();
    const result = await investigate(baseInput({ equipment: { manufacturer: null, model: null, identityStatus: "unknown", drivePackId: null } }), {
      tools,
      model: null,
      ledger: null,
      arm: "H1",
    });
    expect(result.mode).toBe("follow_up");
    expect(result.trace.stopReason).toBe("identity_unconfirmed");
    expect(result.followUpQuestion).toContain("manufacturer");
    expect(tools.calls).toHaveLength(0);
  });
});

describe("investigate — round control (H1 vs H2)", () => {
  it("H1 never runs a round 2, even when round 1 leaves it insufficient", async () => {
    // F004 is named by the plan but no tool ever returns evidence for it ->
    // insufficient after round 1. H1 (maxRounds=1) must not attempt round 2.
    const tools = fakeTools({ searchManual: [] });
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H1" });
    expect(result.trace.sufficiency).toHaveLength(1);
    expect(result.trace.toolCalls.filter((c) => c.round === 2)).toHaveLength(0);
  });

  it("H2 runs round 2 only when round 1 is insufficient", async () => {
    const tools = fakeTools({ searchManual: [] });
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H2" });
    expect(result.trace.sufficiency).toHaveLength(2);
    expect(result.trace.toolCalls.some((c) => c.round === 2)).toBe(true);
    // Round 2 should have been a targeted lookup_code for the uncovered F004.
    expect(tools.calls.some((c) => c.tool === "lookup_code")).toBe(true);
  });

  it("H2 does NOT run round 2 when round 1 is already sufficient", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss — check incoming supply.")] } });
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H2" });
    expect(result.trace.sufficiency).toHaveLength(1);
    expect(result.trace.sufficiency[0].sufficient).toBe(true);
    expect(result.trace.toolCalls.filter((c) => c.round === 2)).toHaveLength(0);
  });
});

describe("investigate — tool cap", () => {
  it("never exceeds maxToolCalls for the budgeted tool kinds", async () => {
    const tools = fakeTools({ searchManual: [] });
    const result = await investigate(
      baseInput({ message: "what does F004 mean, also check A055 and P036" }),
      { tools, model: null, ledger: null, arm: "H2", limits: { maxToolCalls: 1 } },
    );
    const budgeted = result.trace.toolCalls.filter((c) => c.tool !== "equipment_history" && c.tool !== "live_data");
    expect(budgeted.length).toBeLessThanOrEqual(1);
  });
});

describe("investigate — equipment history / live data", () => {
  it("always calls equipmentHistory and liveData and records them as unavailable, even with maxToolCalls=0", async () => {
    const tools = fakeTools();
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H1", limits: { maxToolCalls: 0 } });
    const history = result.trace.toolCalls.find((c) => c.tool === "equipment_history");
    const live = result.trace.toolCalls.find((c) => c.tool === "live_data");
    expect(history?.status).toBe("unavailable");
    expect(live?.status).toBe("unavailable");
  });
});

describe("investigate — post-check", () => {
  it("downgrades an unsafe model output to stop_escalate/post_check_failed with nextCheck null", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss.", { id: "ev-1" })] } });
    const unsafeJson = VALID_NEXT_CHECK({
      next_check: { action: "Jumper out the safety relay to test the drive.", expected: [{ observation: "Drive runs", implies: "relay was the issue" }] },
    });
    const model = fakeModel(unsafeJson);
    const result = await investigate(baseInput(), { tools, model, ledger: fakeLedger(), arm: "H1" });
    expect(result.mode).toBe("stop_escalate");
    expect(result.trace.stopReason).toBe("post_check_failed");
    expect(result.nextCheck).toBeNull();
    expect(result.trace.postCheck.unsafePhrases.length).toBeGreaterThan(0);
  });

  it("downgrades an ungrounded number to follow_up/post_check_failed and lists it in the trace", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss — check incoming supply.", { id: "ev-1" })] } });
    const ungroundedJson = VALID_NEXT_CHECK({
      hypothesis: "The DC bus reads 620V, which is too low.",
    });
    const model = fakeModel(ungroundedJson);
    const result = await investigate(baseInput(), { tools, model, ledger: fakeLedger(), arm: "H1" });
    expect(result.mode).toBe("follow_up");
    expect(result.trace.stopReason).toBe("post_check_failed");
    expect(result.trace.postCheck.ungroundedNumbers).toContain("620V");
  });

  it("an unknown cited evidence id is treated the same as an unsafe phrase (stop_escalate)", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss.")] } });
    const model = fakeModel(VALID_NEXT_CHECK({ cited_evidence_ids: ["does-not-exist"] }));
    const result = await investigate(baseInput(), { tools, model, ledger: fakeLedger(), arm: "H1" });
    expect(result.mode).toBe("stop_escalate");
    expect(result.trace.stopReason).toBe("post_check_failed");
    expect(result.trace.postCheck.unknownEvidenceIds).toContain("does-not-exist");
  });
});

describe("investigate — budget", () => {
  it("a ledger refusal yields stopReason budget_exhausted with NO model call", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss.")] } });
    const model = fakeModel(VALID_NEXT_CHECK());
    const result = await investigate(baseInput(), { tools, model, ledger: fakeLedger(0), arm: "H1" });
    expect(result.mode).toBe("stop_escalate");
    expect(result.trace.stopReason).toBe("budget_exhausted");
    expect(model.calls).toBe(0);
    expect(result.trace.model.calls).toBe(0);
  });
});

describe("investigate — $0 (no model) path", () => {
  it("returns the gathered evidence with mode follow_up when evidence was found", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss — check incoming supply.")] } });
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H1" });
    expect(result.mode).toBe("follow_up");
    expect(result.trace.stopReason).toBe("insufficient_evidence");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.trace.model.calls).toBe(0);
  });

  it("returns stop_escalate when no evidence was found at all", async () => {
    const tools = fakeTools({ searchManual: [], lookupCode: {} });
    const result = await investigate(baseInput(), { tools, model: null, ledger: null, arm: "H1" });
    expect(result.mode).toBe("stop_escalate");
    expect(result.trace.stopReason).toBe("insufficient_evidence");
    expect(result.evidence).toEqual([]);
  });
});

describe("investigate — model error", () => {
  it("invalid model JSON is handled as model_error without throwing", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss.")] } });
    const model = fakeModel("this is not valid JSON {{{");
    await expect(investigate(baseInput(), { tools, model, ledger: fakeLedger(), arm: "H1" })).resolves.toMatchObject({
      mode: "stop_escalate",
      trace: expect.objectContaining({ stopReason: "model_error" }),
    });
  });
});

describe("investigate — clean synthesis", () => {
  it("a clean, grounded, safe model output passes through with stopReason synthesized", async () => {
    const tools = fakeTools({ lookupCode: { F004: [ev("F004: Power Loss — check incoming supply.", { id: "ev-1" })] } });
    const model = fakeModel(VALID_NEXT_CHECK());
    const result = await investigate(baseInput(), { tools, model, ledger: fakeLedger(), arm: "H1" });
    expect(result.mode).toBe("next_check");
    expect(result.trace.stopReason).toBe("synthesized");
    expect(result.nextCheck).toEqual({
      action: "Check incoming line voltage.",
      expected: [{ observation: "Voltage within spec", implies: "supply OK" }],
    });
    expect(result.citedEvidenceIds).toEqual(["ev-1"]);
    expect(result.trace.model.calls).toBe(1);
    expect(result.trace.model.model).toBe("fake-model");
  });
});

describe("distinctCodes", () => {
  it("collapses zero-padding spellings of one code, keeping the first", () => {
    expect(distinctCodes(["F081", "F81", "F071", "F71", "DEVICENET"])).toEqual(["F081", "F071", "DEVICENET"]);
  });
  it("keeps codes with different letters apart", () => {
    expect(distinctCodes(["F4", "A4", "oC", "OC"])).toEqual(["F4", "A4", "oC"]);
  });
});

describe("investigate — H2 wide second round for narrative questions", () => {
  const msg = "Conveyor motor hums but will not accelerate after the soft starter ramp completes";
  const offTopic = Array.from({ length: 10 }, (_, i) => ev(`Mounting dimensions table ${i}.`, { id: `off-${i}`, page: 100 + i }));

  it("H2 re-searches with topK 24 and lets the extra items reach the model; H1 does not", async () => {
    for (const arm of ["H1", "H2"] as const) {
      const tools = fakeTools({ searchManual: offTopic });
      await investigate(baseInput({ message: msg }), { tools, model: null, ledger: null, arm });
      const searches = tools.calls.filter((c) => c.tool === "search_manual").map((c) => (c.input as { topK: number }).topK);
      expect(searches).toEqual(arm === "H1" ? [8] : [8, 24]);
    }
  });

  it("the round-2 evidence allowance is maxEvidenceItems + ROUND2_EXTRA_EVIDENCE", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`Mounting dimensions table ${i}.`, { id: `m-${i}`, page: i + 1 }));
    const tools = fakeTools({ searchManual: many });
    const r = await investigate(baseInput({ message: msg }), { tools, model: null, ledger: null, arm: "H2" });
    expect(r.evidence.length).toBeLessThanOrEqual(10 + ROUND2_EXTRA_EVIDENCE);
  });
});
