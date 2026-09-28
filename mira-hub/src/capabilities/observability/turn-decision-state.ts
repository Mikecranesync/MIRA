/**
 * TurnDecisionState — the minimal, privacy-reviewed picture of one finished turn.
 *
 * WHY THIS EXISTS AS ITS OWN TYPE
 * The Turn Evidence Packet deliberately stores no question and no answer text
 * (see `turn-evidence-packet.ts`), which is right for a durable ledger and
 * useless for judging whether an answer followed its evidence. So the judgeable
 * view is assembled IN-ROUTE, where the text still exists, used once, and never
 * persisted as text — only verdicts about it are.
 *
 * It is a separate adapter rather than fields on the packet so that Jev logic
 * does not end up scattered through the route: the route builds this, hands it
 * to an evaluator, and stores a versioned record. Nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   - credentials, cookies, bearer tokens (never in scope here)
 *   - the model's private reasoning
 *   - unrelated conversation history — only the prior observation that was
 *     actually in context for THIS turn
 *   - tenant identifiers, user identifiers, notebook names
 *   - file bytes; an observation is text a vision model already produced
 *
 * Every string is length-capped and passed through the same vendor scrub the
 * existing shadow uses (IP / MAC / serial shapes → placeholders).
 */
import { scrubForVendor } from "./jev-shadow";

/** Bump when the SHAPE changes, so an old record stays interpretable. */
export const DECISION_STATE_VERSION = "1" as const;

const MAX_QUESTION = 600;
const MAX_ANSWER = 1800;
const MAX_OBSERVATION = 900;
const MAX_CHUNK = 500;
const MAX_CHUNKS = 6;

export type DecisionEvidence = {
  /** Where it came from, as the retrieval layer already labels it. */
  source: string | null;
  /** Manufacturer/model/family the SOURCE claims — the wrong-family signal (#3966). */
  family: string | null;
  excerpt: string;
};

export type TurnDecisionState = {
  v: typeof DECISION_STATE_VERSION;
  /** What the technician asked, this turn only. */
  question: string;
  /** Identity the system believes it is talking about, if resolved. */
  asset_identity: string | null;
  /** Vision observations that were actually in context for this turn. */
  observations: string[];
  /** Retrieved evidence with its own family metadata. */
  evidence: DecisionEvidence[];
  /** The answer as delivered. */
  answer: string;
  /** What the deterministic controls decided — so a judge can be compared
   *  against them rather than trusted instead of them. */
  gates: {
    decision: string | null;
    evidence_sufficient: boolean | null;
    citations_shipped: number | null;
    ungrounded_unit_claim: boolean | null;
    system_prompt_kind: string | null;
    retrieval_strategy: string | null;
  };
  /** Correlation only — no tenant, no user. */
  correlation: { trace_id: string | null; attempt_id: string | null };
};

function cap(s: string | null | undefined, n: number): string {
  return scrubForVendor((s ?? "").trim()).slice(0, n);
}

export function buildTurnDecisionState(input: {
  question: string;
  answer: string;
  assetIdentity?: string | null;
  observations?: readonly (string | null | undefined)[];
  evidence?: readonly { source?: string | null; family?: string | null; content: string }[];
  gates: TurnDecisionState["gates"];
  traceId?: string | null;
  attemptId?: string | null;
}): TurnDecisionState {
  return {
    v: DECISION_STATE_VERSION,
    question: cap(input.question, MAX_QUESTION),
    asset_identity: input.assetIdentity ? cap(input.assetIdentity, 160) : null,
    observations: (input.observations ?? [])
      .filter((o): o is string => Boolean(o && o.trim()))
      .slice(0, 3)
      .map((o) => cap(o, MAX_OBSERVATION)),
    evidence: (input.evidence ?? []).slice(0, MAX_CHUNKS).map((e) => ({
      source: e.source ? cap(e.source, 120) : null,
      family: e.family ? cap(e.family, 120) : null,
      excerpt: cap(e.content, MAX_CHUNK),
    })),
    answer: cap(input.answer, MAX_ANSWER),
    gates: input.gates,
    correlation: { trace_id: input.traceId ?? null, attempt_id: input.attemptId ?? null },
  };
}

/**
 * The exact text sent to the vendor. Exported so a test can assert on it byte
 * for byte and so the privacy note can quote it rather than describe it.
 */
export function renderDecisionState(s: TurnDecisionState): string {
  const obs = s.observations.length
    ? s.observations.map((o, i) => `  [observation ${i + 1}] ${o}`).join("\n")
    : "  (none)";
  const ev = s.evidence.length
    ? s.evidence
        .map((e, i) => `  [${i + 1}${e.family ? ` family=${e.family}` : ""}${e.source ? ` src=${e.source}` : ""}] ${e.excerpt}`)
        .join("\n")
    : "  (none retrieved)";
  return [
    `TECHNICIAN QUESTION:\n  ${s.question}`,
    `EQUIPMENT IDENTITY THE SYSTEM BELIEVES:\n  ${s.asset_identity ?? "(unresolved)"}`,
    `PHOTO OBSERVATIONS IN CONTEXT:\n${obs}`,
    `RETRIEVED EVIDENCE:\n${ev}`,
    `ANSWER MIRA DELIVERED:\n  ${s.answer}`,
  ].join("\n\n");
}
