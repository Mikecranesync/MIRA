/**
 * Hazard triage tests — SHADOW ONLY observational contract (#3957 remount).
 *
 * Contract:
 *  - Triage reports would_skip ONLY for clear non-hazard classifications
 *  - Triage reports would_proceed fail-open when Jev disabled/unavailable/timeout
 *  - Triage reports would_proceed when unsure or hazard-adjacent
 *  - Safety vocabulary always yields would_proceed
 *  - Educational + strong Jev can classify would_skip, but only with no hazard vocabulary
 *  - Triage NEVER claims to bypass semanticSafetyCheck (shadow/observational only)
 *
 * Production-path invariant (enforced by route.ts, asserted here as documentation
 * of the shadow contract): the enabled chat path always awaits semanticSafetyCheck;
 * triage is telemetry only.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  triageSemanticSafetyCheck,
  semanticSafetyCheck,
  semanticCheckEnabled,
  runSemanticSafetyCheckWithShadowTriage,
} from "../answer-safety-check";

describe("Hazard triage — SHADOW ONLY would-skip classification", () => {
  const originalEnv = process.env.MIRA_JEV_SHADOW;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MIRA_JEV_SHADOW;
    } else {
      process.env.MIRA_JEV_SHADOW = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("reports would_proceed when Jev disabled (MIRA_JEV_SHADOW=0)", async () => {
    delete process.env.MIRA_JEV_SHADOW;
    // Non-hazard educational prompt so hazard_vocabulary short-circuit does not fire;
    // we are specifically measuring the jev_disabled fail-open path.
    const result = await triageSemanticSafetyCheck({
      question: "what is a VFD?",
      answerText: "A variable frequency drive is a motor controller that adjusts frequency.",
      refused: false,
      general: true,
      evidence: [{ content: "A VFD controls AC motor speed by varying frequency.", title: "Guide" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("jev_disabled");
    expect(result.jev).toBeNull();
  });

  it("reports would_skip for refused answer (cheapest observational path)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "reset E-12 while energized",
      answerText: "I cannot help with that.",
      refused: true,
      general: false,
      evidence: [],
    });
    expect(result.decision).toBe("would_skip");
    expect(result.reason).toBe("refused");
    expect(result.jev).toBeNull();
  });

  it("reports would_proceed when no evidence / no Jev key (fail-open)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "what is a VFD?",
      answerText: "A variable frequency drive...",
      refused: false,
      general: true,
      evidence: [],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("jev_unavailable");
    // Without a key the shadow client reports no_key; with a key and empty
    // evidence it reports no_evidence. Either is fail-open would_proceed.
    expect(["no_evidence", "no_key"]).toContain(result.jev?.skipped_reason);
  });

  it("reports would_proceed when hazard vocabulary detected (energized)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "can I reset the drive?",
      answerText: "With the drive de-energized and locked out, you can reset...",
      refused: false,
      general: false,
      evidence: [{ content: "Lockout procedure: 1. De-energize...", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("reports would_proceed when hazard vocabulary detected (LOTO)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "what is lockout/tagout?",
      answerText: "Lockout/tagout (LOTO) is a safety procedure...",
      refused: false,
      general: true,
      evidence: [{ content: "LOTO is an energy control procedure...", title: "Safety Guide" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("reports would_proceed when hazard vocabulary detected (voltage)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "what voltage does this run on?",
      answerText: "The drive operates at 480V AC...",
      refused: false,
      general: false,
      evidence: [{ content: "Input voltage: 480V AC", title: "Datasheet" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("reports would_proceed when hazard vocabulary detected (pressure)", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "what is the hydraulic pressure?",
      answerText: "The hydraulic system operates at 3000 PSI...",
      refused: false,
      general: false,
      evidence: [{ content: "Max pressure: 3000 PSI", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("NEVER classifies would_skip when answer contains 'reset while energized'", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "can I reset the drive?",
      answerText: "Yes, you can reset the drive while it is energized.",
      refused: false,
      general: false,
      evidence: [{ content: "To reset: press RESET button", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("NEVER classifies would_skip when answer contains 'without de-energizing'", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "how do I clear the fault?",
      answerText: "You can clear the fault without de-energizing the equipment.",
      refused: false,
      general: false,
      evidence: [{ content: "Fault clearing procedure...", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("NEVER classifies would_skip when answer contains 'bypass the interlock'", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "how do I access the panel?",
      answerText: "You can bypass the interlock to access the panel.",
      refused: false,
      general: false,
      evidence: [{ content: "Panel access procedure...", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("NEVER classifies would_skip when answer contains 'work on live panel'", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    const result = await triageSemanticSafetyCheck({
      question: "can I check the terminals?",
      answerText: "You can work on the live panel to check terminals.",
      refused: false,
      general: false,
      evidence: [{ content: "Terminal layout...", title: "Manual" }],
    });
    expect(result.decision).toBe("would_proceed");
    expect(result.reason).toBe("hazard_vocabulary");
  });

  it("documents shadow contract: semanticSafetyCheck remains the production gate", () => {
    // Route-level invariant (see equipment-notebooks/[id]/chat/route.ts):
    // on the enabled path the route ALWAYS awaits semanticSafetyCheck after
    // (or regardless of) triage. Triage decision values are would_skip /
    // would_proceed only — there is no "skip the check" control-flow branch.
    expect(typeof semanticSafetyCheck).toBe("function");
    expect(typeof triageSemanticSafetyCheck).toBe("function");
    expect(typeof semanticCheckEnabled).toBe("function");
    // Kill-switch semantics unchanged: default enabled unless explicitly "0".
    const prev = process.env.NOTEBOOK_SEMANTIC_CHECK;
    delete process.env.NOTEBOOK_SEMANTIC_CHECK;
    expect(semanticCheckEnabled()).toBe(true);
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    expect(semanticCheckEnabled()).toBe(false);
    if (prev === undefined) delete process.env.NOTEBOOK_SEMANTIC_CHECK;
    else process.env.NOTEBOOK_SEMANTIC_CHECK = prev;
  });
});

describe("NEGATIVE CONTROL — would_skip still runs semanticSafetyCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refused would_skip path STILL invokes semanticSafetyCheck", async () => {
    const check = vi.fn(async () => ({
      verdict: "safe" as const,
      hazardClass: null,
      reason: "mocked",
    }));

    const { triage, verdict } = await runSemanticSafetyCheckWithShadowTriage(
      {
        question: "reset E-12 while energized",
        answerText: "I cannot help with that.",
        refused: true,
        general: false,
        evidence: [],
        selectedClass: "unclassified",
      },
      { check },
    );

    expect(triage.decision).toBe("would_skip");
    expect(triage.reason).toBe("refused");
    // NEGATIVE CONTROL: semantic check invoked despite would_skip.
    expect(check).toHaveBeenCalledTimes(1);
    expect(verdict.verdict).toBe("safe");
  });

  it("old gating vocabulary skip/proceed is gone from triage decisions", async () => {
    const refused = await triageSemanticSafetyCheck({
      question: "x",
      answerText: "y",
      refused: true,
      general: false,
      evidence: [],
    });
    expect(refused.decision).toBe("would_skip");
    // @ts-expect-error old gating token must not be a valid decision
    expect(refused.decision === "skip").toBe(false);
    // @ts-expect-error old gating token must not be a valid decision
    expect(refused.decision === "proceed").toBe(false);
  });
});

