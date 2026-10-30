/**
 * Deterministic investigation plan — zero model calls (contract:
 * ../investigator/types.ts `InvestigationPlan`).
 *
 * Reuses the Hub's own code-token logic from `@/lib/notebook-query.ts`
 * (`expandIndustrialQuery`, `withoutIdentityCodes`, `identityTokens`,
 * `codeSpellings`) rather than re-implementing fault/parameter token
 * extraction:
 *   - `expandIndustrialQuery(message).exactTokens` already matches the
 *     parameter-ID shape (`[PpAaBbCcHhLdtUu]\d{2,4}`) and the fault-code
 *     shape (`F\d{2,4}`) the Hub's own retrieval relies on, with both
 *     zero-padding spellings via `codeSpellings` folded in.
 *   - `expandIndustrialQuery(message).codeTokens` additionally carries
 *     "parameter NN"/"param NN" phrase forms, dotted codes (E.OV1) and hex
 *     codes — shapes `exactTokens` does not cover.
 *   - `withoutIdentityCodes` / `identityTokens` drop the machine's own name
 *     ("PowerFlex 525", "GS10") from the candidate pool before this module
 *     classifies it, so the equipment's own model number is never mistaken
 *     for a fault/parameter id.
 *   `withRawCodeTokens` and `codeTokenMatcher` are NOT used here:
 *   `withRawCodeTokens` exists to recover a conversation-augmented query's
 *   CURRENT-message codes once history text has been folded in, but
 *   `InvestigationInput` carries no separate history-augmented query (only
 *   `message`) — there is nothing for it to recover. `codeTokenMatcher`
 *   builds a retrieval-time regex/SQL matcher for a single token; this
 *   module classifies tokens, it does not search chunks with them (that is
 *   LOOP's `tools.ts` job).
 *
 * `quantities` reuses `grounding.ts`'s `extractQuantities` (the same
 * number+unit scanner `grounding.ts` runs over evidence text), so a
 * quantity this plan names and a quantity `ungroundedNumbers` later checks
 * are read by exactly one parser, not two that could drift.
 */

import {
  expandIndustrialQuery,
  withoutIdentityCodes,
  identityTokens,
  codeSpellings,
  type EquipmentIdentity,
} from "@/lib/notebook-query";
import { extractQuantities } from "./grounding";
import type { InvestigationInput, InvestigationPlan } from "./types";

type TokenBucket = "code" | "parameter" | "skip";

// "parameter 39" / "param 39" — the manual's own way of naming a numbered
// parameter row (already produced in this exact shape by
// `expandIndustrialQuery`'s `codeTokens`, via its PARAMETER_REF pattern).
const PARAMETER_PHRASE_RE = /^parameters?\s+\d{1,4}$/i;
// "Pr.xx" (e.g. Mitsubishi-style parameter numbering).
const PR_DOT_RE = /^pr\.?\s*\d{1,3}$/i;
// Single-letter group-prefixed parameter id — the SAME shape
// notebook-query.ts's own (unexported) `PARAM_ID_TOKEN` encodes
// (`[PpAaBbCcHhLdtUu]\d{2,4}`): PowerFlex/AutomationDirect-style basic (P),
// advanced (A), and other parameter groups (b/C/H/L/d/t/U).
const GROUP_PARAM_RE = /^[PpAaBbCcHhLdtUu]\d{2,4}$/;
// F-prefixed: a fault/alarm code by DEFAULT (PowerFlex, AutomationDirect
// GS10 — confirmed in both packs' own fault_codes tables, e.g. "F002 Power
// Loss"). Some vendor families (Fuji, Toshiba) instead use the F-group for
// FUNDAMENTAL PARAMETERS, with faults shown as separate alarm codes — a
// disclosed, narrow convention carve-out keyed on `equipment.manufacturer`,
// not grounded in this repo's own fixtures (no Fuji/Toshiba drive pack
// exists here to cite).
const F_CODE_RE = /^F\d{2,4}$/i;
const F_AS_PARAMETER_MANUFACTURER_RE = /\b(?:fuji|toshiba)\b/i;
// PowerFlex catalog numbers ("25B-D2P3N104") and generic catalog-ish ids
// ("520-UM001") that `exactTokens`/`codeTokens` can also surface — these are
// neither a fault code nor a parameter; drop them.
const CATALOG_SHAPE_RE = /^25[AB]-/i;
const CATALOG_DASH_RE = /^\d{2,3}-[A-Z]/i;

function classifyToken(tok: string, identity: EquipmentIdentity): TokenBucket {
  const t = tok.trim();
  if (!t) return "skip";
  if (PARAMETER_PHRASE_RE.test(t) || PR_DOT_RE.test(t) || GROUP_PARAM_RE.test(t)) return "parameter";
  if (F_CODE_RE.test(t)) {
    const mfr = identity.manufacturer ?? "";
    return F_AS_PARAMETER_MANUFACTURER_RE.test(mfr) ? "parameter" : "code";
  }
  if (CATALOG_SHAPE_RE.test(t) || CATALOG_DASH_RE.test(t)) return "skip";
  // Everything else that survived the hub's own code-shaped extraction
  // (dotted codes like E.OV1, hex codes, bare drive mnemonics like "oC") is
  // treated as a fault/alarm code — the hub's extractor only emits these
  // shapes next to a fault keyword, in a terse bare message, or via an
  // explicit 0x prefix, so by the time a token reaches here it has already
  // been vetted as code-like.
  return "code";
}

// Dotted parameter ids that `expandIndustrialQuery`'s own extraction cuts at
// the dot, so they never reach the candidate pool whole:
//   - GS10-style "P09.03" (confirmed against this repo's own GS10 pack,
//     src/lib/drive-packs/gs10-pack.json, whose parameters are numbered
//     exactly this way, e.g. "P01.24") — EXACT_PATTERNS'
//     `[PpAaBbCcHhLdtUu]\d{2,4}` stops at the dot and yields the fragment
//     "P09" (plus its zero-padded sibling "P009" via `codeSpellings`), never
//     the dotted whole.
//   - Mitsubishi-style "Pr.7" / "Pr. 125" — no existing pattern in
//     `expandIndustrialQuery` matches "Pr." at all (the letter class above
//     requires a SINGLE letter immediately followed by digits), so it never
//     enters the candidate pool in any form.
// Extracted directly from the raw message and unioned into `parameters`;
// any fragment the generic pipeline produced for the SAME dotted id is
// removed below so a technician's "P09.03" is not also reported as the
// unrelated-looking "P09"/"P009".
const GS10_DOTTED_PARAM_RE = /\bP\d{2}\.\d{2}\b/gi;
const PR_DOT_FULL_RE = /\bPr\.\s?\d{1,4}\b/gi;

function extractDottedParameters(message: string): string[] {
  const out = new Set<string>();
  for (const m of message.matchAll(GS10_DOTTED_PARAM_RE)) out.add(m[0].toUpperCase());
  for (const m of message.matchAll(PR_DOT_FULL_RE)) out.add(m[0].replace(/\s+/g, " "));
  return [...out];
}

/** The letter+digit fragment(s) `expandIndustrialQuery` would have produced
 *  for the part of a dotted id BEFORE the dot (plus its `codeSpellings`
 *  zero-padding sibling), so they can be dropped once the dotted whole is
 *  known. Only applies to the GS10 "P09.03" shape — "Pr.7" never produced a
 *  fragment to begin with (no digits precede its dot). */
function dottedIdFragments(dotted: string): string[] {
  const m = /^([A-Za-z]+)(\d{2,4})\./.exec(dotted);
  if (!m) return [];
  return codeSpellings(`${m[1]}${m[2]}`).map((s) => s.toUpperCase());
}

function classifyCodesAndParameters(
  tokens: readonly string[],
  identity: EquipmentIdentity,
): { codes: string[]; parameters: string[] } {
  const codes: string[] = [];
  const parameters: string[] = [];
  const seenCodes = new Set<string>();
  const seenParams = new Set<string>();
  for (const tok of tokens) {
    const bucket = classifyToken(tok, identity);
    if (bucket === "code" && !seenCodes.has(tok)) {
      seenCodes.add(tok);
      codes.push(tok);
    } else if (bucket === "parameter" && !seenParams.has(tok)) {
      seenParams.add(tok);
      parameters.push(tok);
    }
  }
  return { codes, parameters };
}

// Concrete, enumerable symptom keywords — these populate `plan.symptoms`.
const SYMPTOM_RE =
  /\b(?:noisy|noise|vibrat\w*|won'?t\s+start|won'?t\s+run|won'?t\s+(?:turn|reach|hold|stop)|trip(?:s|ping)?|overheat\w*|leak\w*|smok(?:e|ing)|grind\w*|stall\w*|stopp\w*|slow(?:ing)?|erratic|intermittent|burning\s+smell|hum(?:m?ming)?|screech\w*|clunk\w*|bang\w*|shak\w*|rattl\w*|jerk\w*|surg\w*|loses?\s+power|no\s+output|no\s+display|blank\s+display|won'?t\s+hold\s+speed)\b/gi;

function extractSymptoms(message: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of message.matchAll(SYMPTOM_RE)) {
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m[0]);
  }
  return out;
}

// A vague trouble report ("it's not working", "something's wrong") carries
// no CONCRETE symptom keyword but is still a symptom-shaped question for
// intent purposes — this is what makes the `symptom_detail` missing-fact
// rule reachable (an intent of "symptom" with an EMPTY `symptoms` array).
const VAGUE_TROUBLE_RE =
  /\b(?:not\s+working|won'?t\s+work|doesn'?t\s+work|broken|malfunction\w*|acting\s+up|something'?s?\s+wrong|having\s+(?:a\s+)?(?:problem|trouble|issue)|there'?s\s+a\s+problem)\b/i;

const PROCEDURE_RE =
  /\b(?:how\s+do\s+i|how\s+can\s+i|how\s+to|walk\s+me\s+through|steps?\s+to|what(?:'s|\s+is)\s+the\s+(?:procedure|process|sequence)|procedure|commission(?:ing)?|wir(?:e|ing)\s+up|set\s*up|install(?:ing)?)\b/i;

const SPEC_RE = /\b(?:max(?:imum)?|min(?:imum)?|range|limit|default|spec(?:ification)?s?|rated?|nameplate|normal\s+(?:value|reading))\b/i;

function classifyIntent(args: {
  message: string;
  codes: string[];
  parameters: string[];
  symptoms: string[];
  quantities: InvestigationPlan["quantities"];
  hasObservations: boolean;
}): InvestigationPlan["intent"] {
  const { message, codes, parameters, symptoms, quantities, hasObservations } = args;
  if (codes.length > 0) return "fault_code";
  if (hasObservations && (quantities.length > 0 || SPEC_RE.test(message))) return "spec_check";
  if (parameters.length > 0) return "parameter";
  if (PROCEDURE_RE.test(message)) return "procedure";
  if (symptoms.length > 0 || VAGUE_TROUBLE_RE.test(message)) return "symptom";
  if (SPEC_RE.test(message)) return "spec_check";
  return "other";
}

function computeMissingFacts(
  input: InvestigationInput,
  derived: { codes: string[]; parameters: string[]; symptoms: string[]; intent: InvestigationPlan["intent"] },
): InvestigationPlan["missingFacts"] {
  const missing: InvestigationPlan["missingFacts"] = [];

  const hasDocs = (input.docIds?.length ?? 0) > 0;
  const hasPack = Boolean(input.equipment?.drivePackId);
  if (!hasDocs && !hasPack) missing.push("manual");

  const identityStatus = input.equipment?.identityStatus ?? null;
  const identityConfirmed = identityStatus === "user_confirmed" || identityStatus === "verified";
  const hasModel = Boolean((input.equipment?.model ?? "").toString().trim());
  if (!identityConfirmed && !hasModel) missing.push("equipment_identity");

  if (derived.intent === "spec_check" && !(input.observations && input.observations.length > 0)) {
    missing.push("observation");
  }

  if (derived.intent === "symptom" && derived.codes.length === 0 && derived.symptoms.length === 0) {
    missing.push("symptom_detail");
  }

  return missing;
}

export function buildPlan(input: InvestigationInput): InvestigationPlan {
  const message = (input.message ?? "").toString();
  const identity: EquipmentIdentity = {
    manufacturer: input.equipment?.manufacturer ?? null,
    model: input.equipment?.model ?? null,
  };

  const expanded = expandIndustrialQuery(message);
  const names = identityTokens(identity);
  const candidatePool = [...new Set([...expanded.exactTokens, ...expanded.codeTokens])].filter(
    (t) => !names.has(t.toLowerCase()),
  );
  const strippedCodeTokens = withoutIdentityCodes(
    { ...expanded, codeTokens: candidatePool },
    identity,
  ).codeTokens;

  const { codes: fragmentCodes, parameters: fragmentParameters } = classifyCodesAndParameters(
    strippedCodeTokens,
    identity,
  );

  const dotted = extractDottedParameters(message);
  const fragmentsToDrop = new Set(dotted.flatMap((d) => dottedIdFragments(d)));
  const codes = fragmentCodes.filter((c) => !fragmentsToDrop.has(c.toUpperCase()));
  const parameters = fragmentParameters.filter((p) => !fragmentsToDrop.has(p.toUpperCase()));
  for (const d of dotted) if (!parameters.includes(d)) parameters.push(d);

  const quantities = extractQuantities(message).map((q) => ({ value: q.value, unit: q.unit, raw: q.raw }));

  const symptoms = extractSymptoms(message);

  const hasObservations = Boolean(input.observations && input.observations.length > 0);
  const intent = classifyIntent({ message, codes, parameters, symptoms, quantities, hasObservations });

  const missingFacts = computeMissingFacts(input, { codes, parameters, symptoms, intent });

  return { codes, parameters, quantities, symptoms, intent, missingFacts };
}
