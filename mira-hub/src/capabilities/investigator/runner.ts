/**
 * The Maintenance Investigator orchestrator (contract: ../investigator/
 * types.ts `InvestigationResult`). Wires CORE (hazard-gate, plan, grounding,
 * budget) and this lane's evaluate/synthesize into the one bounded flow the
 * module doc on `types.ts` describes:
 *
 *   hazard gate -> deterministic plan -> <=maxRounds evidence rounds
 *   -> sufficiency check -> ONE structured model synthesis
 *   -> deterministic post-checks -> result + trace.
 *
 * Every early-exit path below returns through `buildResult` so the
 * `InvestigationResult`/`InvestigationTrace` shape (types.ts) is assembled in
 * exactly one place, with the same defaults (empty evidence/toolCalls/
 * sufficiency, zeroed model usage) for every "we stopped before doing X" case.
 *
 * Two deliberate decisions, documented here because the task brief invites
 * them ("if you decide so — document") or because the fixed contract leaves
 * a gap this file has to fill:
 *
 *   1. `equipmentHistory`/`liveData` are ALWAYS called once (per
 *      `InvestigatorTools`'s contract: offline, always `{status:
 *      "unavailable"}`, never fabricated), but do NOT count against
 *      `limits.maxToolCalls`. That budget bounds EXPENSIVE, potentially
 *      multi-chunk retrieval fan-out (manual search, code/parameter lookup,
 *      drive-pack lookup); a deterministic, structurally-always-empty
 *      offline stub is neither expensive nor a fan-out risk, so counting it
 *      against the same cap would shrink the REAL retrieval budget for no
 *      reason tied to cost or latency.
 *   2. `secondRoundCalls` (evaluate.ts) is given a 4th, optional
 *      `drivePackId` argument beyond the brief's literal 3-argument
 *      signature — the brief's own round-2 description ("lookup_parameter
 *      (and drive_pack_lookup when a pack id is known)") needs the pack id,
 *      and neither `InvestigationPlan` nor `SufficiencyCheck` carries one.
 *      Extending with an optional trailing parameter doesn't break anything
 *      that calls `secondRoundCalls` positionally with 3 arguments (nothing
 *      outside this file calls it at all — `run_cases.ts` only calls
 *      `investigate()`), so this is additive, not a breaking change to the
 *      stated signature. Reported in the build summary regardless.
 *
 * `investigate()`'s OWN signature is the `deps: {tools, model, ledger,
 * limits?, arm}` object shape from the task brief, NOT the 5-positional-
 * argument shape `tools/investigator/run_cases.ts`'s `loadInvestigate()`
 * assumes (`investigate(input, tools, model, ledger, limits?)`). This is a
 * real mismatch between the two lanes' independently-written assumptions —
 * also reported in the build summary; fixing the bench lane's call site is
 * BENCH-A's file, not this one's to touch.
 */

import { hazardBanner as bannerForTrigger } from "@/lib/safety-classifier";
import { hazardGate } from "./hazard-gate";
import { buildPlan } from "./plan";
import { checkSufficiency, secondRoundCalls } from "./evaluate";
import { buildSynthesisPrompt, synthesize } from "./synthesize";
import { ungroundedNumbers, unknownEvidenceIds, unsafeInstructionPhrases } from "./grounding";
import { DEFAULT_LIMITS } from "./types";
import type {
  EvidenceItem,
  HazardVerdict,
  InvestigationInput,
  InvestigationMode,
  InvestigationPlan,
  InvestigationResult,
  InvestigationTrace,
  InvestigatorLimits,
  InvestigatorTools,
  SpendLedger,
  StopReason,
  SufficiencyCheck,
  SynthesisModel,
  SynthesisOutput,
  ToolCall,
  ToolName,
} from "./types";

/** JSON-structured synthesis output is far terser than H0's free-text answer
 *  (single_pass.ts uses 900 for free text); 700 is a generous ceiling for
 *  one hypothesis + one next-check + a short follow-up/stop reason. */
const SYNTHESIS_MAX_OUTPUT_TOKENS = 700;

export interface InvestigateDeps {
  tools: InvestigatorTools;
  model: SynthesisModel | null;
  ledger: SpendLedger | null;
  limits?: Partial<InvestigatorLimits>;
  arm: "H1" | "H2";
}

// ---------------------------------------------------------------------------
// Result assembly (one place, one set of defaults)
// ---------------------------------------------------------------------------

interface BuildResultOpts {
  mode: InvestigationMode;
  stopReason: StopReason;
  hazardBanner: string | null;
  plan: InvestigationPlan | null;
  hazard: HazardVerdict;
  t0: number;
  arm: "H1" | "H2";
  hypothesis?: string | null;
  citedEvidenceIds?: string[];
  uncertainty?: "low" | "medium" | "high";
  nextCheck?: InvestigationResult["nextCheck"];
  followUpQuestion?: string | null;
  evidence?: EvidenceItem[];
  toolCalls?: ToolCall[];
  sufficiency?: SufficiencyCheck[];
  postCheck?: InvestigationTrace["postCheck"];
  model?: InvestigationTrace["model"];
}

function buildResult(opts: BuildResultOpts): InvestigationResult {
  const latencyMs = performance.now() - opts.t0;
  return {
    mode: opts.mode,
    hypothesis: opts.hypothesis ?? null,
    citedEvidenceIds: opts.citedEvidenceIds ?? [],
    uncertainty: opts.uncertainty ?? "low",
    // Invariant mirrored from SynthesisOutput (types.ts): next_check is
    // populated iff mode === "next_check", regardless of what the caller
    // passed in.
    nextCheck: opts.mode === "next_check" ? opts.nextCheck ?? null : null,
    followUpQuestion: opts.followUpQuestion ?? null,
    stopReason: opts.stopReason,
    hazardBanner: opts.hazardBanner,
    evidence: opts.evidence ?? [],
    trace: {
      version: "investigator-v0",
      arm: opts.arm,
      plan: opts.plan,
      hazard: opts.hazard,
      toolCalls: opts.toolCalls ?? [],
      sufficiency: opts.sufficiency ?? [],
      postCheck: opts.postCheck ?? { ungroundedNumbers: [], unsafePhrases: [], unknownEvidenceIds: [] },
      model: opts.model ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, model: null },
      stopReason: opts.stopReason,
      latencyMs,
    },
  };
}

// ---------------------------------------------------------------------------
// $0-path follow-up question (no model available to ask it dynamically)
// ---------------------------------------------------------------------------

function deterministicFollowUp(plan: InvestigationPlan, check: SufficiencyCheck): string {
  if (check.uncoveredTerms.length > 0) {
    return `I don't have documentation covering ${check.uncoveredTerms.join(", ")}. Can you share the equipment manual or drive pack that covers it?`;
  }
  if (check.inapplicableEvidenceIds.length > 0) {
    return "The documentation I found may be for a different model. Can you confirm the equipment's exact manufacturer and model from its nameplate?";
  }
  if (check.contradictions.length > 0) {
    return `I found conflicting documented values for ${check.contradictions.map((c) => c.quantity).join(", ")}. Can you confirm which source applies to this equipment?`;
  }
  if (plan.missingFacts.includes("equipment_identity")) {
    return "Can you confirm the equipment's manufacturer and model (from the nameplate)?";
  }
  return "Can you provide more detail — the fault code, symptom, or the equipment manual — so I can continue?";
}

/** Every string the model's output asserts to the technician, concatenated
 *  for the post-check scanners (`ungroundedNumbers`/`unsafeInstructionPhrases`
 *  both take one text blob). */
function synthesisOutputText(output: SynthesisOutput): string {
  const parts: string[] = [];
  if (output.hypothesis) parts.push(output.hypothesis);
  if (output.next_check) {
    parts.push(output.next_check.action);
    for (const e of output.next_check.expected) {
      parts.push(e.observation);
      parts.push(e.implies);
    }
  }
  if (output.follow_up_question) parts.push(output.follow_up_question);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// investigate
// ---------------------------------------------------------------------------

/**
 * One lookup per distinct code: "F081" and "F81" are the same fault (the hub's exact-code lane already expands
 * zero-padding both ways, #4979), so looking both up spends two of the tool budget for one fact.
 */
/** Extra evidence slots the model gets when round 2 ran (10 → 16 at DEFAULT_LIMITS). */
export const ROUND2_EXTRA_EVIDENCE = 6;

export function distinctCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const m = /^([A-Za-z]{1,3})\s*0*(\d{1,5})$/.exec(code.trim());
    const key = m ? `${m[1].toUpperCase()}${Number(m[2])}` : code.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

export async function investigate(input: InvestigationInput, deps: InvestigateDeps): Promise<InvestigationResult> {
  const t0 = performance.now();
  const limits: InvestigatorLimits = {
    ...DEFAULT_LIMITS,
    ...deps.limits,
    maxRounds: deps.arm === "H1" ? 1 : 2,
  };

  // 1. Hazard gate FIRST — before the plan, before any tool/model call.
  const hazard = hazardGate(input.message);
  if (hazard.kind === "stop") {
    return buildResult({
      mode: "safety_stop",
      stopReason: "hazard_stop",
      hazardBanner: null,
      plan: null,
      hazard,
      t0,
      arm: deps.arm,
    });
  }
  const hazardBannerText = hazard.kind === "flag" ? bannerForTrigger(hazard.trigger) : null;

  // 2. Deterministic plan.
  const plan = buildPlan(input);

  // 3. No manual source at all (no attached docs, no drive pack) -> nothing
  //    downstream could ever produce evidence. Stop before any tool call.
  const drivePackId = input.equipment?.drivePackId ?? null;
  if ((input.docIds?.length ?? 0) === 0 && !drivePackId) {
    return buildResult({
      mode: "stop_escalate",
      stopReason: "no_manual",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
    });
  }

  const canSynthesize = deps.model !== null && deps.ledger !== null;

  // 4. Identity unconfirmed AND no model to reason around it -> ask for the
  //    nameplate/model before spending a tool call. When a model IS
  //    present, proceed anyway: checkSufficiency's inapplicableEvidenceIds
  //    still catches a wrong-model manual later, and the model can ask for
  //    identity itself via follow_up.
  const identityStatus = input.equipment?.identityStatus ?? null;
  const identityConfirmed = identityStatus === "user_confirmed" || identityStatus === "verified";
  if (!identityConfirmed && !canSynthesize) {
    return buildResult({
      mode: "follow_up",
      stopReason: "identity_unconfirmed",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      followUpQuestion: "Can you confirm the equipment's manufacturer and model (from the nameplate)?",
    });
  }

  // --- Tool-call execution ----------------------------------------------
  const toolCalls: ToolCall[] = [];
  // Three buckets so the model is shown "code/parameter hits first, then
  // search order" (step 10 of the brief) regardless of which round each hit
  // came from.
  const codeParamEvidence: EvidenceItem[] = [];
  const searchEvidence: EvidenceItem[] = [];
  const otherEvidence: EvidenceItem[] = [];
  let toolCallsUsed = 0;
  const remainingBudget = () => limits.maxToolCalls - toolCallsUsed;

  async function callTool(
    round: 1 | 2,
    tool: ToolName,
    callInput: Record<string, unknown>,
    run: () => Promise<EvidenceItem[]>,
  ): Promise<EvidenceItem[]> {
    const idx = toolCalls.length;
    const start = performance.now();
    try {
      const items = await run();
      const stamped = items.map((item) => ({ ...item, toolCallIndex: idx }));
      toolCalls.push({
        round,
        tool,
        input: callInput,
        evidenceIds: stamped.map((i) => i.id),
        status: stamped.length > 0 ? "ok" : "empty",
        latencyMs: performance.now() - start,
      });
      return stamped;
    } catch (err) {
      toolCalls.push({
        round,
        tool,
        input: callInput,
        evidenceIds: [],
        status: "error",
        latencyMs: performance.now() - start,
        note: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // Round 1: search_manual, then lookup_code per code, then lookup_parameter
  // per parameter, then (when a drive pack is known) drive_pack_lookup per
  // code AND per parameter. All share ONE budget across both rounds
  // (types.ts: "Total tool calls across all rounds").
  if (remainingBudget() > 0) {
    const items = await callTool(
      1,
      "search_manual",
      { query: input.message, rawQuery: input.message, docIds: input.docIds, topK: limits.topK },
      () => deps.tools.searchManual({ query: input.message, rawQuery: input.message, docIds: input.docIds, topK: limits.topK }),
    );
    searchEvidence.push(...items);
    toolCallsUsed += 1;
  }
  const lookupCodes = distinctCodes(plan.codes);
  for (const code of lookupCodes) {
    if (remainingBudget() <= 0) break;
    const items = await callTool(1, "lookup_code", { code, docIds: input.docIds }, () =>
      deps.tools.lookupCode({ code, docIds: input.docIds }),
    );
    codeParamEvidence.push(...items);
    toolCallsUsed += 1;
  }
  for (const parameter of plan.parameters) {
    if (remainingBudget() <= 0) break;
    const items = await callTool(1, "lookup_parameter", { parameter, docIds: input.docIds }, () =>
      deps.tools.lookupParameter({ parameter, docIds: input.docIds }),
    );
    codeParamEvidence.push(...items);
    toolCallsUsed += 1;
  }
  if (drivePackId) {
    for (const code of lookupCodes) {
      if (remainingBudget() <= 0) break;
      const items = await callTool(1, "drive_pack_lookup", { packId: drivePackId, code }, () =>
        deps.tools.drivePackLookup({ packId: drivePackId, code }),
      );
      codeParamEvidence.push(...items);
      toolCallsUsed += 1;
    }
    for (const parameter of plan.parameters) {
      if (remainingBudget() <= 0) break;
      const items = await callTool(1, "drive_pack_lookup", { packId: drivePackId, parameter }, () =>
        deps.tools.drivePackLookup({ packId: drivePackId, parameter }),
      );
      codeParamEvidence.push(...items);
      toolCallsUsed += 1;
    }
  }

  // Always call equipmentHistory + liveData — offline, always
  // "unavailable" — recorded in the trace but NOT counted against
  // maxToolCalls (decision + rationale in this file's header doc).
  const history = await deps.tools.equipmentHistory({ nodeId: input.nodeId });
  {
    const idx = toolCalls.length;
    const stamped = history.items.map((item) => ({ ...item, toolCallIndex: idx }));
    toolCalls.push({
      round: 1,
      tool: "equipment_history",
      input: { nodeId: input.nodeId },
      evidenceIds: stamped.map((i) => i.id),
      status: history.status,
      latencyMs: 0,
    });
    otherEvidence.push(...stamped);
  }
  const live = await deps.tools.liveData({ nodeId: input.nodeId });
  {
    const idx = toolCalls.length;
    const stamped = live.items.map((item) => ({ ...item, toolCallIndex: idx }));
    toolCalls.push({
      round: 1,
      tool: "live_data",
      input: { nodeId: input.nodeId },
      evidenceIds: stamped.map((i) => i.id),
      status: live.status,
      latencyMs: 0,
    });
    otherEvidence.push(...stamped);
  }

  function dedupedEvidence(): EvidenceItem[] {
    const combined = [...codeParamEvidence, ...searchEvidence, ...otherEvidence];
    const seen = new Set<string>();
    const out: EvidenceItem[] = [];
    for (const item of combined) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }
  // A round-2 wide search adds up to ROUND2_EXTRA_EVIDENCE items to what the model reads; without the extra room the
  // new (deeper-ranked) items would sit behind round 1's and be cut off before the model saw them.
  let round2Ran = false;
  function finalEvidenceForModel(): EvidenceItem[] {
    return dedupedEvidence().slice(0, limits.maxEvidenceItems + (round2Ran ? ROUND2_EXTRA_EVIDENCE : 0));
  }

  // 7. First sufficiency check, over the FULL (uncapped) accumulated pool —
  //    the decision to spend a second round should see everything found so
  //    far, not an artificially truncated subset.
  const sufficiencyLog: SufficiencyCheck[] = [];
  let check = checkSufficiency(plan, dedupedEvidence(), input.equipment, input.message);
  sufficiencyLog.push(check);

  // 8. Round 2 (arm H2 only), targeted via secondRoundCalls.
  if (!check.sufficient && limits.maxRounds === 2) {
    const calls = secondRoundCalls(plan, check, remainingBudget(), drivePackId, input.message);
    round2Ran = calls.length > 0;
    for (const c of calls) {
      if (remainingBudget() <= 0) break;
      if (c.tool === "lookup_code") {
        const code = String(c.input.code ?? "");
        const items = await callTool(2, "lookup_code", { code, docIds: input.docIds }, () =>
          deps.tools.lookupCode({ code, docIds: input.docIds }),
        );
        codeParamEvidence.push(...items);
      } else if (c.tool === "lookup_parameter") {
        const parameter = String(c.input.parameter ?? "");
        const items = await callTool(2, "lookup_parameter", { parameter, docIds: input.docIds }, () =>
          deps.tools.lookupParameter({ parameter, docIds: input.docIds }),
        );
        codeParamEvidence.push(...items);
      } else if (c.tool === "drive_pack_lookup") {
        const packId = String(c.input.packId ?? "");
        const code = typeof c.input.code === "string" ? c.input.code : undefined;
        const parameter = typeof c.input.parameter === "string" ? c.input.parameter : undefined;
        const items = await callTool(2, "drive_pack_lookup", { packId, code, parameter }, () =>
          deps.tools.drivePackLookup({ packId, code, parameter }),
        );
        codeParamEvidence.push(...items);
      } else if (c.tool === "search_manual") {
        const query = String(c.input.query ?? "");
        const rawQuery = typeof c.input.rawQuery === "string" ? c.input.rawQuery : query;
        const topK = typeof c.input.topK === "number" ? c.input.topK : limits.topK;
        const items = await callTool(
          2,
          "search_manual",
          { query, rawQuery, docIds: input.docIds, topK },
          () => deps.tools.searchManual({ query, rawQuery, docIds: input.docIds, topK }),
        );
        searchEvidence.push(...items);
      }
      toolCallsUsed += 1;
    }
    check = checkSufficiency(plan, dedupedEvidence(), input.equipment, input.message);
    sufficiencyLog.push(check);
  }

  const evidenceForModel = finalEvidenceForModel();

  // 9. No model (and/or no ledger) -> the $0 path. Deterministic outcome,
  //    zero model calls, using exactly the evidence/trace gathered so far.
  if (!canSynthesize) {
    if (evidenceForModel.length === 0) {
      return buildResult({
        mode: "stop_escalate",
        stopReason: "insufficient_evidence",
        hazardBanner: hazardBannerText,
        plan,
        hazard,
        t0,
        arm: deps.arm,
        evidence: evidenceForModel,
        toolCalls,
        sufficiency: sufficiencyLog,
      });
    }
    return buildResult({
      mode: "follow_up",
      stopReason: "insufficient_evidence",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      evidence: evidenceForModel,
      toolCalls,
      sufficiency: sufficiencyLog,
      followUpQuestion: deterministicFollowUp(plan, check),
    });
  }

  // 10. ONE structured synthesis call over the capped, prioritized evidence.
  const prompt = buildSynthesisPrompt(input, plan, evidenceForModel, check);
  const synth = await synthesize(deps.model!, deps.ledger!, prompt, SYNTHESIS_MAX_OUTPUT_TOKENS);

  if (synth.refused) {
    return buildResult({
      mode: "stop_escalate",
      stopReason: "budget_exhausted",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      evidence: evidenceForModel,
      toolCalls,
      sufficiency: sufficiencyLog,
      model: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, model: deps.model!.name },
    });
  }

  if (synth.output === null) {
    return buildResult({
      mode: "stop_escalate",
      stopReason: "model_error",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      evidence: evidenceForModel,
      toolCalls,
      sufficiency: sufficiencyLog,
      model: { calls: 1, inputTokens: synth.inputTokens, outputTokens: synth.outputTokens, costUsd: synth.costUsd, model: deps.model!.name },
    });
  }

  // 11. Deterministic post-check over EXACTLY the evidence the model saw.
  const outputText = synthesisOutputText(synth.output);
  const unknownIds = unknownEvidenceIds(synth.output.cited_evidence_ids, evidenceForModel);
  const unsafePhrases = unsafeInstructionPhrases(outputText);
  const ungroundedNums = ungroundedNumbers(outputText, evidenceForModel);
  const modelUsage = {
    calls: 1,
    inputTokens: synth.inputTokens,
    outputTokens: synth.outputTokens,
    costUsd: synth.costUsd,
    model: deps.model!.name,
  };

  if (unknownIds.length > 0 || unsafePhrases.length > 0) {
    return buildResult({
      mode: "stop_escalate",
      stopReason: "post_check_failed",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      evidence: evidenceForModel,
      toolCalls,
      sufficiency: sufficiencyLog,
      model: modelUsage,
      postCheck: { ungroundedNumbers: ungroundedNums, unsafePhrases, unknownEvidenceIds: unknownIds },
    });
  }

  if (ungroundedNums.length > 0) {
    return buildResult({
      mode: "follow_up",
      stopReason: "post_check_failed",
      hazardBanner: hazardBannerText,
      plan,
      hazard,
      t0,
      arm: deps.arm,
      evidence: evidenceForModel,
      toolCalls,
      sufficiency: sufficiencyLog,
      model: modelUsage,
      postCheck: { ungroundedNumbers: ungroundedNums, unsafePhrases, unknownEvidenceIds: unknownIds },
      followUpQuestion: `I can't confirm ${ungroundedNums.join(", ")} from the documentation I have — can you confirm the value or point me to where it's documented?`,
    });
  }

  // Clean synthesis — the model's own mode/hypothesis/citations stand.
  return buildResult({
    mode: synth.output.mode,
    stopReason: "synthesized",
    hazardBanner: hazardBannerText,
    plan,
    hazard,
    t0,
    arm: deps.arm,
    evidence: evidenceForModel,
    toolCalls,
    sufficiency: sufficiencyLog,
    model: modelUsage,
    postCheck: { ungroundedNumbers: [], unsafePhrases: [], unknownEvidenceIds: [] },
    hypothesis: synth.output.hypothesis,
    citedEvidenceIds: synth.output.cited_evidence_ids,
    uncertainty: synth.output.uncertainty,
    nextCheck: synth.output.next_check,
    followUpQuestion: synth.output.follow_up_question,
  });
}
