/**
 * ONE structured model synthesis call (contract: ../investigator/types.ts
 * `SynthesisOutput`). Reserves worst-case spend BEFORE calling the model
 * (CORE's `budget.ts`), settles with actual usage after, and validates the
 * model's JSON STRUCTURALLY before handing it back to the caller.
 *
 * Division of validation labor with `runner.ts` (both are "validate the
 * model's output" work, split because of what each side can see):
 *   - This file validates SHAPE: the JSON parses, `mode` is one of the three
 *     non-terminal `SynthesisOutput` modes, `uncertainty` is a valid band,
 *     and the `next_check`/`follow_up_question` co-presence rules hold
 *     (`next_check` present iff `mode === "next_check"`, `follow_up_question`
 *     present iff `mode === "follow_up"`). A shape failure returns
 *     `output: null` — never throws (the runner's $0/model-error path, and
 *     the "invalid model JSON -> model_error" test, both depend on this).
 *   - `runner.ts` validates GROUNDING: whether `cited_evidence_ids` is a
 *     subset of the evidence the model was actually shown, and whether the
 *     text contains an unsafe instruction or an ungrounded number. That
 *     needs the evidence array and `grounding.ts`'s checkers — this file's
 *     fixed signature (`synthesize(model, ledger, prompt, maxOutputTokens)`)
 *     does not carry evidence, so it structurally cannot do that half; the
 *     runner's post-check step (types.ts `InvestigationTrace.postCheck`) is
 *     where "ids ⊆ evidence ids" is actually enforced.
 */

import { worstCaseUsd } from "./budget";
import { DEFAULT_PRICE_PER_MTOK_IN, DEFAULT_PRICE_PER_MTOK_OUT } from "@/capabilities/openai-run-budget";
import type {
  EquipmentContext,
  EvidenceItem,
  ExpectedObservation,
  InvestigationInput,
  InvestigationPlan,
  SpendLedger,
  SufficiencyCheck,
  SynthesisModel,
  SynthesisOutput,
} from "./types";

// ---------------------------------------------------------------------------
// buildSynthesisPrompt
// ---------------------------------------------------------------------------

const RESPONSE_SHAPE =
  '{"mode":"next_check"|"follow_up"|"stop_escalate","hypothesis":string|null,' +
  '"cited_evidence_ids":string[],"uncertainty":"low"|"medium"|"high",' +
  '"next_check":{"action":string,"expected":[{"observation":string,"implies":string}]}|null,' +
  '"follow_up_question":string|null,"stop_reason":string|null}';

const SYSTEM_PROMPT = [
  "You are the Maintenance Investigator: a bounded, read-only, offline diagnostic assistant for an industrial maintenance technician or supervisor.",
  "",
  "Hard rules:",
  "1. Cite ONLY the evidence ids listed below in `cited_evidence_ids`. Never invent an evidence id, and never cite an id that is not in the EVIDENCE list.",
  "2. Never state a number (voltage, current, frequency, temperature, time, count, parameter value, or any other quantity) unless that exact number appears in the EVIDENCE text given to you.",
  "3. Never instruct energized or live electrical work.",
  "4. Never instruct bypassing, jumpering, forcing, defeating, overriding, or disabling a safety interlock, e-stop, light curtain, guard, or safety relay.",
  "5. Never instruct resetting a fault repeatedly just to clear it and keep running.",
  "6. Never instruct writing to, or changing a parameter on, a PLC or a drive.",
  "7. When `mode` is \"next_check\", give EXACTLY ONE next safe check: one concrete action, with one or more expected observations, each paired with what that observation implies.",
  "8. If the evidence is insufficient, inapplicable to this specific equipment, or contradictory, do NOT guess — respond with `mode: \"follow_up\"` and ask the ONE missing fact that would resolve it, or `mode: \"stop_escalate\"` to hand off to a human.",
  "9. Respond with JSON ONLY, matching this exact shape, with no prose before or after the JSON object:",
  RESPONSE_SHAPE,
].join("\n");

function formatEquipment(equipment: EquipmentContext): string | null {
  const manufacturer = equipment.manufacturer ?? null;
  const model = equipment.model ?? null;
  if (!manufacturer && !model) return null;
  const status = equipment.identityStatus ?? "unknown";
  return `${manufacturer ?? "unknown manufacturer"} ${model ?? "unknown model"} (identity: ${status})`;
}

function formatEvidenceLine(item: EvidenceItem): string {
  const page = item.page != null ? ` p.${item.page}` : "";
  return `  [${item.id}] (${item.source}) ${item.title}${page}: ${item.text}`;
}

function formatContradiction(c: SufficiencyCheck["contradictions"][number]): string {
  const vs = c.values.map((v) => `${v.value} (${v.evidenceId})`).join(" vs ");
  return `    ${c.quantity}: ${vs}`;
}

/** Build the (system, user) prompt pair for one synthesis call. Pure —
 *  no I/O, no model/ledger access (those belong to `synthesize` below). */
export function buildSynthesisPrompt(
  input: InvestigationInput,
  plan: InvestigationPlan,
  evidence: EvidenceItem[],
  check: SufficiencyCheck,
): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Technician message: ${input.message}`);
  lines.push(`Role: ${input.role}`);
  const equipmentLine = formatEquipment(input.equipment);
  if (equipmentLine) lines.push(`Equipment: ${equipmentLine}`);
  if (input.observations && input.observations.length > 0) {
    lines.push("Observations reported by the technician:");
    for (const o of input.observations) lines.push(`  - ${o.name}: ${o.value}${o.unit ? ` ${o.unit}` : ""}`);
  }

  lines.push(`Plan intent: ${plan.intent}`);
  if (plan.codes.length > 0) lines.push(`Codes named: ${plan.codes.join(", ")}`);
  if (plan.parameters.length > 0) lines.push(`Parameters named: ${plan.parameters.join(", ")}`);
  if (plan.symptoms.length > 0) lines.push(`Symptoms named: ${plan.symptoms.join(", ")}`);

  lines.push("");
  lines.push(`EVIDENCE (${evidence.length} item(s) — cite ONLY these ids, exactly as written):`);
  if (evidence.length === 0) {
    lines.push("  (none available)");
  } else {
    for (const item of evidence) lines.push(formatEvidenceLine(item));
  }

  lines.push("");
  lines.push("Deterministic sufficiency check (already run, before you see this):");
  lines.push(`  sufficient: ${check.sufficient}`);
  if (check.uncoveredTerms.length > 0) {
    lines.push(`  uncovered codes/parameters (no evidence found): ${check.uncoveredTerms.join(", ")}`);
  }
  if (check.inapplicableEvidenceIds.length > 0) {
    lines.push(`  evidence ids that may name a DIFFERENT model: ${check.inapplicableEvidenceIds.join(", ")}`);
  }
  if (check.contradictions.length > 0) {
    lines.push("  contradictions (same item, different documented values):");
    for (const c of check.contradictions) lines.push(formatContradiction(c));
  }
  if (check.reasons.length > 0) lines.push(`  reasons: ${check.reasons.join("; ")}`);

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// JSON shape validation (structural only — see header doc)
// ---------------------------------------------------------------------------

const VALID_MODES: ReadonlySet<string> = new Set(["next_check", "follow_up", "stop_escalate"]);
const VALID_UNCERTAINTY: ReadonlySet<string> = new Set(["low", "medium", "high"]);

function isExpectedObservation(v: unknown): v is ExpectedObservation {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.observation === "string" && typeof r.implies === "string";
}

/** Parse + strictly validate the model's raw text as a `SynthesisOutput`.
 *  Never throws — any parse/shape failure returns `null` so the caller can
 *  treat it as a (non-exceptional) model error. */
function parseSynthesisOutput(text: string): SynthesisOutput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.mode !== "string" || !VALID_MODES.has(r.mode)) return null;
  const mode = r.mode as SynthesisOutput["mode"];

  if (r.hypothesis !== null && r.hypothesis !== undefined && typeof r.hypothesis !== "string") return null;
  const hypothesis = typeof r.hypothesis === "string" ? r.hypothesis : null;

  if (!Array.isArray(r.cited_evidence_ids) || !r.cited_evidence_ids.every((x) => typeof x === "string")) return null;
  const cited_evidence_ids = r.cited_evidence_ids as string[];

  if (typeof r.uncertainty !== "string" || !VALID_UNCERTAINTY.has(r.uncertainty)) return null;
  const uncertainty = r.uncertainty as SynthesisOutput["uncertainty"];

  let next_check: SynthesisOutput["next_check"] = null;
  if (mode === "next_check") {
    const nc = r.next_check;
    if (typeof nc !== "object" || nc === null) return null;
    const ncObj = nc as Record<string, unknown>;
    if (typeof ncObj.action !== "string" || ncObj.action.trim().length === 0) return null;
    if (!Array.isArray(ncObj.expected) || ncObj.expected.length === 0 || !ncObj.expected.every(isExpectedObservation)) {
      return null;
    }
    next_check = { action: ncObj.action, expected: ncObj.expected as ExpectedObservation[] };
  } else if (r.next_check !== null && r.next_check !== undefined) {
    return null; // next_check must be absent/null when mode isn't "next_check"
  }

  let follow_up_question: string | null = null;
  if (mode === "follow_up") {
    if (typeof r.follow_up_question !== "string" || r.follow_up_question.trim().length === 0) return null;
    follow_up_question = r.follow_up_question;
  } else if (r.follow_up_question !== null && r.follow_up_question !== undefined) {
    return null; // follow_up_question must be absent/null when mode isn't "follow_up"
  }

  if (r.stop_reason !== null && r.stop_reason !== undefined && typeof r.stop_reason !== "string") return null;
  const stop_reason = typeof r.stop_reason === "string" ? r.stop_reason : null;

  return { mode, hypothesis, cited_evidence_ids, uncertainty, next_check, follow_up_question, stop_reason };
}

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------

export interface SynthesizeResult {
  output: SynthesisOutput | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  refused: boolean;
}

/**
 * Reserve worst-case spend, call the model, settle actual usage, and
 * strictly validate the JSON shape. `refused: true` means the ledger
 * refused the reservation (over cap) and the model was NEVER called — the
 * caller's `stopReason` should be `"budget_exhausted"`. `refused: false,
 * output: null` means the model call failed, or returned text that is not
 * valid `SynthesisOutput` JSON — the caller's `stopReason` should be
 * `"model_error"`. Neither case throws.
 */
export async function synthesize(
  model: SynthesisModel,
  ledger: SpendLedger,
  prompt: { system: string; user: string },
  maxOutputTokens: number,
): Promise<SynthesizeResult> {
  const reservedUsd = worstCaseUsd(prompt.system.length + prompt.user.length, maxOutputTokens);
  const reservationId = ledger.reserve(reservedUsd, "investigator synthesis");
  if (!reservationId) {
    return { output: null, inputTokens: 0, outputTokens: 0, costUsd: 0, refused: true };
  }

  let completion: { text: string; inputTokens: number; outputTokens: number };
  try {
    completion = await model.complete({ system: prompt.system, user: prompt.user, maxOutputTokens });
  } catch (err) {
    ledger.settle(reservationId, 0, { inputTokens: 0, outputTokens: 0 });
    console.error("[investigator/synthesize] model call failed:", err instanceof Error ? err.message : err);
    return { output: null, inputTokens: 0, outputTokens: 0, costUsd: 0, refused: false };
  }

  const costUsd =
    (completion.inputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_IN + (completion.outputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_OUT;
  ledger.settle(reservationId, costUsd, { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens });

  const output = parseSynthesisOutput(completion.text);
  return { output, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, costUsd, refused: false };
}
