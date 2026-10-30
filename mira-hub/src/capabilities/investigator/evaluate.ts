/**
 * Deterministic sufficiency check + targeted second-round planning (contract:
 * ../investigator/types.ts `SufficiencyCheck`). Zero model calls.
 *
 * Reuses the Hub's own code-spelling/matcher helpers rather than
 * re-implementing token coverage:
 *   - `codeSpellings` (`@/lib/notebook-query`) — the zero-padding spelling
 *     variants plan.ts itself unions a dotted parameter's fragments through.
 *   - `codeTokenMatcher` (`@/lib/notebook-query`) — the SAME whole-token,
 *     case-insensitive matcher the Hub's own rerank/current-code-priority
 *     logic uses (`prioritizeCurrentCodeEvidence`) to decide "does this text
 *     contain this code/parameter token" — reused here instead of a second
 *     ad-hoc regex.
 *   - `modelIdentitiesInText` / `canonicalModelKey` (`@/capabilities/model-
 *     token`) — the SAME applicability detector `manual-rag.ts` uses to
 *     decide whether an attached manual covers the notebook's bound model
 *     (`manual-rag.ts:1444-1460,1797`). Reused here for
 *     `inapplicableEvidenceIds` instead of a second model-name heuristic.
 *   - `extractQuantities` (`./grounding`) — the same number+unit scanner
 *     `grounding.ts`'s `ungroundedNumbers` and `plan.ts`'s `quantities` field
 *     both use, so a quantity found here is read by exactly one parser.
 */

import {
  codeSpellings,
  codeTokenMatcher,
} from "@/lib/notebook-query";
import { modelIdentitiesInText, canonicalModelKey } from "@/capabilities/model-token";
import { extractQuantities } from "./grounding";
import type {
  EquipmentContext,
  EvidenceItem,
  InvestigationPlan,
  SufficiencyCheck,
  ToolName,
} from "./types";

// ---------------------------------------------------------------------------
// uncoveredTerms
// ---------------------------------------------------------------------------

/** True when SOME evidence item's text contains `term` (any of its
 *  zero-padding spellings), via the Hub's own whole-token matcher. */
function isTermCovered(term: string, evidence: readonly EvidenceItem[]): boolean {
  const matchers = codeSpellings(term).map((s) => codeTokenMatcher(s).re);
  return evidence.some((item) => matchers.some((re) => re.test(item.text ?? "")));
}

function computeUncoveredTerms(plan: InvestigationPlan, evidence: readonly EvidenceItem[]): string[] {
  const terms = [...plan.codes, ...plan.parameters];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (!isTermCovered(t, evidence)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// inapplicableEvidenceIds
// ---------------------------------------------------------------------------

/** The equipment's own model identities, in `modelIdentitiesInText`'s
 *  family-qualified shape (e.g. "PF525", "GS10") when a manufacturer+model
 *  pairing resolves one, PLUS the bare canonicalized model key ("525",
 *  "GS10") as a fallback — the identity-proposal flow confirms models as
 *  bare numbers ("525", "820") that `modelIdentitiesInText` alone cannot
 *  read (it requires a manufacturer-shaped prefix like "powerflex"/"pf" next
 *  to the digits; manual-rag.ts's own notebook-scoping code hits the exact
 *  same gap and resolves it with a family-root helper that isn't exported —
 *  so this module uses the portable alternative: compare evidence
 *  identities' bare numeric suffix against the canonical key directly. */
function equipmentIdentities(equipment: EquipmentContext): { identities: Set<string>; bareKey: string } {
  const manufacturer = (equipment.manufacturer ?? "").trim();
  const model = (equipment.model ?? "").trim();
  const combined = `${manufacturer} ${model}`.trim();
  const identities = combined ? modelIdentitiesInText(combined) : new Set<string>();
  const bareKey = canonicalModelKey(model);
  return { identities, bareKey };
}

/** True when `titleIdentities` (the evidence item's own model mentions)
 *  names a model that is PROVABLY not the equipment's — i.e. the title names
 *  at least one model and NONE of them match the equipment's identities
 *  (exact family-qualified match, or a bare-key suffix match for the
 *  identity-proposal "bare number" case). An evidence item whose title names
 *  NO model at all is never flagged — silence is not evidence of a mismatch. */
function namesADifferentModel(
  titleIdentities: ReadonlySet<string>,
  own: { identities: ReadonlySet<string>; bareKey: string },
): boolean {
  if (titleIdentities.size === 0) return false;
  for (const id of titleIdentities) {
    if (own.identities.has(id)) return false;
    if (own.bareKey && (id === own.bareKey || id.endsWith(own.bareKey))) return false;
  }
  return true;
}

function computeInapplicableEvidenceIds(evidence: readonly EvidenceItem[], equipment: EquipmentContext): string[] {
  const identityStatus = equipment.identityStatus ?? null;
  const confirmed = identityStatus === "user_confirmed" || identityStatus === "verified";
  const model = (equipment.model ?? "").trim();
  // No confirmed identity (or no model on it) -> nothing to compare evidence
  // against, so nothing can be PROVEN inapplicable.
  if (!confirmed || !model) return [];

  const own = equipmentIdentities(equipment);
  const out: string[] = [];
  for (const item of evidence) {
    const titleIdentities = modelIdentitiesInText(item.title ?? "");
    if (namesADifferentModel(titleIdentities, own)) out.push(item.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// contradictions
// ---------------------------------------------------------------------------

/** The first quantity (value+unit) found within a short window after an
 *  unnegated mention of `identifier` in `text` — e.g. "P036: 50Hz" or "P036
 *  = 50Hz" yields "50Hz" for identifier "P036". Null when the identifier
 *  isn't mentioned, or no quantity follows it within the window. */
function valueNearIdentifier(text: string, identifier: string): string | null {
  const matchers = codeSpellings(identifier).map((s) => codeTokenMatcher(s).re);
  for (const re of matchers) {
    const m = re.exec(text);
    if (!m || m.index == null) continue;
    const windowEnd = Math.min(text.length, m.index + m[0].length + 60);
    const window = text.slice(m.index + m[0].length, windowEnd);
    const qs = extractQuantities(window);
    if (qs.length > 0) return `${qs[0].value}${qs[0].unit}`;
  }
  return null;
}

/** Narrative questions (no code/parameter to anchor on): evidence counts as on-topic when its best item contains
 *  at least this share of the question's distinctive words. Set on DEV forum sets only (pre-registration §6). */
export const KEY_TERM_COVERAGE_MIN = 0.5;
/** Round 2 for a narrative question re-asks with a wider pool: the Week-1 taxonomy found 76% of production misses
 *  had the right page in the hub's own candidate pool, ranked 6–50 (taxonomy/classify-shipped). */
export const SECOND_ROUND_WIDE_TOPK = 24;

const STOPWORDS = new Set(
  ("about above after again against also among another anyone anything around because been before being below " +
    "between both cannot could does doing done down during each either else even every from further have having " +
    "help here hello into just know like make many more most much need never only other over please same seem " +
    "should since some still such than thank thanks that their them then there these they thing think this those " +
    "though through under until upon very want were what when where which while will with within without would " +
    "your yours using used working work works problem issue issues trying tried getting anybody someone something " +
    "currently already really maybe right okay").split(" "),
);

/** Distinctive words of a message: lower-cased alphanumeric tokens of ≥ 4 chars, not stopwords, de-duplicated. */
export function keyTerms(message: string): string[] {
  const out: string[] = [];
  for (const t of message.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (t.length < 4 || STOPWORDS.has(t) || /^\d+$/.test(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** Best single evidence item's share of the message's key terms (0 when the message has none). */
export function keyTermCoverage(message: string, evidence: EvidenceItem[]): number {
  const terms = keyTerms(message);
  if (terms.length === 0) return 0;
  let best = 0;
  for (const e of evidence) {
    const words = new Set(e.text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const hit = terms.filter((t) => words.has(t)).length / terms.length;
    if (hit > best) best = hit;
  }
  return best;
}

/** For each code/parameter the plan names, collect the (evidenceId, value)
 *  pairs reported near that identifier across every evidence item; flag a
 *  contradiction when 2+ DISTINCT values are reported for the SAME
 *  identifier. This is deliberately scoped to the plan's own identifiers
 *  (not a generic "any two evidence items disagree on any number"
 *  cross-product) — "same parameter/quantity" needs a shared label to be
 *  the same thing, and the plan's codes/parameters ARE that label. */
function computeContradictions(
  plan: InvestigationPlan,
  evidence: readonly EvidenceItem[],
): SufficiencyCheck["contradictions"] {
  const identifiers = [...plan.codes, ...plan.parameters];
  const out: SufficiencyCheck["contradictions"] = [];
  for (const identifier of identifiers) {
    const values: Array<{ value: string; evidenceId: string }> = [];
    for (const item of evidence) {
      const v = valueNearIdentifier(item.text ?? "", identifier);
      if (v) values.push({ value: v, evidenceId: item.id });
    }
    const distinct = new Set(values.map((v) => v.value));
    if (distinct.size > 1) out.push({ quantity: identifier, values });
  }
  return out;
}

// ---------------------------------------------------------------------------
// checkSufficiency
// ---------------------------------------------------------------------------

export function checkSufficiency(
  plan: InvestigationPlan,
  evidence: EvidenceItem[],
  equipment: EquipmentContext,
  /** The technician's message — enables the narrative-question topical check (omitted ⇒ check skipped). */
  message?: string,
): SufficiencyCheck {
  const uncoveredTerms = computeUncoveredTerms(plan, evidence);
  const inapplicableEvidenceIds = computeInapplicableEvidenceIds(evidence, equipment);
  const contradictions = computeContradictions(plan, evidence);

  const applicableCount = evidence.filter((e) => !inapplicableEvidenceIds.includes(e.id)).length;

  // "(for fault_code/parameter intent) the code/parameter is covered" is
  // already implied by `uncoveredTerms.length === 0` whenever intent is
  // fault_code/parameter — `classifyIntent` (plan.ts) only assigns those
  // intents when `codes`/`parameters` is non-empty, and both arrays are
  // subsets of the terms `computeUncoveredTerms` checks. Written out
  // explicitly anyway (rather than relying on that implication silently)
  // so a future change to `classifyIntent`'s preconditions can't silently
  // make this check vacuous.
  const codeOrParamCovered =
    plan.intent === "fault_code"
      ? plan.codes.every((c) => isTermCovered(c, evidence))
      : plan.intent === "parameter"
        ? plan.parameters.every((p) => isTermCovered(p, evidence))
        : true;

  // Narrative questions have no code to anchor coverage on: require the best evidence item to be on-topic.
  const narrative = plan.intent !== "fault_code" && plan.intent !== "parameter";
  const topical =
    !narrative || message === undefined || keyTerms(message).length < 3
      ? null
      : keyTermCoverage(message, evidence);
  const topicalOk = topical === null || topical >= KEY_TERM_COVERAGE_MIN;

  const sufficient = uncoveredTerms.length === 0 && applicableCount >= 1 && codeOrParamCovered && topicalOk;

  const reasons: string[] = [];
  if (uncoveredTerms.length > 0) reasons.push(`no evidence covers: ${uncoveredTerms.join(", ")}`);
  if (applicableCount === 0) reasons.push("no applicable evidence for this equipment");
  if (!topicalOk) reasons.push(`weak topical match: best evidence covers ${Math.round((topical ?? 0) * 100)}% of the question's key terms`);
  if (contradictions.length > 0) {
    reasons.push(`conflicting values documented for: ${contradictions.map((c) => c.quantity).join(", ")}`);
  }
  if (!codeOrParamCovered && uncoveredTerms.length === 0) {
    // Only reachable if a future change breaks the implication noted above —
    // kept so that case fails loud in `reasons` rather than silently passing.
    reasons.push(`${plan.intent} intent's own code/parameter is not covered`);
  }

  return { sufficient, uncoveredTerms, inapplicableEvidenceIds, contradictions, reasons };
}

// ---------------------------------------------------------------------------
// secondRoundCalls
// ---------------------------------------------------------------------------

/**
 * Targeted round-2 tool calls, never exceeding `remainingToolBudget`:
 *   - an uncovered CODE -> one `lookup_code` call.
 *   - an uncovered PARAMETER -> one `lookup_parameter` call.
 *   - when a drive pack id is known, ALSO a `drive_pack_lookup` call per
 *     uncovered code/parameter (not just parameters) — a drive pack's
 *     `live_decode.fault_codes` table is exactly as useful for an uncovered
 *     CODE as its `parameters` table is for an uncovered parameter, and
 *     `InvestigatorTools.drivePackLookup`'s own input shape
 *     (`{packId, code?, parameter?}`) takes either; scoping the pack lookup
 *     to parameters only (the literal reading of "lookup_parameter (and
 *     drive_pack_lookup when a pack id is known)") would leave an uncovered
 *     fault code unable to ever reach the pack. Documented here because
 *     `plan`/`check` alone don't carry a pack id — see this function's 4th,
 *     optional parameter, an extension beyond the brief's literal 3-arg
 *     signature made necessary by that gap (reported in the build summary).
 *   - no uncovered codes/parameters at all (the deficiency is inapplicable
 *     evidence, a contradiction, or a lack of ANY applicable evidence) ->
 *     exactly ONE `search_manual` call over the plan's symptoms+parameters.
 *
 * Returns `input` as a loosely-typed `Record<string, unknown>` carrying only
 * the DOMAIN-specific fields (code/parameter/packId/query) — the caller
 * (runner.ts) fills in the contextual fields every tool also needs
 * (`docIds`, `topK`) from its own closure before dispatching.
 */
export function secondRoundCalls(
  plan: InvestigationPlan,
  check: SufficiencyCheck,
  remainingToolBudget: number,
  drivePackId?: string | null,
  /** The technician's message: the wide re-search query when there are no symptoms/parameters to search on. */
  message?: string,
): Array<{ tool: ToolName; input: Record<string, unknown> }> {
  const calls: Array<{ tool: ToolName; input: Record<string, unknown> }> = [];
  if (remainingToolBudget <= 0) return calls;

  const hasBudget = () => calls.length < remainingToolBudget;

  const uncoveredCodes = plan.codes.filter((c) => check.uncoveredTerms.includes(c));
  const uncoveredParams = plan.parameters.filter((p) => check.uncoveredTerms.includes(p));

  for (const code of uncoveredCodes) {
    if (!hasBudget()) return calls;
    calls.push({ tool: "lookup_code", input: { code } });
    if (drivePackId && hasBudget()) calls.push({ tool: "drive_pack_lookup", input: { packId: drivePackId, code } });
  }
  for (const parameter of uncoveredParams) {
    if (!hasBudget()) return calls;
    calls.push({ tool: "lookup_parameter", input: { parameter } });
    if (drivePackId && hasBudget()) {
      calls.push({ tool: "drive_pack_lookup", input: { packId: drivePackId, parameter } });
    }
  }

  if (calls.length === 0 && hasBudget()) {
    // Same question, wider candidate pool (ranks 9–24 become visible to the model). The raw message keeps the hub's
    // exact-code and rare-term lanes working; symptom keywords alone lose them.
    const query = (message ?? "").trim() || [...plan.symptoms, ...plan.parameters].join(" ").trim();
    if (query) calls.push({ tool: "search_manual", input: { query, rawQuery: query, topK: SECOND_ROUND_WIDE_TOPK } });
  }

  return calls;
}
