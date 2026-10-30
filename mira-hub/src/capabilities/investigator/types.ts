/**
 * Maintenance Investigator — shared contract (research prototype, offline only).
 *
 * One bounded, read-only investigation per technician/supervisor message:
 *   hazard gate → deterministic plan → ≤ maxRounds evidence rounds (typed read-only tools)
 *   → sufficiency / applicability / contradiction checks → ONE structured model synthesis
 *   → deterministic post-checks (numeric grounding, unsafe-instruction detector) → result + trace.
 *
 * Not wired to any route. Pre-registration: docs/evals/2026-10-30-investigator-harness/PREREGISTRATION.md.
 * Never: PLC/drive writes, resets, energized-work instructions, interlock bypasses, invented numbers.
 */

/** A piece of evidence the investigation may cite. `id` is stable within one run: `${docId}:${page}:${ordinal}`. */
export type EvidenceItem = {
  id: string;
  source: "manual" | "drive_pack" | "alarm_pack" | "observation";
  docId: string | null;
  title: string;
  page: number | null;
  text: string;
  /** Which tool call produced it (index into trace.toolCalls). */
  toolCallIndex: number;
};

/** A reading the technician reported, e.g. { name: "DC bus", value: 620, unit: "V" }. */
export type Observation = { name: string; value: number | string; unit?: string | null };

export type EquipmentContext = {
  manufacturer?: string | null;
  model?: string | null;
  /** Identity status as the Hub records it; anything but user_confirmed/verified is treated as unconfirmed. */
  identityStatus?: "unknown" | "candidate" | "user_confirmed" | "verified" | null;
  /** Drive-pack id when the equipment has one (powerflex_40, powerflex_525, durapulse_gs10). */
  drivePackId?: string | null;
};

export type InvestigationInput = {
  message: string;
  role: "technician" | "supervisor";
  tenantId: string;
  nodeId: string | null;
  /** Documents in scope (equipment notebook attachments). Empty = no manual available. */
  docIds: string[];
  equipment: EquipmentContext;
  observations?: Observation[];
};

/** Deterministic plan — no model call. */
export type InvestigationPlan = {
  /** Fault / alarm / error codes exactly as the hub spells them (codeSpellings). */
  codes: string[];
  /** Parameter identifiers (P036, A055, "parameter 39", Pr.xx). */
  parameters: string[];
  /** Units / numbers mentioned, normalised. */
  quantities: Array<{ value: number; unit: string | null; raw: string }>;
  symptoms: string[];
  intent: "fault_code" | "parameter" | "symptom" | "procedure" | "spec_check" | "other";
  /** Facts the investigation needs but does not have (drives follow_up). */
  missingFacts: Array<"equipment_identity" | "fault_code" | "symptom_detail" | "observation" | "manual">;
};

export type HazardVerdict =
  | { kind: "clear" }
  /** Flag-only hazard (hazardBanner) — investigation continues, banner is attached. */
  | { kind: "flag"; trigger: string }
  /** Terminal stop (energized work, bypass/defeat request): no tools, no model call. */
  | { kind: "stop"; trigger: string; text: string };

export type ToolName =
  | "search_manual"
  | "lookup_code"
  | "lookup_parameter"
  | "drive_pack_lookup"
  | "compare_spec"
  | "equipment_history"
  | "live_data";

export type ToolCall = {
  round: 1 | 2;
  tool: ToolName;
  input: Record<string, unknown>;
  /** Evidence ids returned (empty when nothing found). */
  evidenceIds: string[];
  status: "ok" | "empty" | "unavailable" | "error";
  latencyMs: number;
  note?: string;
};

export type SufficiencyCheck = {
  sufficient: boolean;
  /** Codes/parameters from the plan that no evidence item contains. */
  uncoveredTerms: string[];
  /** Evidence whose manual/model does not match the equipment identity. */
  inapplicableEvidenceIds: string[];
  /** Same quantity, different documented values across sources. */
  contradictions: Array<{ quantity: string; values: Array<{ value: string; evidenceId: string }> }>;
  reasons: string[];
};

export type InvestigationMode = "next_check" | "follow_up" | "stop_escalate" | "safety_stop";

export type ExpectedObservation = { observation: string; implies: string };

export type InvestigationResult = {
  mode: InvestigationMode;
  hypothesis: string | null;
  /** Evidence ids the answer relies on — every one must exist in `evidence`. */
  citedEvidenceIds: string[];
  uncertainty: "low" | "medium" | "high";
  /** Exactly one next safe check when mode = next_check. */
  nextCheck: { action: string; expected: ExpectedObservation[] } | null;
  followUpQuestion: string | null;
  stopReason: string | null;
  hazardBanner: string | null;
  evidence: EvidenceItem[];
  trace: InvestigationTrace;
};

export type StopReason =
  | "hazard_stop"
  | "synthesized"
  | "insufficient_evidence"
  | "no_manual"
  | "identity_unconfirmed"
  | "budget_exhausted"
  | "tool_limit"
  | "post_check_failed"
  | "model_error";

export type InvestigationTrace = {
  version: "investigator-v0";
  arm: "H1" | "H2";
  plan: InvestigationPlan | null;
  hazard: HazardVerdict;
  toolCalls: ToolCall[];
  sufficiency: SufficiencyCheck[];
  /** Deterministic post-check findings (numbers not found in evidence, unsafe phrases, unknown evidence ids). */
  postCheck: { ungroundedNumbers: string[]; unsafePhrases: string[]; unknownEvidenceIds: string[] };
  model: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; model: string | null };
  stopReason: StopReason;
  latencyMs: number;
};

export type InvestigatorLimits = {
  /** 1 = arm H1, 2 = arm H2. */
  maxRounds: 1 | 2;
  /** Total tool calls across all rounds. */
  maxToolCalls: number;
  /** Chunks per search_manual call. */
  topK: number;
  /** Max evidence items sent to the model. */
  maxEvidenceItems: number;
};

export const DEFAULT_LIMITS: InvestigatorLimits = { maxRounds: 2, maxToolCalls: 6, topK: 8, maxEvidenceItems: 10 };

/** Model output the synthesis call must return (validated before use). */
export type SynthesisOutput = {
  mode: Exclude<InvestigationMode, "safety_stop">;
  hypothesis: string | null;
  cited_evidence_ids: string[];
  uncertainty: "low" | "medium" | "high";
  next_check: { action: string; expected: ExpectedObservation[] } | null;
  follow_up_question: string | null;
  stop_reason: string | null;
};

/** Paid-call ledger (shared across every paid call in the research run; hard cap). */
export interface SpendLedger {
  /** Reserve worst-case cost; returns a reservation id or null when it would exceed the cap. */
  reserve(worstCaseUsd: number, label: string): string | null;
  /** Settle a reservation with the actual cost from response usage. */
  settle(reservationId: string, actualUsd: number, usage: { inputTokens: number; outputTokens: number }): void;
  spentUsd(): number;
  capUsd(): number;
}

/** The model seam: tests inject a fake; the offline runner injects the real OpenAI client. */
export interface SynthesisModel {
  readonly name: string;
  complete(req: { system: string; user: string; maxOutputTokens: number }): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

/** Read-only tool layer — the runner gets an implementation; tests inject fakes. */
export interface InvestigatorTools {
  searchManual(q: { query: string; rawQuery: string; docIds: string[]; topK: number }): Promise<EvidenceItem[]>;
  lookupCode(q: { code: string; docIds: string[] }): Promise<EvidenceItem[]>;
  lookupParameter(q: { parameter: string; docIds: string[] }): Promise<EvidenceItem[]>;
  drivePackLookup(q: { packId: string; code?: string; parameter?: string }): Promise<EvidenceItem[]>;
  /** Offline: always { status: "unavailable" } — never fabricated. */
  equipmentHistory(q: { nodeId: string | null }): Promise<{ status: "unavailable" | "ok"; items: EvidenceItem[] }>;
  liveData(q: { nodeId: string | null }): Promise<{ status: "unavailable" | "ok"; items: EvidenceItem[] }>;
}
