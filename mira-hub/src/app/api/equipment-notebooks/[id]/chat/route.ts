/**
 * POST /api/equipment-notebooks/[id]/chat — source-grounded notebook chat (SSE).
 *
 * The retrieval boundary IS the product (PRD §12): every requested source id is
 * validated as (tenant ∧ notebook ∧ not-rejected) BEFORE retrieval; the SQL
 * predicate `doc_id = ANY($::uuid[])` in retrieveNodeChunks enforces the set on
 * both tsquery passes — never app-side filtering after the fact. Zero retrieved
 * evidence → structured `insufficient_evidence`, no provider call, no invented
 * answer (Gate G). Every turn persists its source snapshot + evidence (§8.3).
 *
 * Frames (typed — src/lib/notebook-chat-types.ts). REAL wire order, per path:
 *   answered : `content`* → `sources` → `evidence` → [`usage`] → `status`
 *              → [`followups`] → `data: [DONE]`
 *   abstain  : `sources` (empty) → `status` → `[DONE]`
 *   safety   : `sources` (empty) → `content`* → `safety` → `status` → `[DONE]`
 * `sources` is emitted AFTER generation on the answered path — citations are
 * filtered to the [n] the answer actually used, which is unknowable before
 * the model finishes. `usage` (MIRA_CANONICAL_SEAM only) rides before
 * `status`; existing clients ignore unknown kinds (mira-mobile sse.ts is an
 * if/else-if chain), so additive frames are backward compatible.
 * chat-stop-persist.test.ts pins this order so the comment cannot drift again.
 *
 * TURN FLIGHT RECORDER (docs/architecture/observability/2026-09-22-turn-flight-
 * recorder.md, lane I2): a `mira.turn` root span covers the whole turn — every
 * exit path calls `endRoot()`. A `trace` frame `{kind:"trace",traceId,turnId}`
 * is emitted FIRST, before `sources`/`content`, but ONLY when tracing produced
 * a real trace id (no SDK registered ⇒ omitted) — an unconditional frame would
 * change the wire order of pinned tests this lane does not own
 * (chat-safety-stop.test.ts, chat-stop-persist.test.ts,
 * visual-evidence-abstain.test.ts). `x-mira-trace-id` is set the same way.
 *

 * PROVIDER SELECTION: `providers()` below is the LEGACY inline cascade and is
 * the fallback path. When MIRA_CANONICAL_SEAM=1 the turn is served by the
 * canonical seam (@/lib/inference/canonical-cascade), which is the single
 * definition of the cascade and matches Hard Constraint #2 (Groq → Cerebras →
 * Together). The legacy list still contains Gemini; that divergence is exactly
 * what the seam removes (P0004 map §10 Q4).
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { context, SpanStatusCode, trace, type Context, type Span } from "@opentelemetry/api";
import { getTracer, setSpanAttrs, type SpanAttrs } from "@/capabilities/observability/tracing";
import { startTurnRecorder, type TurnRecorder } from "@/capabilities/observability/turn-recorder";
import type { TurnEvidencePacket } from "@/capabilities/observability/turn-evidence-packet";
import type { GenerationAttempt } from "@/capabilities/observability/turn-evidence-packet";
import { ungroundedUnitClaim } from "@/capabilities/observability/anomalies";
import { judgeEvidenceSufficiencyShadow, type JevShadowResult } from "@/capabilities/observability/jev-shadow";
import {
  proposeIdentityFromText,
  unconfirmedMachineDirective,
  type IdentityProposal,
  type NotebookIdentityProposalFrame,
} from "@/capabilities/identity-proposal";
import {
  acquisitionEnabled,
  acquisitionKey,
  candidateAcquisitionEnabled,
  acquisitionDeclineText,
  readAcquisition,
  reconcileAcquisition,
  startManualAcquisition,
} from "@/capabilities/notebook-manual-acquisition";
import { evaluateTurnDecision } from "@/capabilities/observability/jev-decision";
import { buildTurnDecisionState, type TurnDecisionState } from "@/capabilities/observability/turn-decision-state";
import {
  captureContentEnabled,
  environmentName,
  gitSha,
  serviceVersion,
  productionRouteDetected,
  anomalyChecksEnabled,
} from "@/capabilities/observability/config";
import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { composeTimeout } from "@/lib/abort-helpers";
import { relevantQuoteWindow } from "@/lib/quote-window";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  abandonNotebookTurnRequest,
  claimNotebookTurnRequest,
  getFallbackSourceTurn,
  getNotebook,
  listSources,
  listTurns,
  normalizeNotebookThreadId,
  NotebookNotFoundError,
  recordTurn,
  resolveBoundAsset,
  validateChatSources,
  type ResolvedAsset,
  originFileIdsByDoc,
  type StoredNotebookTurn,
} from "@/lib/equipment-notebooks";
import {
  ELECTRICAL_HAZARD_DIRECTIVE,
  ENERGIZED_ELECTRICAL_HAZARD,
  hazardBanner,
  matchSafetyStop,
  safetyFlagDirective,
  safetyFlagHeaders,
  withSafetyFlag,
} from "@/lib/safety-classifier";
import { englishSearchQuery, withAnswerLanguage } from "@/capabilities/answer-language";
import { makeCitationNormalizer, normalizeCitationMarkers, withStepSafety } from "@/capabilities/answer-shape";
import { withLabelDataIdentifiers } from "@/capabilities/label-data-identifiers";
import { withPhotoProvenance } from "@/capabilities/photo-provenance";
import { withRetailCodeNote } from "@/capabilities/retail-codes";
import {
  PART_SEARCH_CANCEL,
  asksPartCompatibility,
  isPartSearchProposal,
  partSearchConfirmation,
  partSearchDecision,
  pendingPartSearchProposal,
  unambiguousPartNumber,
  type PartSearchDecision,
  type PartSearchProposalEntry,
} from "@/capabilities/photo-part-lookup";
import { extractCandidateIdentity, isSafeCandidateSearchIdentity, wantsManualDocumentation } from "@/capabilities/candidate-identity";
import { citationTitle } from "@/capabilities/citation-title";
import { claimPartSearchProposal } from "@/capabilities/part-search-claim";
import {
  HONEST_REFUSAL_STATUS_MESSAGE,
  buildGroundingStatus,
  countUnresolvedMarkers,
  groundingStatusEnabled,
  isGroundingStatusEntry,
  showGroundingStatus,
  type GroundingStatusInputs,
} from "@/capabilities/grounding-status";
import { translateForSearch } from "@/capabilities/translate-for-search";
import {
  buildRequestBody,
  canonicalProviders,
  canonicalSeamEnabled,
  exhaustedUsage,
  logTurnUsage,
  maxOutputTokens,
  routeReasonFor,
  usageFrame,
  usageFromRaw,
  type TurnUsage,
} from "@/lib/inference/canonical-cascade";
import { persistTurnUsage } from "@/lib/inference/persist-usage";
import { closeTurn, openTurn, type TurnOutcome } from "@/capabilities/observability/turn-lifecycle";
import { assessEvidenceFollowed } from "@/capabilities/observability/evidence-consistency";
import {
  recordArrival,
  recordResponse,
  type IngressRecord,
} from "@/capabilities/observability/turn-ingress";
import {
  appendManualContext,
  buildManualUserContent,
  corpusManufacturers,
  manufacturerFromObservationText,
  resolveModelFromObservationText,
  retrieveManualChunks,
  retrieveNodeChunks,
  type ManualChunk,
} from "@/lib/manual-rag";
import { inferEquipmentType } from "@/lib/equipment-type";
import {
  sanitizeHistory,
  buildRetrievalQuery,
  buildTopicHint,
  classifyBroad,
  classifyCoverage,
  facetEvidencePages,
  type ChatHistoryTurn,
} from "@/lib/notebook-query";
import {
  packetFromMachineMemoryResponse,
  renderMachineEvidenceSection,
  type MachineContextPacket,
} from "@/lib/machine-context-packet";
import { sanitizeMachineMemoryField } from "@/lib/machine-memory-sanitize";
import { clampSpan, fetchMachineHistory, parseAnchor, type HistoryCoverage } from "@/lib/machine-history";
import {
  blockingLookHazard,
  loadVisualEvidenceForAsset,
  renderVisualEvidenceSection,
  loadVisualEvidenceForPhoto,
  loadRecentLookObservations,
  renderLookObservationSection,
  renderPriorLookObservationsSection,
  type VisualEvidenceRow,
} from "@/lib/visual-evidence-context";
import { photoLinkedToTarget } from "@/lib/workspace-files";
import { discoverManual } from "@/lib/manual-discovery";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
import type {
  EvidenceCitation,
  MachineEvidenceEntry,
  NotebookContentFrame,
  NotebookBasisEvidenceFrame,
  NotebookEvidenceMarkerFrame,
  NotebookFollowupsFrame,
  NotebookSafetyFrame,
  NotebookSourcesFrame,
  NotebookStatusFrame,
  NotebookTraceFrame,
  NotebookChatFrame,
  SafetyNoticeEntry,
  SafetyStopEntry,
  VisualObservationEntry,
  IdentityDisputeEntry,
  EvidenceBasis,
} from "@/lib/notebook-chat-types";
import {
  isMachineEvidenceEntry,
  isSafetyNoticeEntry,
  isSafetyStopEntry,
  isVisualObservationEntry,
} from "@/lib/notebook-chat-types";
import { buildFollowupSuggestions } from "@/lib/notebook-followups";
import { chunkForRelease, validateAnswer } from "@/capabilities/answer-validation";
import { declineKind, declineText, unidentifiedServiceDecline } from "@/capabilities/decline-next-step";
import { asksAboutThisEquipment, asksForDocumentedValue } from "@/capabilities/documented-value-question";
import {
  selectForSemanticCheck,
  semanticCheckEnabled,
  semanticSafetyCheck,
  triageSemanticSafetyCheck,
  type HazardTriageResult,
} from "@/capabilities/answer-safety-check";

export const dynamic = "force-dynamic";

/** B2 (#3790, PR #3791 research): the pre-display validation boundary.
 *  Default ON — `NOTEBOOK_ANSWER_GATE=0` is the emergency rollback lever,
 *  under which content streams delta-by-delta exactly as before and the
 *  validator runs detection-only (logged, never enforced). */
function answerGateEnabled(): boolean {
  return process.env.NOTEBOOK_ANSWER_GATE !== "0";
}

const BASE_SYSTEM_PROMPT = `You are MIRA, a maintenance assistant for ONE specific machine. Answer ONLY from the numbered reference excerpts provided below.

ANSWER SHAPE — a technician is standing at the machine and needs the answer fast:
- Lead with the direct answer in the FIRST sentence: the parameter number, terminal number, fault meaning, value, or action. e.g. "P042 [Decel Time 1] sets the deceleration ramp [1]."
- Then at most one or two short sentences of explanation. Stop there.
- Do NOT open with background, generic safety boilerplate, or a restatement of the question.

ENERGY STATE — this rule outranks brevity:
- If an answer directs physical contact with wiring, terminals, bus capacitors, guards, belts, chains, couplings, or any rotating or moving part, state the required energy-isolation state IN THE SAME SENTENCE as the instruction — not as a trailing caution. e.g. "With the drive isolated, locked out and the DC bus confirmed dead with a meter, check continuity across terminals 07-08 [2]." Write the verification without a voltage number — a number there reads as a machine rating.
- Never omit that clause to keep the answer short. Brevity is for the explanation, never for the isolation condition.
- Describe an observation (what a reading means) without an isolation clause; an instruction to touch, open, remove, or probe always carries one.
- NEVER hand over a procedure for measuring, probing, opening, or otherwise working on equipment energized at 480 V class or higher. That is qualified-person work under NFPA 70E (arc-flash boundary and PPE determination, live-work permit). Redirect to the de-energize + lockout/tagout path, and to a qualified electrician for any diagnostic that genuinely requires energized equipment.

PLANT-SPECIFIC VALUES — abstain on missing configuration:
- Some answers require nameplate data, baseline history, or facility configuration that ONLY the technician's site has. Examples: relief valve setpoints, motor inrush baseline, pump suction lift limits, compressor pressure settings.
- If the excerpts do NOT supply the specific value AND the answer requires plant-context data not in any manual (e.g. "what's the relief valve setpoint for System 7 in building 3?"), abstain in one sentence. Do NOT guess a generic value.
- When abstaining on plant-specific data, acknowledge what the technician would need (nameplate, maintenance history, baseline logs) and offer to help once they provide it.
- Generic knowledge (how relief valves work, what to check when cavitation occurs) is fine. Plant-specific values (THIS machine's setpoint, THIS motor's historical baseline, THIS compressor's configuration) require evidence.

GROUNDING & CITATIONS:
- Cite every factual claim inline like [1] or [2], matching the numbered excerpts.
- Preserve parameter IDs, fault codes, terminal identifiers, and units EXACTLY (P042, F004, terminal 07, 60 Hz).
- Cite ONLY an excerpt that actually supports the sentence it is attached to. Never cite an excerpt just because it was retrieved.
- If the excerpts do not contain the answer, say so plainly in one sentence and cite NOTHING. Never present unrelated pages as if they were evidence.

PREMISE CHECK — a technician sometimes asks for something in a form the machine doesn't have:
- If the excerpts SHOW the asked-for thing exists only in a different form — e.g. a protocol the excerpts prove is available ONLY via an optional communication adapter/module (not a built-in parameter), or a feature that lives under a different name — do NOT just say "not found". Correct the premise in one sentence and cite it, e.g. "This drive has no built-in PROFINET parameter; PROFINET is available only through an optional communication adapter [n]." Then point to the real path (the adapter, or the correct parameter).
- Do this ONLY when an excerpt actually supports the correction. If nothing in the excerpts speaks to the asked-for thing at all (e.g. a hydraulic system on a VFD), abstain as usual in one sentence with no citation — never invent a correction.

PRECISION RULES:
- A monitoring/display value (e.g. b001, b002, "Output Freq", "Commanded Freq") is NOT a setting. Never tell the user to "set" a display parameter. If asked how to set something, give the configuration parameter, not the monitor.
- When a question is genuinely ambiguous (e.g. "second speed" may mean Speed Reference 2 OR a preset frequency), give BOTH concise interpretations or ask ONE targeted clarifying question — do not dump loosely related parameters.
- If the excerpts only partially cover the topic and the authoritative detail is likely in a fuller manual, answer what you found and note the complete specification may be in the full user manual.

MACHINE OVERVIEW — if asked what you know about the machine, or for an overview: state the equipment identity (manufacturer/model), the documents currently loaded and what they cover, and any coverage limitation. Do NOT merely summarize the first excerpt.`;

/**
 * General mode (spec §1.1 Universal Technician Rule). Used ONLY when the client
 * explicitly asks for `mode: "general"`, and never mixed with excerpts — the
 * whole point is that the technician can tell the two apart.
 *
 * The hard rule in this prompt is the bracket ban. `BASE_SYSTEM_PROMPT` teaches
 * the model to cite as `[1]`, and the mobile client renders `[n]` as a citation
 * chip. A general answer has no sources, so a stray `[1]` would render as a
 * chip pointing at nothing — model reasoning wearing the costume of an OEM
 * citation, which is exactly what §1.3 forbids. The route also strips any that
 * survive; this is the first of the two guards, not the only one.
 */
const GENERAL_SYSTEM_PROMPT = `You are MIRA, a maintenance assistant helping a technician who is standing at a machine RIGHT NOW. No manual for this machine has been loaded, so you are reasoning from general electrical, mechanical, and controls knowledge.

ANSWER SHAPE — the technician needs something they can act on:
- If the technician is troubleshooting or doing work on equipment, lead with the most likely cause or the first thing to check, in the FIRST sentence, then give a short ordered list of checks, cheapest and safest first.
- If the question asks how something works, what something means, or what a term is, answer it as an explanation in a few sentences. Do NOT turn it into a procedure, and do not add checks, measurements, or lockout steps nobody asked for.
- Ask a diagnostic question when one answer would genuinely change your advice. Ask at most one.
- Keep it under about 150 words.

HONESTY:
- You have NO manual for this machine. Never decode a part number, model suffix, connector code, or product-family string from pattern-matching. Do not state compatibility or interchangeability as fact without a source that explicitly supports it. Say plainly that it is unverified and ask to search the exact label text or check the manufacturer's documentation.
- If a question asks for plant-specific values (relief valve setpoint, motor baseline current, pump suction lift limit, compressor pressure), abstain plainly. The technician's site configuration is not in your training; nameplate data or maintenance records are required.
- If the question genuinely cannot be answered without model-specific or plant-specific documentation, say that plainly and name which document would settle it.
- You searched NO documentation. Never write "the documentation does not specify", "the manual doesn't say", or anything implying you looked something up and it was missing. Say "I'm answering from general knowledge, not this machine's manual" instead.
- NEVER write bracketed numeric markers like [1] or [2]. You have no sources to cite. There is nothing for a bracket to point at.

SAFETY: assume the equipment may be energized. Where a check requires isolation, say so before the step. NEVER provide an energized-measurement or live-work procedure on 480 V-class equipment — that is qualified-person work under NFPA 70E (arc-flash boundary/PPE, live-work permit); lead with de-energize + lockout/tagout and escalate to a qualified electrician for anything that must be done energized.`;

type CascadeProvider = { name: string; url: string; key?: string; model: string };

/**
 * LEGACY inline cascade — the fallback when MIRA_CANONICAL_SEAM is off.
 * Diverges from Hard Constraint #2 by listing Gemini; kept byte-identical so
 * the flag-off path is provably unchanged. Delete when the seam is default-on.
 */
function providers(): CascadeProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      // llama-3.3-70b-versatile shuts down 2026-08-16 (Phase 1.5 bakeoff §7 P0);
      // default to the current gpt-oss model so the primary provider keeps serving.
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
    },
    {
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    },
  ];
}

/** Build numbered, per-doc citations consistent with appendManualContext's [n]
 *  blocks (same ordering source: the chunk array). */
async function buildCitations(
  tenantId: string,
  notebookId: string,
  chunks: ManualChunk[],
  question: string,
): Promise<EvidenceCitation[]> {
  const seen = new Map<string, EvidenceCitation>();
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      citationId: String(seen.size + 1),
      docId: c.docId ?? "",
      sourceTitle: citationTitle(c),
      page: c.sourcePage,
      fileId: null,
      // A manufacturer manual's own address, so the reader can open it; only a
      // place a browser can actually go (http/https) is carried.
      ...(/^https?:\/\//i.test(c.sourceUrl ?? "") ? { sourceUrl: c.sourceUrl } : {}),
      // Claim-centered window (CIT-07 phase 2) — not the chunk head.
      quote: relevantQuoteWindow(c.content, question),
    });
  }
  const citations = [...seen.values()];
  const docIds = [...new Set(citations.map((c) => c.docId).filter(Boolean))];
  if (docIds.length > 0) {
    // Parked-original ids for the byte-serving viewer (raw pool: hub family).
    const files = await pool.query(
      `SELECT upload_id::text AS doc_id, id::text AS file_id
         FROM namespace_direct_uploads
        WHERE tenant_id = $1 AND upload_id = ANY($2::uuid[])`,
      [tenantId, docIds],
    );
    const fileByDoc = new Map<string, string>(
      files.rows.map((r: Record<string, unknown>) => [String(r.doc_id), String(r.file_id)]),
    );
    for (const c of citations) c.fileId = fileByDoc.get(c.docId) ?? null;
    // Invariant 3 (085): the CANONICAL origin is resolved server-side — a
    // photo-derived doc's citation carries the photograph's file id, so no
    // client ever reconstructs provenance by joining duplicate source rows.
    const originByDoc = await originFileIdsByDoc(tenantId, notebookId, docIds);
    for (const c of citations) c.originFileId = originByDoc.get(c.docId) ?? null;
  }
  return citations;
}

/** gpt-oss models emit OpenAI-style citation markers (`【3】`, `【4†L1-L7】`)
 *  instead of `[3]`. Normalize to `[n]` so the UI renders clickable chips and
 *  citation-entailment can match. Streaming-safe: a delta that ends mid-marker
 *  (an open `【` with no closing `】`) is held back until the marker completes. */
/**
 * General-mode citation-marker STRIPPER (spec §1.3).
 *
 * A general answer has no sources, so a `[1]` it emits anyway points at nothing
 * — and mira-mobile renders `[n]` as a citation chip, so it would appear as
 * documentary proof that does not exist. The system prompt forbids the markers;
 * this removes any that survive.
 *
 * Streaming-safe for the same reason makeCitationNormalizer is: a marker can be
 * split across deltas (`[` then `1]`). A trailing partial `[` or `[12` is held
 * back rather than emitted, so it can never escape as visible text.
 */
export function makeGeneralBracketStripper(): { push: (delta: string) => string; flush: () => string } {
  let pending = "";
  return {
    push(delta: string): string {
      const buf = pending + delta;
      // Drop any COMPLETE marker, along with whitespace immediately before it.
      let out = buf.replace(/[ 	]*\[\d+\]/g, "");
      // Hold back a trailing partial marker ("[", "[1", "[12") — it may complete
      // on the next delta. Trailing whitespace is held for the same reason: the
      // space before a marker usually arrives in an EARLIER delta, and once
      // emitted it cannot be taken back, leaving "P042  on this drive".
      const partial = out.match(/[ 	]*\[\d*$|[ 	]+$/);
      if (partial) {
        pending = partial[0];
        out = out.slice(0, out.length - partial[0].length);
      } else {
        pending = "";
      }
      return out;
    },
    flush(): string {
      // Whatever is still held back never completed, so it was not a marker.
      const rest = pending;
      pending = "";
      return rest;
    },
  };
}

// Moved to capabilities/answer-shape.ts so NodeChat shares it; re-exported for existing importers.
export { makeCitationNormalizer };

/** A prose refusal ("I could not find that in the selected sources") must NOT
 *  ship citations — otherwise unrelated retrieved pages render as false proof
 *  (the anti-pattern this closes). Detect the model's own honest-refusal phrasing. */
/**
 * Ledger usage for a turn served by the LEGACY inline cascade (seam off).
 * Token counts and cost are UNKNOWN on that path — never 0 — so they stay
 * null (persist-usage.ts's own rule); only the served provider/model and
 * the provider-call status are known.
 */
export function legacyCascadeUsage(
  active: { name: string; model: string } | null,
  status: TurnUsage["status"],
): TurnUsage {
  return {
    provider: active?.name ?? null,
    model: active?.model ?? null,
    routeReason: "legacy_cascade",
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costUsdEstimate: null,
    status,
    attempted: [],
  };
}

export function isRefusal(answer: string): boolean {
  // Verb list extended 2026-09-22 (staging trace d324d936…): "the supplied
  // references do not SPECIFY the supply voltage" is an honest refusal too,
  // and was persisted as `answered` with a general badge. The refusal regex
  // is the ONLY thing that turns a served refusal into insufficient_evidence.
  const a = answer.toLowerCase();
  return (
    /\b(could|couldn'?t|can'?t|cannot|do(?:es)? not|don'?t)\b[^.]*\b(find|contain|include|have|see|specify|state|list|give|provide|mention|show|cover)\b/.test(a) &&
    /\b(excerpts?|sources?|references?|documents?|documentation|manuals?|data ?sheets?|ratings?|specifications?|specs?|provided|supplied|selected|information)\b/.test(a) &&
    a.length < 400
  );
}

/** The refusal pattern applied to ONE sentence, without `isRefusal`'s
 *  whole-answer length bound. Used to separate a limitation clause from the
 *  rest of an answer (#3953). */
function sentenceIsRefusal(sentence: string): boolean {
  const a = sentence.toLowerCase();
  return (
    /\b(could|couldn'?t|can'?t|cannot|do(?:es)? not|don'?t)\b[^.]*\b(find|contain|include|have|see|specify|state|list|give|provide|mention|show|cover)\b/.test(a) &&
    /\b(excerpts?|sources?|references?|documents?|documentation|manuals?|data ?sheets?|ratings?|specifications?|specs?|provided|supplied|selected|information)\b/.test(a)
  );
}

/** Minimum characters of cited, non-limitation prose before a turn counts as
 *  having answered something. A bare "[1]." is not an answer. */
const MIN_CITED_ANSWER_CHARS = 25;

/**
 * #3953 — does this answer ASSERT something and cite a shipped source, beside
 * its limitation sentence? Drop every sentence that trips the refusal pattern;
 * if what remains is substantive AND uses an `[n]` that resolves to a citation
 * actually being shipped, the turn answered and then qualified itself. That is
 * not a refusal.
 *
 * Live case (acceptance run 35721520600, trace 7b32662ba5099656): "The PLC
 * exposes three tags … [1]. The reference only lists the tag names; it does not
 * provide definitions." The second sentence tripped the whole-text regex, so
 * the turn was recorded as `insufficient_evidence`, its citation stripped and
 * its badge downgraded to general — for an answer that was genuinely grounded.
 *
 * The citation requirement is what protects genuine refusals: a refusal whose
 * only `[n]` sits INSIDE the limitation clause has nothing left after the drop,
 * and an invented `[9]` resolves to no shipped citation. Exported for tests.
 */
export function isCitedPartialAnswer(answer: string, citations: EvidenceCitation[]): boolean {
  const kept = answer
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !sentenceIsRefusal(sentence))
    .join(" ")
    .trim();
  if (kept.replace(/\s*\[\d+\]/g, "").trim().length < MIN_CITED_ANSWER_CHARS) return false;
  return citationsUsedInAnswer(kept, citations).length > 0;
}

/**
 * The turn-level refusal decision (#3953). `isRefusal` stays the pure
 * whole-text classifier it was — the observability mirror and every existing
 * caller keep their meaning — and this wraps it with the one exception the
 * live traces showed it needs. Exported for tests.
 */
export function refusalVerdict(
  answer: string,
  ctx: { docGrounded: boolean; citations: EvidenceCitation[] },
): boolean {
  if (!isRefusal(answer)) return false;
  return !(ctx.docGrounded && isCitedPartialAnswer(answer, ctx.citations));
}

/** Assemble the provider messages: system prompt, then the sanitized
 *  conversation history (so a follow-up has memory of the thread), then the
 *  current user turn carrying the fresh grounding excerpts. Prior turns are plain
 *  text — only the CURRENT turn gets the retrieved excerpts, so the model always
 *  grounds the live question in live evidence. Exported for unit testing. */
export function buildProviderMessages(
  systemPrompt: string,
  history: ChatHistoryTurn[],
  userContent: string,
): { role: string; content: string }[] {
  return [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userContent },
  ];
}

/** A provider-cascade catch may only swallow EXTERNAL failures (network, HTTP,
 *  timeout/abort). A programming error thrown inside the cascade is a bug in
 *  THIS route and must fail loud — swallowing one masquerades as "No answer
 *  provider available" (the stale-variable incident: every question errored
 *  with clean 200s and nothing in the logs). undici reports network failure as
 *  TypeError("fetch failed"), so TypeError disambiguates on message. */
export function isProviderCascadeError(err: unknown): boolean {
  if (err instanceof DOMException) return true; // TimeoutError / AbortError
  if (err instanceof TypeError) return /fetch/i.test(err.message);
  if (
    err instanceof ReferenceError ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    err instanceof EvalError ||
    err instanceof URIError
  ) {
    return false;
  }
  return true;
}

/** Citation-entailment (lite): keep only citations the answer actually used via
 *  a [n] marker. Kills "cite a retrieved page that didn't support anything". */
export function citationsUsedInAnswer(answer: string, citations: EvidenceCitation[]): EvidenceCitation[] {
  const used = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)].map((m) => m[1]),
  );
  return citations.filter((c) => used.has(c.citationId));
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Turn Flight Recorder content capture (design §3/§8) — used ONLY behind
 * `MIRA_OTEL_CAPTURE_CONTENT=1` (captureContentEnabled()) to set
 * `gen_ai.input.messages`/`gen_ai.output.messages`. Mirrors the shapes
 * `InferenceRouter.sanitize_context()` (security-boundaries.md) already
 * redacts — a small local helper rather than a new lib module, since this is
 * the ONE call site. NOTE: `tracing.ts`'s `MAX_STRING_LEN=512` clamps every
 * span attribute value regardless of this function's own 4096 truncation, so
 * the 4 KB budget the design describes is not actually reachable today —
 * reported as a cross-lane note, not fixed here (I1 owns tracing.ts).
 */
function scrubGenAiContent(text: string): string {
  return text
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[IP]")
    .replace(/\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/g, "[MAC]")
    .replace(/\b(?:S\/N|SN|serial)[:\s]+([A-Za-z0-9]{6,})/gi, (m, tok: string) => m.slice(0, m.length - tok.length) + "[SN]")
    .slice(0, 4096);
}

/**
 * The streamed safety hard-stop. Same frame grammar as every other notebook
 * turn — `sources` (empty) → `content`… → `safety` → `status` → `[DONE]` — so a
 * client that knows nothing about safety still renders it as an ordinary,
 * complete answer rather than breaking on an unfamiliar shape.
 *
 * Content is chunked by word to match the streaming cadence of a normal answer;
 * a single blob arrives as a jarring instant wall of text next to every other
 * reply the technician has seen.
 */
/** 086 §3 — the identity-dispute MARKER frame. A basis-less `evidence` frame
 *  carrying only the marker, emitted FIRST on every disputed stream (safety
 *  stop, abstention, answered) so that (a) a client that stops the answer
 *  mid-content has already seen it, and (b) a live safety stop / abstention —
 *  which persist `basis: null` — project the same basis (none) as their
 *  persisted row. The answered path's final evidence frame still carries the
 *  basis + the marker. Older clients ignore unknown fields on a known kind;
 *  current readers accumulate only fields actually present, so an early
 *  marker cannot erase a later or earlier basis-bearing frame. */
const IDENTITY_DISPUTE_FRAME = {
  kind: "evidence",
  identityDisputed: true,
} as const satisfies NotebookEvidenceMarkerFrame;

function visualEvidenceMarker(visualEvidence: VisualObservationEntry): NotebookEvidenceMarkerFrame {
  return { kind: "evidence", visualEvidence };
}

const REPLAY_BASES = new Set<EvidenceBasis>([
  "general_reasoning",
  "identified_component",
  "oem_documentation",
  "workspace_evidence",
  "machine_history",
  "live_machine_evidence",
]);

function replayBasisLabel(basis: EvidenceBasis): string {
  switch (basis) {
    case "general_reasoning":
      return "General guidance — not grounded in this machine's documents.";
    case "oem_documentation":
      return "Grounded in this notebook's sources.";
    case "machine_history":
      return "Grounded in recorded machine history — not live.";
    case "live_machine_evidence":
      return "Grounded in live machine evidence.";
    case "identified_component":
      return "Grounded in the identified component.";
    case "workspace_evidence":
      return "Grounded in an attached photo — an unconfirmed reading.";
  }
}

/** Rebuild the canonical terminal projection from the immutable stored row.
 *  A duplicate request never reaches retrieval/provider work. Safety is sent
 *  before content and repeated in the response header, so a second transport
 *  interruption remains fail-closed. */
function isIdentityProposalEntry(e: unknown): e is NotebookIdentityProposalFrame {
  if (typeof e !== "object" || e === null) return false;
  const r = e as { kind?: unknown; manufacturer?: unknown; model?: unknown };
  return r.kind === "identity_proposal" && typeof r.manufacturer === "string" && typeof r.model === "string";
}

/**
 * T2 (#4189) — the background candidate-basis manual search's progress, for
 * the SAME proposed (not yet confirmed) identity the `identity_proposal`
 * frame names. Transient only — unlike `proposalEntries`, this is NEVER
 * added to a persisted turn's `evidence[]`: a search's "running" state would
 * read as permanently stale on reload once the search finishes. A client
 * that didn't catch it live simply sees no status line, same as any other
 * live-only SSE frame (`content`, `trace`).
 *
 * Reuses `manualSearchRunning` (#4183) and `candidateAcquisitionText`
 * (#4160 S6) verbatim — no new acquisition-state logic. Scoped to the
 * CANDIDATE basis only: the confirmed-identity search
 * (`manualSearchRunning === "confirmed"`) has no proposal to pair a card
 * with and keeps its existing (prose-only) UX, unchanged.
 *
 * Codex round 5 F15 (#4195): `startedAt` — the search's own generation, the
 * SAME DB value the GET route (`currentManualSearchStatus`) reports for this
 * identity — rides on EVERY frame (running or settled), never only the
 * running one. Without it, a live SSE frame carries no way to tell a
 * genuinely NEW candidate search apart from a replay of an old one; see
 * `manual-search-follow.ts`'s `observeLiveManualSearchFrame`.
 */
function manualSearchStatusFrame(
  identityProposal: IdentityProposal | null,
  manualSearchRunning: "confirmed" | "candidate" | null,
  candidateAcquisitionText: string | null,
  candidateSearchStartedAt?: string,
): Record<string, unknown> | null {
  if (!identityProposal) return null;
  const running = manualSearchRunning === "candidate";
  if (!running && !candidateAcquisitionText) return null;
  return {
    kind: "manual_search_status",
    manufacturer: identityProposal.manufacturer,
    model: identityProposal.model,
    running,
    ...(!running && candidateAcquisitionText ? { message: candidateAcquisitionText } : {}),
    ...(candidateSearchStartedAt ? { startedAt: candidateSearchStartedAt } : {}),
  };
}

function replayNotebookTurnResponse(turn: StoredNotebookTurn, showGrounding = false): Response {
  const enc = new TextEncoder();
  const citations = turn.evidence.filter(
    (entry): entry is EvidenceCitation =>
      typeof entry === "object" && entry !== null && typeof (entry as { docId?: unknown }).docId === "string",
  );
  const explicitSafetyStop = turn.evidence.find(isSafetyStopEntry) ?? null;
  const safetyNotices = turn.evidence.filter(isSafetyNoticeEntry);
  const safetyNotice = explicitSafetyStop
    ? (safetyNotices.find((entry) => entry.trigger === explicitSafetyStop.trigger) ?? safetyNotices.at(-1) ?? null)
    : (safetyNotices.at(-1) ?? null);
  // Compatibility for terminal rows written before the explicit marker
  // shipped: directive answers have a basis; hard stops are answered with no
  // basis. New rows always carry `safety_stop` so this inference can sunset.
  const terminalSafetyNotice = safetyNotice && (
    explicitSafetyStop !== null || (turn.answerStatus === "answered" && turn.basis === null)
  ) ? safetyNotice : null;
  const machineEvidence = turn.evidence.find(isMachineEvidenceEntry) ?? null;
  const visualEvidence = turn.evidence.find(isVisualObservationEntry) ?? null;
  const identityDisputed = turn.evidence.some(
    (entry) => typeof entry === "object" && entry !== null && (entry as { kind?: unknown }).kind === "identity_dispute",
  );
  const storedProposal = turn.evidence.find(isIdentityProposalEntry) ?? null;
  const basis = REPLAY_BASES.has(turn.basis as EvidenceBasis) ? turn.basis as EvidenceBasis : null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: NotebookChatFrame) => controller.enqueue(enc.encode(sse(frame)));
      if (identityDisputed) emit(IDENTITY_DISPUTE_FRAME);

      const sources: NotebookSourcesFrame = {
        kind: "sources",
        citations: terminalSafetyNotice ? [] : citations,
        sourceSnapshot: turn.enabledSourceDocIds,
      };
      if (terminalSafetyNotice) {
        emit(sources);
        emit({ kind: "safety", trigger: terminalSafetyNotice.trigger });
        if (visualEvidence) emit(visualEvidenceMarker(visualEvidence));
        if (turn.answerText) {
          for (const piece of chunkForRelease(turn.answerText)) emit({ kind: "content", content: piece });
        }
      } else if (turn.answerStatus === "insufficient_evidence") {
        emit(sources);
        if (visualEvidence) emit(visualEvidenceMarker(visualEvidence));
      } else {
        if (turn.answerText) {
          for (const piece of chunkForRelease(turn.answerText)) emit({ kind: "content", content: piece });
        }
        emit(sources);
        if (basis) {
          emit({
            kind: "evidence",
            basis,
            label: replayBasisLabel(basis),
            ...(machineEvidence ? { machineEvidence } : {}),
            ...(visualEvidence ? { visualEvidence } : {}),
            ...(identityDisputed ? { identityDisputed: true } : {}),
          });
        } else if (visualEvidence) {
          emit(visualEvidenceMarker(visualEvidence));
        }
      }

      const status: NotebookStatusFrame = turn.answerStatus === "insufficient_evidence"
        ? {
            kind: "status",
            status: turn.answerStatus,
            message: turn.answerText ?? (visualEvidence
              ? "I saw your photo, but I couldn't find anything about it in the selected sources."
              : "I couldn't find that in the selected sources."),
          }
        : turn.answerStatus === "error"
          ? { kind: "status", status: "error", message: "No answer provider available." }
          : { kind: "status", status: "answered" };
      // F004 contract v2: the STORED status, never recomputed, so live and
      // replay can't disagree. Shown only to a declaring client, flag on.
      const storedGrounding = showGrounding ? turn.evidence.find(isGroundingStatusEntry) : undefined;
      if (storedGrounding) emit(storedGrounding);
      emit(status);
      // Codex #4120 F4 — the stored proposal replays exactly as it was delivered.
      if (storedProposal) controller.enqueue(enc.encode(sse(storedProposal)));
      // #4150 — a replayed search proposal offers the same exact confirmation.
      const storedPartSearch = turn.evidence.find(isPartSearchProposal);
      if (storedPartSearch) {
        const chips: NotebookFollowupsFrame = {
          kind: "followups",
          suggestions: [partSearchConfirmation(storedPartSearch.candidate), PART_SEARCH_CANCEL],
        };
        controller.enqueue(enc.encode(sse(chips)));
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Idempotent-Replay": "true",
      ...(terminalSafetyNotice ? { "X-Safety-Stop": terminalSafetyNotice.trigger } : {}),
    },
  });
}

async function verifyVisualEntry(
  tenantId: string,
  notebookId: string,
  visualClaimFileId: string | null,
): Promise<VisualObservationEntry | null> {
  if (!visualClaimFileId) return null;
  try {
    const photo = await photoLinkedToTarget(tenantId, visualClaimFileId, "equipment_notebook", notebookId);
    if (!photo) {
      console.warn("[notebook-chat] visualEvidence ignored: no photo link for this file on this notebook");
      return null;
    }
    return {
      kind: "visual_observation",
      fileId: photo.fileId,
      capturedAt: photo.capturedAt,
      provenance: "phone_photo",
    };
  } catch (err) {
    console.error("[notebook-chat] visualEvidence verification failed (continuing without it):", err);
    return null;
  }
}

async function handleChatTurn(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  ingress: IngressRecord,
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  // The arrival row was written before auth and therefore carries no tenant.
  // Attribute it now, so a lost start is still countable against the tenant it
  // belonged to instead of only in the unscoped operator view.
  ingress.tenantId = ctx.tenantId;
  const { id: notebookId } = await params;

  let body: {
    message?: string;
    sourceDocIds?: string[];
    history?: unknown;
    mode?: string;
    threadId?: unknown;
    clientRequestId?: unknown;
    /** Sensor REPLAY (contract §4.4): the fault window the technician selected.
     *  Only the SELECTION is trusted — the server re-fetches the rows itself. */
    machineEvidence?: { assetId?: unknown; anchorAt?: unknown; pre?: unknown; post?: unknown };
    /** Sensor LOOK (S5 D3 cross-lane contract): the phone photo this turn was
     *  asked with. NOTHING here is trusted but the file id: the server verifies
     *  the file is linked to this notebook AS A PHOTO and re-derives the whole
     *  entry (capture time included) from the stored file row; unverified →
     *  ignored. `capturedAt` is still accepted for client compatibility and is
     *  never read. */
    visualEvidence?: { fileId?: unknown; capturedAt?: unknown };
    /** F004 contract v2: what this client understands (`grounding_status_v1`). */
    clientCapabilities?: unknown;
    /** F004 contract v2 §5: the failed turn this general request was asked from. */
    fallbackOf?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Machine-evidence selection (§4.4). Validated up front so a malformed
  // window is a 400, never a silent "answered without the machine".
  let machineRequest: { assetId: string; at: string; pre: number; post: number } | null = null;
  if (body.machineEvidence !== undefined && body.machineEvidence !== null) {
    const me = body.machineEvidence;
    const assetId = typeof me?.assetId === "string" ? me.assetId.trim() : "";
    const at = parseAnchor(me?.anchorAt);
    if (!assetId || !at) {
      return NextResponse.json(
        { error: "machine_evidence_invalid", message: "machineEvidence needs assetId and an ISO-8601 anchorAt." },
        { status: 400 },
      );
    }
    machineRequest = { assetId, at, pre: clampSpan(me.pre, 5), post: clampSpan(me.post, 2) };
  }
  // Visual-evidence claim (D3). Never a 4xx: a malformed or foreign claim is
  // dropped silently and the turn is answered without it. The claim is a FILE
  // ID and nothing else — `capturedAt` is client-supplied, so it is neither
  // required nor read (the server derives the capture time from the file row).
  let visualClaimFileId: string | null = null;
  if (body.visualEvidence && typeof body.visualEvidence === "object") {
    const raw = body.visualEvidence.fileId;
    const fileId = typeof raw === "string" ? raw.trim() : "";
    if (fileId) visualClaimFileId = fileId;
  }
  // Spec §1.1 — a technician with nothing configured must still get help, and
  // §1.4 — that must be an EXPLICIT state, never a silent relaxation of
  // grounding. So general mode is opt-in per turn: the client asks for it, the
  // answer is labelled, and it can carry no citations. Grounded mode below is
  // untouched; with zero chunks it still abstains without calling a provider.
  const general = body.mode === "general";
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message_required" }, { status: 400 });
  if (message.length > 4000) {
    return NextResponse.json({ error: "message_too_long" }, { status: 400 });
  }
  const threadId = body.threadId == null ? null : normalizeNotebookThreadId(body.threadId);
  if (body.threadId != null && !threadId) {
    return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
  }
  const clientRequestId = body.clientRequestId == null
    ? null
    : typeof body.clientRequestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientRequestId)
      ? body.clientRequestId
      : null;
  if (body.clientRequestId != null && !clientRequestId) {
    return NextResponse.json({ error: "invalid_client_request_id" }, { status: 400 });
  }
  // Carry the CLIENT's own key into the ingress ledger (093). The arrival row
  // is written before the body is parsed, so it cannot have this; the response
  // row can, and without it a client attempt that never produced a ledger start
  // is unjoinable to anything the server saw — which is the difference between
  // "never arrived" and "arrived and was lost".
  // Body wins when present; a null must not erase a good header key.
  ingress.clientRequestId = clientRequestId ?? ingress.clientRequestId;
  // Multi-turn memory: the client sends the recent thread; we cap/sanitize it,
  // pass it to the model for continuity, and use it to rewrite the retrieval
  // query so a referential follow-up ("what about Ethernet?", "the other one")
  // retrieves on the thread's subject instead of its own thin words.
  const history = sanitizeHistory(body.history);

  // F004 contract v2 (PR #4303). With the flag on, every saved turn records its
  // retrieval and citation status; only a request that declared
  // `grounding_status_v1` is SHOWN it (live frame, replay, honest refusal
  // wording) — every other client's output is unchanged. Flag off: inert.
  const groundingOn = groundingStatusEnabled();
  const showGrounding = showGroundingStatus(body.clientCapabilities);
  // §5: a general answer requested from a failed manual-based turn links back
  // to it — only to this technician's own completed turn in the same tenant,
  // notebook and thread, and only one whose stored status offered the action.
  // Checked before the claim, retrieval or any provider call.
  let fallbackOf: string | null = null;
  if (groundingOn && body.fallbackOf != null) {
    const raw = typeof body.fallbackOf === "string" ? body.fallbackOf.trim() : "";
    let source: { id: string; evidence: unknown[] } | null = null;
    if (general && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      try {
        source = await getFallbackSourceTurn(ctx.tenantId, notebookId, {
          ownerUserId: ctx.userId,
          threadId,
          turnId: raw,
        });
      } catch (err) {
        console.error("[notebook-chat] fallbackOf check failed:", err instanceof Error ? err.message : err);
        return NextResponse.json(
          { error: "fallback_check_failed", message: "Couldn't check the earlier answer just now. Try again in a moment." },
          { status: 503 },
        );
      }
    }
    const offered = source?.evidence.find(isGroundingStatusEntry)?.fallback.offered === true;
    if (!source || !offered) {
      return NextResponse.json(
        { error: "fallback_of_invalid", message: "That earlier answer can't be used for general guidance." },
        { status: 400 },
      );
    }
    fallbackOf = source.id;
  }

  // ── Turn Flight Recorder (design §1–2) ──────────────────────────────────
  // Root span for the whole turn, created HERE ("request.receive", right
  // after body validation succeeds) so it also covers the claim, source
  // validation, safety stop, and Gate-G abstain paths below — not only the
  // final SSE stream. `mira.turn.id` is the client-minted id when present,
  // else a server-minted UUID — never the DB row id, which does not exist
  // yet (recordTurn hasn't run). `endRoot()` is idempotent and MUST be called
  // on every exit path from here on (early JSON refusals included); every
  // domain child span below is created with `rootCtx` as its EXPLICIT parent
  // context rather than relying on ambient/active-span propagation across the
  // `ReadableStream.start()` boundary, which is timing-sensitive by spec (the
  // stream's `start()` callback runs synchronously at construction time but
  // its own promise is never awaited by anything that would keep the root
  // "active" for it) — see the design doc's own caveat about this.
  const tracer = getTracer();
  const turnId = clientRequestId ?? crypto.randomUUID();
  // #4103: a root of its own, not a child of the framework request span, so
  // the turn-only sampler keeps it (see capabilities/observability/turn-sampler).
  const rootSpan = tracer.startSpan("mira.turn", { root: true });
  const rootCtx = trace.setSpan(context.active(), rootSpan);
  const rootTraceId = rootSpan.isRecording() ? rootSpan.spanContext().traceId : null;
  setSpanAttrs(
    {
      "mira.turn.kind": "chat",
      "mira.turn.id": turnId,
      "mira.notebook.id": notebookId,
      "mira.thread.id": threadId,
      "mira.turn.mode": general ? "general" : "grounded",
      "mira.request.has_visual_evidence": Boolean(visualClaimFileId),
      "mira.request.has_machine_evidence": Boolean(machineRequest),
      "mira.request.message_chars": message.length,
      "mira.request.source_doc_count": (body.sourceDocIds ?? []).length,
    },
    rootSpan,
  );
  let rootEnded = false;
  // Child spans that may still be open when an early exit path ends the root
  // (identity.resolve stays open until the notebook row is loaded). endRoot()
  // drains them so no span ever leaks un-ended.
  const openChildren = new Set<Span>();
  const endRoot = (extra?: SpanAttrs): void => {
    if (rootEnded) return;
    rootEnded = true;
    try {
      for (const child of openChildren) {
        try {
          child.end();
        } catch {
          /* already ended */
        }
      }
      openChildren.clear();
      if (extra) setSpanAttrs(extra, rootSpan);
    } finally {
      rootSpan.end();
      if (!lifecycleSettled) closeLifecycle(lifecycleOutcome ?? "error");
    }
  };
  // TURN LIFECYCLE (091). The start record is written HERE — the turn has been
  // authenticated and validated, so it is an ACCEPTED turn; nothing downstream
  // has run yet. Before this, the ledger only ever heard about a turn that
  // survived to the end, so a timeout, a cancel, or a dead provider cascade
  // produced no row at all and was indistinguishable from a turn that never
  // happened. Fire-and-forget: `openTurn` never throws and never blocks the
  // technician's answer; a failed start is counted, not raised.
  const openedTurn = openTurn({
    // The SAME id the ingress row was written with, so "arrived but never
    // opened" is an exact join rather than a guess from timestamps.
    attemptId: ingress.attemptId,
    tenantId: ctx.tenantId,
    notebookId,
    platform: "hub_notebook_chat",
    clientRequestId,
    otelTraceId: rootTraceId,
    environment: environmentName(),
    gitSha: gitSha(),
  });
  let lifecycleOutcome: TurnOutcome | null = null;
  // SHADOW (MIRA_JEV_DECISION=1, off by default). Filled at the commit point,
  // where the DELIVERED answer, the evidence behind it and the deterministic
  // gate outcomes all exist at once; consumed in `finishAndPersist`, which runs
  // after `controller.close()`. Held in a variable rather than passed as an
  // argument because the persist helper is defined before these values exist.
  let decisionState: TurnDecisionState | null = null;
  let lifecycleClosed = false;
  /**
   * Close the start record. Idempotent. Called from `endRoot` so EVERY exit
   * path closes — including the ones that return a bare 4xx long before any
   * turn row exists. An exit that never classified itself closes as `error`,
   * which is the honest reading of an unclassified early return and is far
   * better than the row sitting `started` forever and counting as an orphan.
   */
  const closeLifecycle = (outcome: TurnOutcome): void => {
    if (lifecycleClosed) return;
    lifecycleClosed = true;
    void openedTurn
      .then((o) =>
        // The happy path already closed this row inside persistTurnUsage (it
        // UPDATEs on attempt_id). `closeTurn` then matches nothing and returns
        // matched:false without touching it — which is why `answered` must not
        // be double-counted: see `lifecycleSettled`.
        closeTurn({ tenantId: ctx.tenantId, attemptId: o.attemptId, outcome }),
      )
      .catch(() => {
        /* counted inside closeTurn; never fails a turn */
      });
  };
  /** Set once the usage write has already closed the row. */
  let lifecycleSettled = false;
  // Available to the ingress wrapper from here on: a start record exists and
  // `closeLifecycle` is declared, so a throw that escapes every `endRoot` still
  // lands an `error` outcome instead of an eventual, misleading `abandoned`.
  ingress.closeOnUnhandled = (outcome) => closeLifecycle(outcome);

  const rec: TurnRecorder = startTurnRecorder({
    kind: "chat",
    tenantId: ctx.tenantId,
    notebookId,
    threadId,
    clientRequestId,
    ownerUserId: ctx.userId,
    mode: general ? "general" : "grounded",
    environment: environmentName(),
    gitSha: gitSha(),
    serviceVersion: serviceVersion(),
    traceId: rootTraceId,
  });
  // Stage spans also carry a monotonic start, so the durable packet's
  // `timings_ms` is measured whether or not the span is sampled for export
  // (#4103: an unsampled span has no start/end timestamps).
  const stageStart = new WeakMap<Span, number>();
  const startStage = (name: string): Span => {
    const span = tracer.startSpan(name, undefined, rootCtx);
    stageStart.set(span, performance.now());
    return span;
  };
  // End a stage span and copy its measured duration into the durable packet
  // (`timings_ms`), the copy that survives telemetry retention. Never throws.
  const endTimed = (span: Span, stage: keyof TurnEvidencePacket["timings_ms"]): void => {
    try {
      span.end();
      const started = stageStart.get(span);
      if (started !== undefined) {
        const ms = Math.round(performance.now() - started);
        if (ms >= 0) rec.timing(stage, ms);
      }
    } catch {
      /* telemetry never changes the outcome */
    }
  };
  rec.stage("request", {
    mode: general ? "general" : "grounded",
    message_chars: message.length,
    has_visual_evidence: Boolean(visualClaimFileId),
    has_machine_evidence: Boolean(machineRequest),
    source_doc_count: (body.sourceDocIds ?? []).length,
  });
  rec.stage("ids", { thread_id: threadId, client_request_id: clientRequestId, owner_user_id: ctx.userId });
  // Finish + persist a packet for a completed turn (answered / abstain /
  // safety / stopped / provider-exhausted / recordTurn-failure — the design's
  // exact exit-path list). Structural early refusals (400/404/409/422/412/503
  // before any turn exists) call `endRoot()` alone — no packet, since no turn
  // was ever created (matches every `recordTurn` call site 1:1).
  const finishAndPersist = async (
    turnRowId: string | null,
    usage: TurnUsage,
    opts: { answerText: string | null; citationsPresent: boolean; latencyMs: number | null },
  ): Promise<void> => {
    const { packet, anomalies } = rec.finish({
      productionRouteVars: productionRouteDetected(),
      anomalyChecks: anomalyChecksEnabled(),
    });
    if (turnRowId) {
      packet.persistence.turn_row_id = turnRowId;
      packet.ids.turn_id = turnRowId;
    }
    // `turnRowId` is null in exactly the cases recordTurn didn't (or couldn't
    // confirm it) succeed — the recordTurn-failure exit path passes it
    // explicitly as null; every other call site passes the real row id.
    packet.persistence.outcome = turnRowId ? "ok" : "failed";
    // SHADOW (MIRA_JEV_DECISION=1, off by default). The one metered judgment
    // call for this turn.
    //
    // WHY THIS CANNOT DELAY DELIVERY — the precise version.
    // `finishAndPersist` has FIVE call sites and they are NOT all post-close:
    // the safety-stop path awaits it and only then returns its Response, and
    // the gate-abstain path runs before its `controller.close()`. The guarantee
    // is narrower than "the helper is always late": `decisionState` is assigned
    // at exactly ONE place — inside the final answer-gate block — and the only
    // two call sites downstream of that assignment (the recordTurn-failure path
    // and the final path) both sit after a `controller.close()`. The three
    // earlier call sites reach this line with `decisionState` still null and
    // make no call at all.
    //
    // That invariant is load-bearing and easy to break by populating
    // `decisionState` earlier, which would silently put a ~280 ms vendor call
    // in front of a HAZARD STOP response. `jev-route-invariant.test.ts` pins it.
    //
    // The cost of the invariant is real and is stated rather than hidden:
    // safety_stop, abstained and client-cancelled turns carry NO jev_decision.
    // Shadow coverage is answered turns only. Extending it to the safety path
    // would mean awaiting a vendor call before a hazard stop reaches the
    // technician, which is not a trade worth making for a shadow signal.
    //
    // It is
    // also never awaited on a path that can still reject the turn: the helper
    // is fail-open and returns a record carrying `skipped_reason` instead of
    // throwing, so an outage shows up as a value in the data rather than a gap.
    if (decisionState) {
      packet.jev_decision = await evaluateTurnDecision(decisionState).catch(() => null);
    }
    setSpanAttrs({ "mira.turn.row_id": turnRowId, "mira.anomalies": anomalies.map((a) => a.code) }, rootSpan);
    if (anomalies.length > 0) {
      console.log(
        JSON.stringify({ event: "turn.anomaly", traceId: rootTraceId, turnId, codes: anomalies.map((a) => a.code) }),
      );
    }
    try {
      const opened = await openedTurn;
      await persistTurnUsage(
        {
          tenantId: ctx.tenantId,
          notebookId,
          question: message,
          answerText: opts.answerText,
          citationsPresent: opts.citationsPresent,
          latencyMs: opts.latencyMs,
          // ONE ROW PER ACCEPTED TURN: this UPDATEs the start record rather
          // than inserting beside it.
          attemptId: opened.attemptId,
          outcome: lifecycleOutcome ?? "answered",
        },
        usage,
        {
          packet,
          anomalies,
          otelTraceId: rootTraceId,
          turnRowId,
          clientRequestId,
          notebookId,
          environment: environmentName(),
          gitSha: gitSha(),
        },
      );
    } catch (err) {
      // persistTurnUsage itself never throws (it returns a result); this is a
      // last-resort guard so the Turn Flight Recorder can never fail a turn.
      console.error("[notebook-chat] flight-recorder persistTurnUsage failed:", err instanceof Error ? err.message : err);
    }
    // The usage write owns the close from here; endRoot must not re-close.
    lifecycleSettled = true;
  };
  // ─────────────────────────────────────────────────────────────────────────

  // SAFETY HARD-STOP. Evaluated here, before retrieval and before any provider
  // call, because this notebook is the surface a technician uses while standing
  // at a running machine — and it is the one chat route in the Hub that had no
  // guardrail at all. The asset- and node-chat routes already stop here; this
  // reuses their classifier rather than adding a second policy, which keeps the
  // educational carve-out ("what is arc flash?" is a question, not a hazard
  // report) that a fresh keyword list would silently lose.
  const questionSafetyTrigger = matchSafetyStop(message);
  // #3763: the energized-electrical hazard sentinel is a DIRECTIVE, not a stop.
  // The answer still streams, framed by the NFPA 70E directive injected below,
  // and the turn persists a safety_notice evidence entry. Every other non-null
  // trigger is a flag too since 2026-09-27 (banner above the answer, see below).
  // Own/replay the idempotency key before consulting mutable source approval
  // or membership. The key is bound to the full original request payload, so
  // a completed turn remains replayable even if a source is later detached;
  // a changed payload fails closed instead of inheriting that terminal truth.
  let requestClaimToken: string | null = null;
  if (clientRequestId) {
    try {
      const claim = await claimNotebookTurnRequest(ctx.tenantId, notebookId, {
        ownerUserId: ctx.userId,
        clientRequestId,
        question: message,
        threadId,
        requestPayload: body,
      });
      if (claim.status === "replay") {
        // An idempotent replay is `superseded`, not `error`. Measured on
        // staging 2026-09-23: sending the same clientRequestId twice produced
        // `closed/error` for the second, because the replay path reaches
        // `endRoot` without ever classifying itself and the fallback is `error`.
        // The union already has the right word for "a duplicate/retry the
        // server discarded", and a ledger that files healthy idempotency under
        // errors teaches an operator to ignore errors.
        lifecycleOutcome = "superseded";
        // Idempotent replay of an already-terminal turn — no new work, no new
        // packet. `finish` was never reached; note it on the span and close.
        endRoot({ "mira.turn.replay": true });
        return replayNotebookTurnResponse(claim.turn, showGrounding);
      }
      if (claim.status === "in_progress") {
        endRoot();
        return NextResponse.json(
          { error: "request_in_progress", message: "This request is still being completed." },
          { status: 409, headers: { "Retry-After": "2" } },
        );
      }
      if (claim.status === "mismatch") {
        endRoot();
        return NextResponse.json(
          { error: "client_request_id_reused", message: "That request id belongs to a different chat request." },
          { status: 409 },
        );
      }
      requestClaimToken = claim.claimToken;
    } catch (err) {
      if (err instanceof NotebookNotFoundError) {
        endRoot();
        return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
      }
      endRoot();
      throw err;
    }
  }
  const abandonRequestClaim = () => clientRequestId && requestClaimToken
    ? abandonNotebookTurnRequest(
        ctx.tenantId,
        notebookId,
        ctx.userId,
        clientRequestId,
        requestClaimToken,
      )
    : Promise.resolve();
  const releaseClaimOnFailure = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (err) {
      await abandonRequestClaim().catch((releaseErr) => {
        console.error(
          "[notebook-chat] request claim release failed:",
          releaseErr instanceof Error ? releaseErr.message : releaseErr,
        );
      });
      // Every pre-stream failure funnels through here: the root span must not
      // leak un-ended, and the trace must say which stage threw.
      try {
        rootSpan.recordException(err instanceof Error ? err : new Error(String(err)));
        rootSpan.setStatus({ code: SpanStatusCode.ERROR });
      } catch {
        /* telemetry never changes the outcome */
      }
      endRoot({ "mira.turn.aborted": true });
      throw err;
    }
  };

  // PRD §27: no sources selected is an explicit, honest state — not a silent
  // fall-through to the global corpus.
  const validated = await releaseClaimOnFailure(() =>
    validateChatSources(ctx.tenantId, notebookId, body.sourceDocIds ?? []),
  );
  if (!validated.ok) {
    // 086 / private conversations §2: `no_sources_selected` is returned from an
    // early `requestedDocIds.length === 0` check that never touches the
    // database, so it proves NOTHING about ownership — yet both zero-source
    // branches below (the safety stop, which persists, and general mode, which
    // spends provider budget) used to trust it. Prove tenant ownership here,
    // once, before either. getNotebook() is tenant-scoped: a foreign or
    // nonexistent id is a 404 with nothing spent and nothing written. The
    // grounded path needs no extra query — validateChatSources already proved
    // membership for every id in docIds.
    if (
      validated.error === "no_sources_selected" &&
      !(await releaseClaimOnFailure(() => getNotebook(ctx.tenantId, notebookId)))
    ) {
      await abandonRequestClaim();
      endRoot();
      return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
    }
    // "Smoke is coming from the panel" in a notebook with nothing attached must
    // not be answered with a filing complaint. Ownership was proven by the
    // getNotebook check just above (086) — `no_sources_selected` itself proves
    // nothing — so the stop is safe to serve. It is NOT served here: a stop
    // persisted before the machine binding is resolved carried no asset
    // snapshot and no identity dispute, unlike every other turn, so a reload
    // could not say which machine the hazard was reported at (or that the
    // client's asset claim was disputed). The zero-source stop falls through
    // to the single post-resolution safety stop below.
    //
    // A notebook with nothing attached is exactly the case the Universal
    // Technician Rule exists for: the technician is standing at a machine with
    // no manual loaded and still needs help.
    //
    // OWNERSHIP MUST BE PROVEN HERE, EXPLICITLY. `no_sources_selected` is
    // returned from an early `requestedDocIds.length === 0` check that never
    // touches the database, so — contrary to the comment on the safety-stop
    // branch above — it does NOT establish that this notebook belongs to the
    // caller. Letting it stand in for ownership would let any notebook id spend
    // this tenant's provider budget. getNotebook() is tenant-scoped.
    if ((general || questionSafetyTrigger || visualClaimFileId) && validated.error === "no_sources_selected") {
      // Ownership was proven above for every zero-source turn; a safety stop
      // needs neither sources nor general mode to be served.
    } else {
      const status =
        validated.error === "notebook_not_found"
          ? 404
          : validated.error === "no_sources_selected"
            ? 422
            : 403;
      await abandonRequestClaim();
      endRoot();
      return NextResponse.json({ error: validated.error }, { status });
    }
  }

  // Grounded mode keeps the validated doc set as its boundary. General mode
  // deliberately has none: it retrieves nothing, so there is nothing to scope.
  const docIds: string[] = validated.ok ? validated.docIds : [];
  const nodeId = validated.ok ? validated.nodeId : null;

  // Verify the claimed photo before any terminal refusal. This bounded,
  // tenant-scoped lookup does not make the photo grounding and never delays a
  // stop on provider/RAG work; it only preserves the attachment on the record.
  const evidenceMaterializeSpan = tracer.startSpan("evidence.materialize", undefined, rootCtx);
  const visualEntry = await releaseClaimOnFailure(() =>
    verifyVisualEntry(ctx.tenantId, notebookId, visualClaimFileId),
  );

  // #3888 — load the structured descriptor by the SERVER-VERIFIED photo id.
  // The client rider carries only a fileId; any client `hazards` field is never
  // read. This happens before retrieval and every answer-provider call so a
  // positive descriptor deterministically owns the turn.
  let lookRow: Awaited<ReturnType<typeof loadVisualEvidenceForPhoto>> = null;
  if (visualEntry) {
    try {
      lookRow = await withTenantContext(ctx.tenantId, (c) =>
        loadVisualEvidenceForPhoto(c, ctx.tenantId, visualEntry.fileId),
      );
    } catch (err) {
      // F2: fail closed when a verified photo's descriptor cannot be loaded.
      console.error("[notebook-chat] look observation load failed (fail-closed for verified photo):", err);
      evidenceMaterializeSpan.end();
      await abandonRequestClaim();
      endRoot();
      return NextResponse.json({ error: "visual_descriptor_load_failed" }, { status: 500 });
    }
  }
  // Evidence continuity (2026-09-22, staging trace ae30230b…): a text-only
  // follow-up ("what voltage was it?") lost the photos from earlier turns —
  // the client history is text-only by construction, so the server must
  // recall them itself. New LOOK observations carry notebook/owner/thread
  // scope in the existing VisualSession ledger, including a LOOK that never
  // became a chat question. Historical photo-answer turns still supply file
  // references. Select the newest two distinct photos of THIS conversation.
  // A current explicit photo owns its turn, so prior recall is skipped then.
  let priorLookRows: VisualEvidenceRow[] = [];
  let priorLookFileIds: string[] = [];
  if (!visualEntry) {
    try {
      const recent = await listTurns(ctx.tenantId, notebookId, 6, { viewerUserId: ctx.userId, threadId });
      const seen = new Set<string>();
      for (const t of [...recent].reverse()) {
        if (t.answerStatus !== "answered" || !t.answerText?.trim()) continue;
        for (const e of t.evidence) {
          if (isVisualObservationEntry(e) && e.fileId && !seen.has(e.fileId)) seen.add(e.fileId);
        }
        if (seen.size >= 2) break;
      }
      // photoLinkedToTarget opens its own tenant transaction. Verify before
      // holding the observation client so concurrent follow-ups never nest
      // acquisitions from the bounded connection pool.
      const linkedHistorical: string[] = [];
      for (const fid of [...seen].slice(0, 2)) {
        if (await verifyVisualEntry(ctx.tenantId, notebookId, fid)) linkedHistorical.push(fid);
      }
      const scope = { notebookId, ownerUserId: ctx.userId, threadId };
      priorLookRows = await withTenantContext(ctx.tenantId, async (c) => {
        // Standalone LOOK belongs in the observation ledger, not as an empty
        // answered turn. Old actual chat turns remain a compatibility source.
        const out = await loadRecentLookObservations(c, ctx.tenantId, scope);
        for (const fid of linkedHistorical) {
          if (out.some((row) => row.fileId === fid)) continue;
          // App builds before #3968 upload the photo with no threadId, so its
          // observation is stored under the "legacy" thread while the chat runs
          // in a real thread — the scoped lookup then misses a photo this very
          // conversation already answered from. `fid` is verified (answered turn
          // in this thread + notebook link) and ownership is still enforced, so
          // accepting the same notebook's legacy-thread row widens nothing else.
          // SAFETY DEPENDENCY: `{ threadId: null }` drops the thread filter, so
          // this is only safe because `seen` comes from listTurns(…, { threadId })
          // answered turns of THIS thread (verifyVisualEntry checks notebook, not
          // thread). Widening `seen` would make this a cross-thread read — pinned
          // by chat-flight-recorder "4b".
          const row =
            (await loadVisualEvidenceForPhoto(c, ctx.tenantId, fid, { ...scope, allowLegacy: true })) ??
            (scope.threadId ? await loadVisualEvidenceForPhoto(c, ctx.tenantId, fid, { ...scope, threadId: null }) : null);
          if (row) out.push(row);
        }
        return out.sort((a, b) => Date.parse(b.observedAt ?? "") - Date.parse(a.observedAt ?? "")).slice(0, 2);
      });
      priorLookFileIds = priorLookRows.flatMap((row) => row.fileId ? [row.fileId] : []);
    } catch (err) {
      console.error("[notebook-chat] prior look observations load failed (continuing without):", err instanceof Error ? err.message : err);
      priorLookRows = [];
    }
  }

  const visualHazard = blockingLookHazard(lookRow?.hazards);
  const visualSafetyTrigger = visualHazard ? `visual:${visualHazard.code}` : null;
  // A visible structured hazard is stronger than the question classifier's
  // non-terminal energized-work directive and therefore owns the turn.
  const safetyTrigger = visualSafetyTrigger ?? questionSafetyTrigger;
  const electricalHazardDirective = !visualSafetyTrigger && questionSafetyTrigger === ENERGIZED_ELECTRICAL_HAZARD;
  // `observation_available`/`observation_in_context` are derived from
  // `lookRow`/its rendered section later (renderLookObservationSection), not
  // hardcoded — the LOOK observation DOES reach the prompt (buildManualUserContent
  // below), so a constant `false` here would make VISUAL_EVIDENCE_DROPPED fire
  // on every healthy photo turn. Recorded once the rendered section is known
  // (see `lookContext` near context assembly); this stage call only covers
  // what's known at this point (the fileId + link verification).
  rec.stage("visual_evidence", {
    file_id: visualEntry?.fileId ?? null,
    link_verified: Boolean(visualEntry),
  });
  if (visualEntry) rec.stage("ids", { file_ids: [visualEntry.fileId] });
  setSpanAttrs(
    {
      "mira.visual.file_id": visualEntry?.fileId ?? null,
      "mira.visual.link_verified": Boolean(visualEntry),
      "mira.evidence.count": visualEntry ? 1 : 0,
    },
    evidenceMaterializeSpan,
  );
  evidenceMaterializeSpan.end();
  // Also on the ROOT span (design §7's "span link" step, downgraded per the
  // design's own note: no read helper exists yet to look up the LOOK trace
  // for this file, so the join-key for the viewer is this attribute rather
  // than a real `addSpanLink`). See the cross-lane report for the follow-up.
  if (visualEntry) setSpanAttrs({ "mira.visual.file_id": visualEntry.fileId }, rootSpan);

  // A claimed photo is allowed past the early zero-source branch only so its
  // server record can be checked. If it is unverified/healthy and this is not a
  // general turn, preserve the original explicit no-sources refusal.
  if (!validated.ok && !general && !safetyTrigger) {
    await abandonRequestClaim();
    endRoot();
    return NextResponse.json({ error: validated.error }, { status: 422 });
  }

  // Which machine is this turn about? Resolved BEFORE retrieval, so an
  // unresolvable binding costs nothing: no retrieval SQL, no provider call.
  const identityResolveSpan = startStage("identity.resolve");
  openChildren.add(identityResolveSpan);
  const boundAsset: ResolvedAsset = await releaseClaimOnFailure(() =>
    resolveBoundAsset(ctx.tenantId, notebookId),
  );
  rec.stage("identity", {
    ran: true,
    state: boundAsset.state === "resolved" ? "verified" : "unknown",
    selected_entity_id: boundAsset.state === "resolved" ? boundAsset.entityId : null,
    candidate_count: 0,
    unresolved_reason: boundAsset.state === "unbound" ? "not_bound" : boundAsset.state === "unresolvable" ? "unresolvable" : null,
  });
  if (boundAsset.state === "resolved") {
    rec.stage("ids", { equipment_entity_id: boundAsset.entityId, asset_uns_path: boundAsset.unsPath });
  }
  setSpanAttrs(
    {
      "mira.identity.ran": true,
      "mira.identity.state": boundAsset.state === "resolved" ? "verified" : "unknown",
      "mira.asset.id": boundAsset.state === "resolved" ? boundAsset.entityId : null,
      "mira.identity.candidate_count": 0,
      "mira.identity.unresolved_reason":
        boundAsset.state === "unbound" ? "not_bound" : boundAsset.state === "unresolvable" ? "unresolvable" : null,
    },
    identityResolveSpan,
  );
  // manufacturer_present / model_present come from the notebook row, which is
  // loaded further down (nb) — the span stays open until then so the exported
  // span and the persisted packet never disagree about the same turn.
  // Private conversations §3: a client-supplied asset id is a REQUEST, not
  // truth. Machine history / live evidence is served only for the notebook's
  // SERVER-resolved binding — tenant-authorized (resolveBoundAsset) and
  // technician-CONFIRMED — and only when the request names that same asset.
  // Anything else drops the machine request and the turn proceeds as general
  // or document guidance: no machine packet is built, so nothing machine-
  // specific can be presented as fact.
  //
  // A MISMATCH is stronger than "unconfirmed": the technician's device says it
  // is at a different machine than this notebook is bound to, so for THIS turn
  // the binding is disputed — it must not be stated as a confirmed identity in
  // the prompt, and the turn must not be persisted as a record about it.
  let machineRequestRefused: "asset_unconfirmed" | "asset_mismatch" | null = null;
  const disputedRequestedAssetId = machineRequest?.assetId ?? "";
  if (machineRequest) {
    if (boundAsset.state !== "resolved" || !boundAsset.confirmedAt) machineRequestRefused = "asset_unconfirmed";
    else if (boundAsset.entityId !== machineRequest.assetId) machineRequestRefused = "asset_mismatch";
    if (machineRequestRefused) {
      console.info(
        `[notebook-chat] machineEvidence refused (${machineRequestRefused}) for notebook ${notebookId}: ` +
          `requested asset ${machineRequest.assetId}, bound ${boundAsset.state === "resolved" ? boundAsset.entityId : boundAsset.state}`,
      );
      machineRequest = null;
    }
  }
  const identityDisputed = machineRequestRefused === "asset_mismatch";
  // The dispute is persisted WITH the turn (inside evidence[], like the other
  // kinds) so reload can explain the missing attribution and a client cannot
  // strip attribution without leaving a trace of what it claimed.
  const disputeEntries: IdentityDisputeEntry[] =
    identityDisputed && boundAsset.state === "resolved"
      ? [{ kind: "identity_dispute", requestedAssetId: disputedRequestedAssetId, boundAssetId: boundAsset.entityId, boundUnsPath: boundAsset.unsPath }]
      : [];
  // #3763: a hazard-directive turn keeps its safety identity on reload the same
  // way a hard stop does — a persisted safety_notice entry, never only prose.
  const hazardEntries: SafetyNoticeEntry[] = electricalHazardDirective
    ? [{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }]
    : [];
  // OWNER DECISION 2026-09-27 (Mike): "no answer blocking, just safety flags".
  // Every OTHER trigger (question gate or photo hazard) no longer stops the
  // turn: its hazard-specific banner is written above the answer text, so it
  // renders on every client and survives reload. It is not a structured
  // safety_notice because today's web/mobile chips label every non-terminal
  // notice "energized electrical work".
  const flagBanner = safetyTrigger && !electricalHazardDirective ? hazardBanner(safetyTrigger) : null;

  // Snapshot for every persisted turn, including abstains and safety stops: a
  // refusal about a specific machine is still a record about that machine —
  // unless the identity is disputed for this turn, in which case the turn is
  // about no machine in particular (never a silent swap onto the bound one).
  const assetSnapshot =
    boundAsset.state === "resolved" && !identityDisputed
      ? { equipmentEntityId: boundAsset.entityId, assetUnsPath: boundAsset.unsPath }
      : { equipmentEntityId: null, assetUnsPath: null };

  // (2026-09-27) The terminal safety-stop branch that lived here is gone: a
  // flagged turn continues to retrieval and generation like any other, and
  // its safety_notice (hazardEntries above) is persisted with the answer so
  // the banner survives reload and device switches (spec §10).
  // A hazard report is never answered with "re-select the machine": a flagged
  // turn skips this 422 and is answered (banner + general answer) about no
  // machine in particular — the null snapshot below is the honest record.
  if (boundAsset.state === "unresolvable" && !safetyTrigger) {
    // Fail closed. Quietly answering as if unbound is the downgrade
    // .claude/rules/direct-connection-uns-certified.md forbids — the notebook
    // would keep showing the last stored machine name while answering about
    // nothing in particular.
    //
    // `error` is a sentence and `code` is the discriminator: mira-mobile renders
    // `data.error` verbatim (client.ts:198-208), so returning only the token
    // puts the literal string "uns_required" on the technician's phone.
    await abandonRequestClaim();
    endRoot();
    return NextResponse.json(
      {
        error:
          "This notebook points at equipment that is no longer available in your account. " +
          "Re-select the machine before asking about it.",
        code: "uns_required",
        notebookId,
        entityId: boundAsset.entityId,
      },
      { status: 422 },
    );
  }

  // Sensor REPLAY grounding (contract §4.4). The server re-fetches the selected
  // window through the SAME reader the history route uses (fetchMachineHistory
  // — never client-supplied rows), reshapes the Machine Memory header into the
  // context packet, and attaches the recorded observations as the packet's
  // replay window. This is the block assets/[id]/chat/route.ts already runs
  // for live turns (buildMachineContextPacket + renderMachineEvidenceSection
  // with sanitizeMachineMemoryField), ported here; document retrieval above
  // is untouched. Own try/catch, same as the asset route: a missing 033/037/
  // 040 env or any error never drops the notebook context already built.
  let machinePacket: MachineContextPacket | null = null;
  let machineEntry: MachineEvidenceEntry | null = null;
  // Workstream C (§9.2): why the served window is NOT grounding, when it
  // isn't — kept apart so "nothing recorded" and "no history source" are
  // never one sentence.
  let machineUnavailableReason: "no_uns_path" | "no_fault_window" | "unavailable" | "fetch_failed" | null = null;
  let machineCoverage: HistoryCoverage | null = null;
  if (machineRequest) {
    const mr = machineRequest;
    try {
      const result = await withTenantContext(ctx.tenantId, (c) =>
        fetchMachineHistory(c, ctx.tenantId, mr.assetId, { at: mr.at, pre: mr.pre, post: mr.post }),
      );
      if (result.ok) {
        const h = result.history;
        machineCoverage = h.coverage;
        if (h.reason === "unavailable") machineUnavailableReason = "unavailable";
        machinePacket = packetFromMachineMemoryResponse(ctx.tenantId, mr.assetId, h.summary);
        machinePacket.replay = {
          anchor_at: h.anchor.at,
          started_at: h.from,
          stopped_at: h.to,
          freshness: h.freshness.overall,
          rows: h.rows,
        };
        // Anchored-window variant of the evidence window (same EvidenceWindow
        // shape the card uses) so the prompt names the replayed bounds.
        machinePacket.evidence.window = { started_at: h.from, stopped_at: h.to, uns_path: h.uns_path };
        machineEntry = {
          kind: "machine_evidence",
          assetId: mr.assetId,
          anchorAt: h.anchor.at,
          pre: h.pre,
          post: h.post,
          rowCount: h.rows.length,
          freshness: h.freshness.overall,
          runId: h.anchor.runId ?? null,
          windowId: h.anchor.windowId ?? null,
          // Contract §2.8: "the tables are missing" and "the window was
          // genuinely quiet" are DIFFERENT sentences. The reader already
          // distinguishes them; carry that distinction to the clients instead
          // of flattening both into "0 observed changes".
          ...(h.reason ? { reason: h.reason } : {}),
        };
      } else {
        console.warn("[notebook-chat] machine evidence not available:", result.error);
        machineUnavailableReason = result.error;
      }
    } catch (err) {
      console.error("[notebook-chat] machine evidence fetch failed:", err);
      machinePacket = null;
      machineEntry = null;
      machineUnavailableReason = "fetch_failed";
    }
  }
  // Nothing observed → nothing to ground on (contract §2.8, D2). A window that
  // is `unavailable` (033/037 missing in this env) or genuinely empty must not
  // move `basis` to a machine basis and must not put a MACHINE section in the
  // prompt — an empty section is an invitation to infer. The ENTRY is still
  // persisted (with `rowCount: 0` and its `reason`, when it has one) so both
  // clients can say which of the two happened. Nulling the packet also keeps
  // the machine-only approved-context gate off a turn that isn't using
  // machine evidence.
  const groundedMachineEntry: MachineEvidenceEntry | null =
    machineEntry && machineEntry.rowCount > 0 && machineEntry.reason !== "unavailable" ? machineEntry : null;
  if (!groundedMachineEntry) machinePacket = null;

  // Workstream C (PRD §9.2 / #3469): a replay ask whose served window holds
  // no admissible recorded observation is REFUSED here — at the seam that
  // owns the truth — before any retrieval-backed answer, any provider call,
  // and any persistence. Answering from documents while carrying an empty
  // machine-evidence card, or letting the approved-context gate blame
  // "approved asset context", would both dress an empty window as evidence.
  // The two empties stay distinct: `machine_window_empty` (the history source
  // answered: nothing recorded) vs `machine_history_unavailable` (no source
  // to ask). `error` is a sentence (mira-mobile renders it verbatim); `code`
  // is the discriminator. Nothing is recorded: a refused replay is not a turn.
  if (machineRequest && !groundedMachineEntry) {
    // A transient read failure is NOT "history unavailable": the source
    // exists, the read failed. Say so and let the client retry (503), rather
    // than telling the technician the machine has no history.
    if (machineUnavailableReason === "fetch_failed") {
      await abandonRequestClaim();
      endRoot();
      return NextResponse.json(
        {
          error: withSafetyFlag("Machine Memory could not be read just now. Try again in a moment.", safetyTrigger),
          code: "machine_history_read_failed",
        },
        { status: 503, headers: safetyFlagHeaders(safetyTrigger) },
      );
    }
    const windowEmpty = machineEntry !== null && machineEntry.reason !== "unavailable";
    if (windowEmpty) {
      await abandonRequestClaim();
      endRoot();
      return NextResponse.json(
        {
          error: withSafetyFlag("Nothing was recorded in this window. Widen the window or check the gateway.", safetyTrigger),
          code: "machine_window_empty",
          coverage: machineCoverage,
        },
        { status: 422, headers: safetyFlagHeaders(safetyTrigger) },
      );
    }
    await abandonRequestClaim();
    endRoot();
    return NextResponse.json(
      {
        error: withSafetyFlag("Machine Memory history is not available for this machine, so there is nothing to replay.", safetyTrigger),
        code: "machine_history_unavailable",
        reason: machineUnavailableReason ?? "unavailable",
        coverage: machineCoverage,
      },
      { status: 422, headers: safetyFlagHeaders(safetyTrigger) },
    );
  }

  // Machine-context inputs, loaded BEFORE retrieval (moved up 2026-09-22):
  // the notebook's manufacturer/model decide whether the shared OEM corpus is
  // in scope for a notebook that has no attached documents.
  // Fail-open by construction (a synchronous throw inside either helper must
  // not fail the turn either — the old `.catch` only covered rejections).
  const [nb, srcs] = await Promise.all([
    (async () => {
      try {
        return await getNotebook(ctx.tenantId, notebookId);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        return await listSources(ctx.tenantId, notebookId);
      } catch {
        return [] as { filename: string | null }[];
      }
    })(),
  ]);

  // Non-English questions search the English corpus in English (answered in their own language).
  const retrievalQuery = await englishSearchQuery(buildRetrievalQuery(message, history), translateForSearch);
  const retrievalSpan = startStage("retrieval.execute");
  // Retrieval policy (docs/plans/2026-09-22-retrieval-routing-evidence-continuity.md):
  //   1. notebook sources validated       → notebook_sources_bm25 (unchanged)
  //   2. no sources, but EQUIPMENT CONTEXT → oem_corpus_bm25 (shared OEM library,
  //      hybrid tenant law, approval gate, raw pool — the same call the
  //      asset-chat route makes; tenant fallback OFF so an unrelated question
  //      never sweeps the whole private corpus)
  //   3. neither                           → skipped_general_mode (unchanged)
  // Equipment context is SERVER-derived only: a confirmed bound asset, the
  // notebook's own manufacturer/model, or a stored photo observation (this
  // turn's or an earlier one's) that names the manufacturer — never the
  // client's free text (UNS gate doctrine).
  const notebookRetrieval = !(general || nodeId === null);
  // Resolve OEM identity from one observation: this turn's LOOK, otherwise the
  // newest prior LOOK. Earlier photos still reach context, but may be different
  // machines and must not contaminate retrieval identity (#3966).
  const photoTextForOem = notebookRetrieval
    ? ""
    : (lookRow?.text ?? priorLookRows[0]?.text ?? "").trim();
  const oemManufacturer: { name: string; source: "notebook" | "photo" } | null = await (async () => {
    if (notebookRetrieval) return null; // notebook sources own the turn
    if (nb?.manufacturer?.trim()) return { name: nb.manufacturer.trim(), source: "notebook" };
    if (!photoTextForOem) return null;
    // Fail-open end to end: a corpus hiccup (or a test double without a raw
    // pool) means "no OEM retrieval this turn", never a failed turn.
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const known = await corpusManufacturers(client);
      const fromPhoto = manufacturerFromObservationText(photoTextForOem, known);
      return fromPhoto ? { name: fromPhoto, source: "photo" } : null;
    } catch (err) {
      console.error("[notebook-chat] corpus manufacturer lookup failed (no OEM retrieval this turn):", err instanceof Error ? err.message : err);
      return null;
    } finally {
      try {
        client?.release();
      } catch {
        /* already released */
      }
    }
  })();
  // #3966 — resolve model/family alongside manufacturer. Prefer notebook.model;
  // else parse LOOK observation. Identity-bound retrieval must not fall through
  // to manufacturer-only BM25 (HMI photo → SINAMICS V20).
  const oemIdentity: { model: { value: string; source: "notebook" | "photo" } | null; ambiguous: boolean; failed?: boolean } = (() => {
    if (notebookRetrieval) return { model: null, ambiguous: false };
    const notebookModel = nb?.model?.trim();
    if (notebookModel) {
      // retrieveManualChunks normalizes known notebook tokens and refuses
      // ambiguous strings before issuing SQL. Preserve the confirmed raw label
      // in the packet here rather than requiring other route consumers to parse.
      return { model: { value: notebookModel, source: "notebook" }, ambiguous: false };
    }
    if (!photoTextForOem) return { model: null, ambiguous: false };
    // Identity extraction is an enrichment, not a precondition for answering.
    // A throw must preserve the turn but skip OEM citation: falling through to
    // manufacturer-only retrieval would admit another model's manual.
    try {
      const resolved = resolveModelFromObservationText(photoTextForOem);
      return resolved.ambiguous
        ? { model: null, ambiguous: true }
        : { model: resolved.model ? { value: resolved.model, source: "photo" } : null, ambiguous: false };
    } catch (err) {
      console.error(
        "[notebook-chat] identity model extraction failed (OEM retrieval skipped this turn):",
        err instanceof Error ? err.message : err,
      );
      return { model: null, ambiguous: false, failed: true };
    }
  })();
  const oemModel = oemIdentity.model;
  // #4095 (owner decisions 2026-09-28/29) — "propose, then confirm". A general
  // turn in an UNBOUND notebook that names a library manufacturer and a model
  // gets an identity_proposal frame. It never binds, never scopes retrieval on
  // this turn (retrieval above is already decided), and the answer is told the
  // machine is unconfirmed so it cannot state that machine's specs or service
  // procedures. Fail-open: any error means no proposal.
  // Codex r1 F2 (#4172, MEDIUM): this IIFE's OWN `oemManufacturer !== null`
  // bail covers only the RC1 fallback (a maker the corpus does NOT recognise
  // at all). A corpus-RECOGNISED maker (oemManufacturer set, e.g. Siemens)
  // with zero applicable chunks still needs a proposal + candidate
  // acquisition — handled by the separate, narrower reassignment below, once
  // `chunks` is known, so a maker OEM retrieval actually grounds is never
  // second-guessed by a redundant "unconfirmed machine" proposal.
  let identityProposal: IdentityProposal | null = await (async () => {
    if (!general || notebookRetrieval || oemManufacturer !== null) return null;
    // Only a notebook with NO identity at all: not bound to an asset, and loaded
    // (fail closed when it could not be read) — Codex #4120 F3.
    if (!nb || boundAsset.state !== "unbound") return null;
    if (nb.manufacturer?.trim() || nb.model?.trim()) return null;
    let fromCorpus: IdentityProposal | null = null;
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      fromCorpus = proposeIdentityFromText(message, await corpusManufacturers(client));
    } catch (err) {
      console.error("[notebook-chat] identity proposal skipped:", err instanceof Error ? err.message : err);
    } finally {
      try {
        client?.release();
      } catch {
        /* already released */
      }
    }
    if (fromCorpus) return fromCorpus;
    // RC1 fix (#4160 S6): proposeIdentityFromText only recognises a maker that
    // already has corpus rows (corpusManufacturers) — a maker with none (the
    // SMC valve trace that started Manual-First) could never be proposed.
    // Fall back to the corpus-INDEPENDENT candidate reader (#4150's label
    // parser, candidate-identity.ts), over the SAME photo observation
    // (photoTextForOem — notebookRetrieval is false here, so it is the real
    // text) and this turn's typed message. Still only a candidate: never
    // binds, never writes a notebook identity column, never scopes retrieval.
    // Codex r2 F4 / F13 (#4172): only when the candidate takeover can actually
    // run (both flags; #4175). Otherwise the turn stays exactly as before S6
    // (the explicit, confirm-first photo search below keeps the turn).
    if (!candidateAcquisitionEnabled()) return null;
    try {
      const candidate = extractCandidateIdentity(photoTextForOem, message);
      // #4172 Codex r3/post-cap: the ONE candidate validator (serials and
      // ambiguity across photo AND typed text) — see isSafeCandidateSearchIdentity.
      if (!candidate?.manufacturer || !isSafeCandidateSearchIdentity(photoTextForOem, message, candidate.part, candidate.manufacturer)) return null;
      return { manufacturer: candidate.manufacturer, model: candidate.part };
    } catch (err) {
      console.error("[notebook-chat] candidate identity proposal skipped:", err instanceof Error ? err.message : err);
      return null;
    }
  })();
  const oemEquipmentType = oemModel
    ? inferEquipmentType({ modelNumber: oemModel.value, title: oemModel.value })
    : null;
  const oemRetrieval = !notebookRetrieval && oemManufacturer !== null && !oemIdentity.ambiguous && !oemIdentity.failed;
  const retrievalExecuted = notebookRetrieval || oemRetrieval;
  // Codex #4069 F4: a failed OEM query is not a completed zero-hit search —
  // the decline below must never say "I couldn't find it" when nothing ran.
  let oemRetrievalFailed = false;
  const chunks: ManualChunk[] = oemRetrieval
    ? await (async () => {
        // Raw pool on purpose (hybrid corpus law — see manual-rag.ts header):
        // under withTenantContext the RLS policy hides every shared OEM row.
        // Fail-open: an OEM query failure leaves the turn general (no chunks),
        // it never fails the request.
        let client: PoolClient | null = null;
        try {
          client = await pool.connect();
          return await retrieveManualChunks(client, ctx.tenantId, retrievalQuery, {
            manufacturer: oemManufacturer!.name,
            model: oemModel?.value ?? null,
            equipmentType:
              oemEquipmentType && oemEquipmentType !== "Other" ? oemEquipmentType : null,
            topK: 6,
            allowTenantFallback: false,
          });
        } catch (err) {
          console.error("[notebook-chat] OEM corpus retrieval failed (continuing general):", err instanceof Error ? err.message : err);
          rec.error("retrieval", "oem_query_failed");
          oemRetrievalFailed = true;
          return [];
        } finally {
          try {
            client?.release();
          } catch {
            /* already released */
          }
        }
      })()
    : !notebookRetrieval
    ? []
    : await releaseClaimOnFailure(() =>
        withTenantContext(ctx.tenantId, (client) =>
          retrieveNodeChunks(client, ctx.tenantId, retrievalQuery, {
            nodeId,
            unsPath: null, // notebook nodes are standalone; scope is the doc set
            topK: 6,
            docIds,
            rawQuery: message,
            // validateChatSources() has already proven tenant + notebook membership
            // for every id in docIds — the validated doc set is the boundary, so a
            // document linked from another notebook's node stays retrievable here.
            validatedDocScope: true,
            // Workstream A (#3437/#3468): the SAME server-derived set is the
            // retrieval-admission authority under MIRA_ENFORCE_APPROVED_RETRIEVAL.
            // validateChatSources derives it (tenant-owned, notebook-linked,
            // enabled, user_confirmed/verified, not superseded); the client's
            // `body.sourceDocIds` was only an intersection request. Tenant-private
            // chunks of these docs are admitted without ever being marked globally
            // verified — confirmation is admission, not corpus promotion.
            approvedSourceDocIds: docIds,
          }),
        ),
      );
  {
    // Notebook chunks carry a doc id; shared-OEM chunks carry no doc id but a
    // source URL + page, which is their durable identity in knowledge_entries.
    // Record whichever the chunk has so "which document, which page" is
    // answerable for BOTH strategies (ids only — never content).
    const returnedDocIds = [
      ...new Set(
        chunks
          .map((c) => c.docId || (c.sourceUrl ? `${c.sourceUrl}#p${c.sourcePage ?? "?"}` : null))
          .filter((d): d is string => Boolean(d)),
      ),
    ].slice(0, 32);
    const retrievalStrategy = notebookRetrieval
      ? "notebook_sources_bm25"
      : oemRetrieval
        ? "oem_corpus_bm25"
        : "skipped_general_mode";
    const zeroResultReason = oemIdentity.failed
      ? "model_extraction_failed"
      : oemIdentity.ambiguous
      ? "ambiguous_model_observation"
      : oemRetrievalFailed
      ? "oem_query_failed"
      : retrievalExecuted && chunks.length === 0 ? "no_matches" : null;
    const oemScope: "model" | "vendor_fallback" | "manufacturer" | null =
      !oemRetrieval || chunks.length === 0
        ? null
        : chunks.some((c) => c.retrievalScope === "vendor_fallback")
          ? "vendor_fallback"
          : oemModel
            ? "model"
            : "manufacturer";
    rec.stage("retrieval", {
      strategy: retrievalStrategy,
      executed: retrievalExecuted,
      candidate_count: chunks.length,
      returned_doc_ids: returnedDocIds,
      oem_corpus_searched: oemRetrieval,
      oem_manufacturer_source: oemManufacturer?.source ?? null,
      oem_model: oemModel?.value ?? null,
      oem_model_source: oemModel?.source ?? null,
      oem_scope: oemScope,
      zero_result_reason: zeroResultReason,
      // Server-recalled earlier-photo observations for this thread (never the
      // client history, which is text-only by construction).
      prior_visual_observations_considered: priorLookRows.length,
    });
    setSpanAttrs(
      {
        "mira.retrieval.strategy": retrievalStrategy,
        "mira.retrieval.executed": retrievalExecuted,
        "mira.retrieval.candidate_count": chunks.length,
        "mira.retrieval.returned_doc_ids": returnedDocIds,
        "mira.retrieval.oem_corpus_searched": oemRetrieval,
        "mira.retrieval.oem_manufacturer_source": oemManufacturer?.source ?? null,
        "mira.retrieval.oem_model": oemModel?.value ?? null,
        "mira.retrieval.oem_model_source": oemModel?.source ?? null,
        "mira.retrieval.oem_scope": oemScope,
        "mira.retrieval.zero_result_reason": zeroResultReason,
        "mira.retrieval.prior_visual_observations_considered": priorLookRows.length,
        "mira.visual.prior_file_ids": priorLookFileIds,
      },
      retrievalSpan,
    );
    endTimed(retrievalSpan, "retrieval");
  }

  // Codex r1 F2 (#4172, MEDIUM) — a corpus-RECOGNISED maker (oemManufacturer
  // set from the photo) whose OEM retrieval found ZERO applicable chunks
  // still qualifies for the SAME "propose, then confirm" + candidate
  // acquisition as the RC1 fallback above. Only when chunks ARE found does
  // OEM retrieval actually ground the turn — a redundant proposal there would
  // contradict the cited answer the technician is about to receive, so this
  // never fires then (no duplicate discovery). `oemManufacturer.source` can
  // only be "photo" here: "notebook" would mean `nb.manufacturer` is set,
  // which the RC1 IIFE's own unbound-identity guard already excludes.
  if (
    !identityProposal &&
    general &&
    !notebookRetrieval &&
    nb &&
    boundAsset.state === "unbound" &&
    !(nb.manufacturer?.trim() || nb.model?.trim()) &&
    oemManufacturer !== null &&
    chunks.length === 0 &&
    candidateAcquisitionEnabled()
  ) {
    // Codex r2 F2 (#4172): the OEM model parser knows a finite set of model
    // families, so a valid part it does not recognise (oemModel null) falls back
    // to the corpus-independent label reader — but only when that reader names
    // the SAME maker, which keeps its ambiguity and serial exclusions intact.
    const candidate = extractCandidateIdentity(photoTextForOem, message);
    const candidatePart =
      candidate?.manufacturer && candidate.manufacturer.toLowerCase() === oemManufacturer.name.toLowerCase()
        ? candidate.part
        : null;
    // #4172 (owner decision after Codex post-cap 2): the search identity comes
    // ONLY from the serial-safe label reader. The OEM retrieval parser may
    // normalise a serial ("TP 700" → TP700) or pick a second machine, so it never
    // chooses what leaves; if it names a DIFFERENT model, nothing is searched.
    const model =
      candidatePart &&
      (!oemModel || oemModel.value.toUpperCase() === candidatePart.toUpperCase()) &&
      isSafeCandidateSearchIdentity(photoTextForOem, message, candidatePart, oemManufacturer.name)
        ? candidatePart
        : null;
    if (model) identityProposal = { manufacturer: oemManufacturer.name, model };
  }
  // Codex #4120 F4 — persisted with the turn so an idempotent retry and the
  // history reload deliver the same proposal the live stream did. Computed
  // here (after the F2 reassignment above) so it reflects the FINAL proposal.
  const proposalEntries: NotebookIdentityProposalFrame[] = identityProposal
    ? [{ kind: "identity_proposal", ...identityProposal }]
    : [];

  // Once retrieval has produced chunks — from the notebook's own sources OR the
  // shared OEM corpus — the turn is DOCUMENT-GROUNDED for everything
  // downstream: grounding rules in the system prompt, [n] citation markers,
  // shipped citations, the evidence badge, and the specificity gate. `general`
  // keeps its request-shape meaning (the client selected no sources) for the
  // source-validation and Gate-G checks above. Before 2026-09-22 the two were
  // conflated, so OEM chunks were retrieved and then discarded on the way to
  // the model (staging trace abea7c10…: 6 Siemens candidates, 0 citations,
  // "general reasoning" badge).
  const docGrounded = chunks.length > 0;

  const enc = new TextEncoder();

  // Grounded mode abstains here; general mode is EXPECTED to have no chunks and
  // is the one path allowed past this gate. Gate G for DOCUMENTS is unchanged:
  // with sources selected and nothing retrieved and nothing else grounding the
  // turn, MIRA still refuses without calling a provider. A verified photo does
  // NOT open this DOCUMENT gate (#3788): the persisted LOOK observation is
  // model-produced candidate evidence, not a selected manual source. The photo
  // rides the abstain instead — persisted, streamed, and named in the status
  // message — so nothing the technician captured is lost. General mode can use
  // the injection-hardened LOOK context below without weakening this refusal.
  //
  // The third clause is the Sensor REPLAY correction. A served, non-empty
  // machine window IS grounding — it is recorded observation, re-fetched by the
  // server from its own tenant-scoped tables. Before it, the REPLAY question
  // ("what happened around the fault at …") abstained on every notebook that
  // had at least one enabled source, because a fault-window question retrieves
  // no manual chunks: the window was fetched, then thrown away unanswered.
  // `groundedMachineEntry` is non-null ONLY for a window with rows that is not
  // `unavailable` (see above), so an empty or unavailable window leaves this
  // gate exactly as it was — and a turn with no `machineEvidence` at all can
  // never reach the third clause, which is what keeps document refusal
  // behaviour byte-identical.
  // #4004: a notebook bound to a specific model, whose correctly-scoped OEM
  // search found no manual for that model, must not answer a documented-value
  // question (supply voltage, ratings, wiring, parameters, fault codes …) from
  // general knowledge with no citation. That is exactly the "honest
  // refuse-to-cite" #3970 promised and never implemented. Conceptual questions
  // on the same notebook are not matched and keep the general lane.
  // Shared preconditions: a bound model, an OEM search (model scope, then the
  // #4068 same-family fallback) that found nothing, and no other evidence — a
  // photo in this turn (or recalled from the conversation) or a machine window
  // is evidence of its own, so it keeps the lane.
  const boundAndEmpty =
    oemRetrieval && oemModel !== null && chunks.length === 0 && !groundedMachineEntry &&
    !visualEntry && priorLookRows.length === 0;
  const missingModelManual =
    boundAndEmpty && asksForDocumentedValue(message, oemModel!.value)
      ? `${oemManufacturer!.name} ${oemModel!.value}`
      : null;
  // A label transcription is usable as a literal search key, not as confirmed
  // identity. #4150 owner decision: a request never searches. It can only
  // propose the EXACT string MIRA would send; egress happens on the next turn,
  // and only if that turn is the exact confirmation of that same string and the
  // photo still yields it. Never bind the notebook or auto-import a candidate.
  const photoTextForPartLookup = (lookRow?.text ?? priorLookRows[0]?.text ?? "").trim();
  const photoPartNumber = unambiguousPartNumber(photoTextForPartLookup);
  // PRD R1 (#4160 S5): the maker read from the SAME label via the shared OEM
  // maker table — never the corpus — so a maker with no rows can still be
  // searched for. Only meaningful when it names the same part.
  const photoCandidate = extractCandidateIdentity(photoTextForPartLookup);
  const photoMaker = photoCandidate && photoCandidate.part === photoPartNumber ? photoCandidate.manufacturer : null;
  // Codex r1 F1 (#4172, HIGH): mutually exclusive with #4160 S6's candidate
  // acquisition — the maker-less part-only proposal ("search the web for just
  // this label text") must never also fire and contend for the same reply.
  //
  // Codex r2 F1/F4 (#4172): "owns the turn" is decided ONCE, from the FINAL
  // candidate identity (photo and typed text together) and the exact trigger
  // the acquisition block below runs on — never from the photo's maker alone.
  // When automatic acquisition is off, or this turn would not start it, the
  // explicit confirm-first search keeps the turn (pre-S6 behaviour).
  const candidateAcquisitionOwnsTurn =
    identityProposal !== null &&
    Boolean(nb) &&
    candidateAcquisitionEnabled() &&
    acquisitionKey({
      identityStatus: "user_confirmed",
      manufacturer: identityProposal.manufacturer,
      model: identityProposal.model,
      catalogNumber: "",
    }) !== null &&
    // The single egress gate: every proposal path (including #4120's corpus
    // proposal) passes the same candidate validator before any search starts.
    isSafeCandidateSearchIdentity(photoTextForOem, message, identityProposal.model, identityProposal.manufacturer) &&
    ((Boolean(photoTextForOem) && unambiguousPartNumber(photoTextForOem) !== null) || wantsManualDocumentation(message));
  const partSearchEligible = chunks.length === 0 && general && oemManufacturer === null && !candidateAcquisitionOwnsTurn;
  // The technician's own immediately preceding turn in this thread carries any
  // pending proposal. #4185/#4186 (the #4160 Pixel walk incident): read it on
  // EVERY eligible turn, not only an exact confirm/cancel string — otherwise a
  // short affirmative, an unquoted confirmation, or an unrelated reply can
  // never see a pending offer, and it silently expires instead of staying
  // valid or being re-shown. Fail closed on any read error.
  let previousTurnEvidence: unknown[] = [];
  let previousTurnId: string | null = null;
  if (partSearchEligible) {
    try {
      const last = (await listTurns(ctx.tenantId, notebookId, 1, { viewerUserId: ctx.userId, threadId })).at(-1);
      if (last && last.ownerUserId === ctx.userId) {
        previousTurnEvidence = last.evidence;
        previousTurnId = last.id;
      }
    } catch (err) {
      console.error("[notebook-chat] part-search proposal lookup failed (no search):", err instanceof Error ? err.message : err);
    }
  }
  const partSearch: PartSearchDecision = partSearchEligible
    ? partSearchDecision({
        message,
        candidate: photoPartNumber,
        manufacturer: photoMaker,
        previousEvidence: previousTurnEvidence,
        previousTurnId,
      })
    : { action: "none" };
  let photoPartLookup: {
    action: "proposed" | "searched" | "cancelled" | "mismatch" | "limited" | "unavailable" | "expired";
    searched: boolean;
    part_number: string | null;
    found: boolean;
    candidate_host: string | null;
    message: string;
    proposal: PartSearchProposalEntry | null;
  } | null = null;
  if (partSearch.action === "propose") {
    const c = partSearch.candidate;
    // #4185/#4186: age > 1 means this is a RE-SHOW of an offer that a
    // non-matching reply didn't expire — keep the ORIGINAL maker it was bound
    // to (never re-derive from this turn's photo, which may carry none) so a
    // later confirmation is still checked against the identity actually
    // offered. age === 1 is always a fresh proposal from this turn's photo.
    const reshown = partSearch.age > 1 ? pendingPartSearchProposal(previousTurnEvidence) : null;
    const maker = reshown ? (reshown.manufacturer ?? null) : photoMaker;
    // #4193 Codex round 3 F7: a FRESH propose (age 1) has no origin from the
    // pure decision yet, and must NOT fall back to `turnId` — `turnId` is
    // the client-request/tracing id (line ~912: `clientRequestId ??
    // crypto.randomUUID()`), never the row this turn is about to be
    // persisted under (that id comes from the database's own
    // `gen_random_uuid()` default, migration 073 — recordTurn's INSERT never
    // supplies `id`). Falling back to it persisted an origin that matched no
    // real row, so claimPartSearchProposal's `WHERE id = originTurnId`
    // always missed and even a technician's first, never-claimed
    // confirmation was refused as "already used" (Codex round 3 F7).
    //
    // The fix needs no new plumbing: a fresh propose simply omits
    // `originTurnId` (exactly the true-legacy shape F6 already handles).
    // The very next read of this entry — a confirmation or a re-show —
    // resolves its origin from `previousTurnId`, which by then IS the real
    // persisted row id (it comes from `listTurns()`, reading an
    // already-written row). A re-show (age > 1) still carries the resolved
    // origin forward unchanged from `partSearchDecision()`.
    const originTurnId = partSearch.originTurnId;
    photoPartLookup = {
      action: "proposed",
      searched: false,
      part_number: c,
      found: false,
      candidate_host: null,
      message: `I can search the web for a manual using only the exact label text \"${c}\"${maker ? ` and the maker name \"${maker}\" printed with it` : ""}. Nothing else would be sent: no photo, no conversation, no notebook text. I haven't searched. To go ahead, reply exactly: ${partSearchConfirmation(c)}. Otherwise reply: ${PART_SEARCH_CANCEL}.`,
      proposal: { kind: "part_search_proposal", candidate: c, manufacturer: maker, age: partSearch.age, originTurnId },
    };
  } else if (partSearch.action === "expired") {
    // #4193 Codex F2: one more re-show would have minted an offer the very
    // next turn could never confirm. Say plainly that it expired, with no
    // chip and no "reply exactly" instructions — `proposal: null` means no
    // followups frame is emitted below and nothing new is persisted to act on.
    photoPartLookup = {
      action: "expired",
      searched: false,
      part_number: partSearch.candidate,
      found: false,
      candidate_host: null,
      message: `That search offer has expired. Ask me again to look up the manual for \"${partSearch.candidate}\" and I'll show you exactly what would be sent before searching.`,
      proposal: null,
    };
  } else if (partSearch.action === "cancelled") {
    photoPartLookup = {
      action: "cancelled",
      searched: false,
      part_number: partSearch.candidate,
      found: false,
      candidate_host: null,
      message: `OK. I won't search the web for \"${partSearch.candidate}\".`,
      proposal: null,
    };
  } else if (partSearch.action === "mismatch") {
    photoPartLookup = {
      action: "mismatch",
      searched: false,
      part_number: partSearch.candidate,
      found: false,
      candidate_host: null,
      message: "I didn't search. That confirmation doesn't match a search I offered for this photo in the previous message. Ask me to look up the manual and I'll show you exactly what would be sent first.",
      proposal: null,
    };
  } else if (partSearch.action === "search") {
    const confirmedPart = partSearch.candidate;
    // One proposal authorizes ONE search (#4171 Codex F3; redesigned #4193
    // Codex round 2 F3+F6): spend it atomically BEFORE any egress, locked and
    // marked consumed on the offer's ORIGIN turn row — never on whichever
    // turn happens to hold the copy actually being confirmed. A re-show
    // persists a copy of the same logical offer onto a NEW turn, but every
    // copy shares one origin, so a racing or retried confirmation against
    // ANY copy finds the SAME row already spent.
    const claimed = ctx.userId
      ? await claimPartSearchProposal({
          tenantId: ctx.tenantId,
          notebookId,
          originTurnId: partSearch.originTurnId,
          ownerUserId: ctx.userId,
        })
      : false;
    // Only the confirmed string leaves: no photo, chat or notebook text.
    const result = claimed
      ? await discoverManual(
          { ...(photoMaker ? { manufacturer: photoMaker } : {}), catalogNumber: confirmedPart },
          { tenantId: ctx.tenantId, userId: ctx.userId ?? null },
        )
      : null;
    if (!result) {
      photoPartLookup = {
        action: "mismatch",
        searched: false,
        part_number: confirmedPart,
        found: false,
        candidate_host: null,
        message: `I didn't search. That confirmation for \"${confirmedPart}\" was already used. Ask me to look up the manual again if you want a new search.`,
        proposal: null,
      };
    } else if (result.quotaExceeded) {
      // A quota refusal is not a completed search (#4171 Codex F1, PRD R5):
      // say the limit stopped it, and record searched=false.
      photoPartLookup = {
        action: "limited",
        searched: false,
        part_number: confirmedPart,
        found: false,
        candidate_host: null,
        // #4160 S7 (owner decision 2026-10-01 §1): the approved sentence,
        // verbatim — never a reset time the backend does not know (the denial
        // may be the daily or the monthly cap).
        message: `I didn't search for \"${confirmedPart}\": ${result.reason || "the manual-search limit has been reached"}. Manual-search limit reached — try again later, or upload the manual yourself.`,
        proposal: null,
      };
    } else {
      const candidate = result.candidate;
      const manualUrl = candidate && /^https:\/\/[^\s"'<>]+$/.test(candidate.url) ? candidate.url : null;
      const manualHost = manualUrl ? new URL(manualUrl).hostname : null;
      const messageText = !result.serviceAvailable
        ? `I couldn't reach manual search, so I did not check whether a PDF exists for the label text \"${confirmedPart}\". I have not confirmed what the code identifies.`
        : candidate && manualUrl && manualHost
          ? `I searched for a manual using the exact label text \"${confirmedPart}\". I found a possible result from ${manualHost}: ${manualUrl}. I can't verify from this label alone that it is the right part's manual, so I haven't added it as a source or used it to answer.`
          : `I searched for a manual using the exact label text \"${confirmedPart}\" and found no candidate. The part type and code meaning are still unconfirmed.`;
      // An outage is not a completed search (#4171 Codex F5): searched=false.
      photoPartLookup = {
        action: result.serviceAvailable ? "searched" : "unavailable",
        searched: result.serviceAvailable,
        part_number: confirmedPart,
        found: Boolean(candidate),
        candidate_host: manualHost,
        message: messageText,
        proposal: null,
      };
    }
  }
  const unverifiedPartCompatibility =
    chunks.length === 0 &&
    asksPartCompatibility(message) &&
    photoPartNumber !== null;
  const photoPartCompatibilityText = unverifiedPartCompatibility
    ? `I can't verify whether those parts are interchangeable from this photo. The label appears to read \"${photoPartNumber}\", but that is an unconfirmed transcription; I won't guess what the code means or say another part is a substitute without a source that confirms compatibility. Ask me to look up the manual for \"${photoPartNumber}\" and I can search for a candidate.`
    : null;
  // #4068 (owner decision 2026-09-27, "both"): a troubleshooting/procedure
  // question about THIS machine with nothing citable declines honestly instead
  // of an uncited general answer. Teaching questions never match.
  const noEvidenceForMachine =
    // A refused machine-evidence request (unconfirmed / mismatched asset) keeps
    // its own honest path — the identity-dispute contract answers with neutral
    // machine context, and this gate must not pre-empt it.
    !missingModelManual && boundAndEmpty && !machineRequestRefused && asksAboutThisEquipment(message, oemModel!.value)
      ? `${oemManufacturer!.name} ${oemModel!.value}`
      : null;
  // #4075 — the automatic official-manual search for a CONFIRMED identity. Only
  // when the notebook's own bound model found nothing and this turn is about to
  // decline for lack of a manual. The chat never runs the search inline: it
  // starts it (the fallback for notebooks created before the create-time trigger)
  // and reports the recorded state honestly. Identity is the notebook's own
  // confirmed fields — never this message's free text.
  let manualAcquisition: { state: string; started_this_turn: boolean; candidate_host: string | null } | null = null;
  let acquisitionText: string | null = null;
  // #4160 S6 PRD R16-lite — the candidate-basis search's honest status line,
  // relayed through unconfirmedMachineDirective below (never a new SSE frame).
  let candidateAcquisitionText: string | null = null;
  // #4160 gate NO-GO (PRD "Never"): true while MIRA's own official-manual search
  // for this notebook is running, so a specificity fallback this turn says the
  // search is underway instead of telling the tech to fetch the manual.
  // "candidate" wins over "confirmed": its manual lands turned off, so the
  // fallback must also say to turn it on (Codex #4183 F1).
  let manualSearchRunning: "confirmed" | "candidate" | null = null;
  // Codex round 5 F15 (#4195) — the candidate search's own generation (the
  // DB's `started_at`, never this route's local clock), threaded onto the
  // LIVE `manual_search_status` SSE frame below so the shared mobile/Hub
  // follower can tell a genuinely NEW search apart from a replay of an old
  // one. Scoped to the candidate basis only, matching `manualSearchStatusFrame`.
  let candidateSearchStartedAt: string | undefined;
  if (
    (missingModelManual || noEvidenceForMachine) &&
    !oemRetrievalFailed &&
    nb &&
    oemManufacturer?.source === "notebook" &&
    oemModel?.source === "notebook" &&
    acquisitionEnabled()
  ) {
    const identity = {
      identityStatus: nb.identityStatus,
      manufacturer: nb.manufacturer,
      model: nb.model,
      catalogNumber: nb.catalogNumber,
    };
    const key = acquisitionKey(identity);
    if (key) {
      let acq = await readAcquisition(ctx.tenantId, notebookId);
      let started = false;
      // A matching "running" record also goes back through the atomic claim:
      // its stale-window predicate recovers a search orphaned by a restart,
      // and refuses (started=false) while a live search still holds it. A
      // "search_unavailable" record does too — the claim retries it once its
      // backoff has passed (Codex #4118 r7 F12).
      // A retryable record is reconciled FIRST: a manual its attempt attached
      // and the technician then removed is never re-fetched (Codex #4118 r14 F19).
      // "search_limit_reached" (#4160 S4) is retryable the same way: its claim
      // predicate only lets it through once a new UTC day has started
      // (#4168 Codex F1 — without this the promised next-day retry never ran).
      const retryable = (s: string) => s === "search_unavailable" || s === "search_limit_reached";
      if (acq && acq.key === key && retryable(acq.state)) {
        acq = await reconcileAcquisition(ctx.tenantId, notebookId, acq);
      }
      if (
        !acq ||
        acq.key !== key ||
        acq.state === "running" ||
        (retryable(acq.state) && !acq.source_removed)
      ) {
        started = await startManualAcquisition({
          tenantId: ctx.tenantId,
          userId: ctx.userId ?? null,
          notebookId,
          nodeId: nb.nodeId,
          identity,
          turnSpanContext: rootSpan.spanContext(),
        });
        if (started) {
          acq = {
            key,
            state: "running",
            started_at: new Date().toISOString(),
            finished_at: null,
            candidate_host: null,
            match_state: null,
            oem_request_url: null,
          };
        }
      }
      if (!started) acq = await reconcileAcquisition(ctx.tenantId, notebookId, acq);
      if (acq && acq.key === key) {
        manualAcquisition = { state: acq.state, started_this_turn: started, candidate_host: acq.candidate_host };
        acquisitionText = acquisitionDeclineText(acq, key, `${oemManufacturer.name} ${oemModel.value}`);
        if (acq.state === "running" && manualSearchRunning === null) manualSearchRunning = "confirmed";
      }
    }
  }
  // #4160 S6 — candidate-basis background acquisition (PRD R2). When a
  // candidate identity was proposed THIS turn (the RC1-fixed label read, or
  // the pre-existing #4120 corpus proposal above), start the SAME search the
  // eventual PATCH confirm would trigger — keyed EXACTLY as acquisitionKey()
  // would key the identity that bind writes (manufacturer, model = the
  // proposal's part, catalog empty) — so a second identical photo, or the
  // real confirm, reuse this search instead of starting a new one (claim()
  // idempotency, unchanged). `identity` below is a LOCAL object built only to
  // compute the matching key and feed discovery/applicability — nothing here
  // calls updateNotebook or writes any notebook identity column. The write
  // itself can never enable a source before confirmation (fenced in
  // notebook-manual-acquisition.ts, basis="candidate"); migration 104
  // promotes it once the technician confirms this SAME identity.
  // The trigger (decided above as candidateAcquisitionOwnsTurn): half 1, the
  // identity came from a label read — this turn's photo text yielded an
  // unambiguous part; half 2, the turn explicitly asks for the manual.
  if (candidateAcquisitionOwnsTurn && identityProposal && nb) {
    {
      const candidateIdentity = {
        identityStatus: "user_confirmed" as const,
        manufacturer: identityProposal.manufacturer,
        model: identityProposal.model,
        catalogNumber: "",
      };
      const candidateKey = acquisitionKey(candidateIdentity);
      if (candidateKey) {
        let cAcq = await readAcquisition(ctx.tenantId, notebookId);
        let cStarted = false;
        const retryableState = (s: string) => s === "search_unavailable" || s === "search_limit_reached";
        if (cAcq && cAcq.key === candidateKey && retryableState(cAcq.state)) {
          cAcq = await reconcileAcquisition(ctx.tenantId, notebookId, cAcq);
        }
        if (
          !cAcq ||
          cAcq.key !== candidateKey ||
          cAcq.state === "running" ||
          (retryableState(cAcq.state) && !cAcq.source_removed)
        ) {
          cStarted = await startManualAcquisition({
            tenantId: ctx.tenantId,
            userId: ctx.userId ?? null,
            notebookId,
            nodeId: nb.nodeId,
            identity: candidateIdentity,
            basis: "candidate",
            turnSpanContext: rootSpan.spanContext(),
          });
          if (cStarted) {
            cAcq = {
              key: candidateKey,
              state: "running",
              started_at: new Date().toISOString(),
              finished_at: null,
              candidate_host: null,
              match_state: null,
              oem_request_url: null,
            };
          }
        }
        if (!cStarted) cAcq = await reconcileAcquisition(ctx.tenantId, notebookId, cAcq);
        if (cAcq && cAcq.key === candidateKey) {
          if (cAcq.state === "running") manualSearchRunning = "candidate";
          candidateAcquisitionText = acquisitionDeclineText(
            cAcq,
            candidateKey,
            `${identityProposal.manufacturer} ${identityProposal.model}`,
            "candidate",
          );
          // Codex round 5 F15 (#4195): `cAcq.started_at` above is EITHER the
          // DB's own value (the initial `readAcquisition`/`reconcileAcquisition`
          // read, never synthesized) OR, when THIS call just claimed the
          // search, the local placeholder set a few lines up — which is NOT
          // the DB's `now()` (`claim()`'s own clock) and would drift from
          // what the GET route (`currentManualSearchStatus`) reports for the
          // SAME search. Only in that freshly-claimed case, re-read the
          // record `claim()` actually wrote; every other path already holds
          // an authoritative value. A failed/mismatched re-read just omits
          // `startedAt` from the frame (never invents one, never blocks the
          // reply — same fail-open posture as the rest of this capability).
          if (cStarted) {
            const authoritative = await readAcquisition(ctx.tenantId, notebookId);
            candidateSearchStartedAt =
              authoritative && authoritative.key === candidateKey ? authoritative.started_at ?? undefined : undefined;
          } else {
            candidateSearchStartedAt = cAcq.started_at ?? undefined;
          }
        }
      }
    }
  }
  // Codex r3 F5 (#4177, #4160 S7) — recovery must not depend on how this turn
  // is answered. The #4075 block above runs only when the OEM answer-route is
  // about to decline for lack of a manual, which a SOURCE-SELECTED turn never
  // reaches (notebook sources own it, oemManufacturer is null). After a
  // nameplate confirmation the nameplate source is enabled by default, so the
  // technician's normal next question is exactly that turn — and a recorded
  // limit denial / outage sat untouched unless every source was deselected.
  // So: a RETRYABLE record for the notebook's OWN confirmed identity is
  // reconciled and sent back through the claim here regardless of routing,
  // and (Codex r4 F6) a RUNNING record goes back through the claim too — its
  // stale-window predicate resumes a search orphaned by a restart or recorded
  // as running on concurrent indexing, and refuses while a live search holds
  // it (same as the #4075 block). The claim keeps every existing rule
  // (UTC-day boundary, 30-minute backoff, MAX_AUTOMATIC_RETRIES, live-running
  // refusal); reconcile keeps the source-removal rule. Nothing here starts a
  // NEW search, changes retrieval, or alters the reply — the turn stays
  // grounded in its selected sources; the packet records the recovery
  // (`manual_acquisition`) for the flight recorder.
  if (manualAcquisition === null && nb && acquisitionEnabled()) {
    const identity = {
      identityStatus: nb.identityStatus,
      manufacturer: nb.manufacturer,
      model: nb.model,
      catalogNumber: nb.catalogNumber,
    };
    const key = acquisitionKey(identity);
    if (key) {
      let acq = await readAcquisition(ctx.tenantId, notebookId);
      const retryable = acq !== null && (acq.state === "search_unavailable" || acq.state === "search_limit_reached");
      if (acq && acq.key === key && (retryable || acq.state === "running")) {
        if (retryable) acq = await reconcileAcquisition(ctx.tenantId, notebookId, acq);
        if (acq && acq.key === key && !acq.source_removed) {
          const started = await startManualAcquisition({
            tenantId: ctx.tenantId,
            userId: ctx.userId ?? null,
            notebookId,
            nodeId: nb.nodeId,
            identity,
            turnSpanContext: rootSpan.spanContext(),
          });
          manualAcquisition = started
            ? { state: "running", started_this_turn: true, candidate_host: null }
            : { state: acq.state, started_this_turn: false, candidate_host: acq.candidate_host };
        }
      }
    }
  }
  // Covers the S7 recovery block above too (a source-selected turn that
  // re-started or found a still-running search).
  if (manualAcquisition?.state === "running" && manualSearchRunning === null) manualSearchRunning = "confirmed";
  rec.stage("retrieval", {
    manual_acquisition: manualAcquisition,
    photo_part_manual_lookup: photoPartLookup
      ? {
          action: photoPartLookup.action,
          searched: photoPartLookup.searched,
          part_number_sha256: photoPartLookup.part_number
            ? createHash("sha256").update(photoPartLookup.part_number).digest("hex")
            : null,
          found: photoPartLookup.found,
          candidate_host: photoPartLookup.candidate_host,
        }
      : null,
  });
  // #4128 — a credential or firmware-recovery question about THIS equipment in
  // a chat where nothing identifies the equipment: no sources, no notebook or
  // photo identity, no proposal (a named machine keeps #4095's proposal path).
  // Generic steps for an unknown device are guesses; the #4094 detector picks
  // the kinds, and a teaching question never matches asksAboutThisEquipment.
  const unidentifiedServiceText =
    !notebookRetrieval && oemManufacturer === null && oemModel === null && identityProposal === null &&
    !groundedMachineEntry && !machineRequestRefused && asksAboutThisEquipment(message, null)
      ? unidentifiedServiceDecline(message)
      : null;

  // F004 contract v2: the inputs every grounding-status build shares. Read at
  // call time (oemRetrievalFailed is settled by then); ids and counts only.
  const groundingBase = (): Pick<
    GroundingStatusInputs,
    "general" | "retrievalAttempted" | "retrievalUnavailable" | "scopeDocIds" | "passages" | "notebookBound" | "fallbackOf"
  > => ({
    general,
    retrievalAttempted: notebookRetrieval || oemRetrieval,
    retrievalUnavailable: oemRetrievalFailed,
    scopeDocIds: docIds,
    passages: chunks,
    notebookBound: boundAsset.state === "resolved",
    fallbackOf,
  });

  // A flagged hazard turn is never swallowed by this abstain (owner decision
  // 2026-09-27): with no documents it takes the general lane, so the tech gets
  // the hazard banner and an answer instead of "couldn't find that".
  if (chunks.length === 0 && (!general || missingModelManual || noEvidenceForMachine || unidentifiedServiceText || photoPartLookup || photoPartCompatibilityText) && !groundedMachineEntry && !safetyTrigger) {
    // Gate G — abstain honestly, persist the turn, never call the provider.
    // #4015: "couldn't find that in the documentation I have", not "I don't have
    // the manual" — a zero-hit scoped search does not prove the manual is absent
    // (staging holds 11 GS10 rows; a carrier-frequency query still hit none).
    const abstainAnswerText = oemRetrievalFailed && (missingModelManual || noEvidenceForMachine)
      ? `I couldn't reach the manual library just now, so I won't guess at an answer for your ${(missingModelManual ?? noEvidenceForMachine)!}. Please try again in a moment.`
      : unidentifiedServiceText
      ? unidentifiedServiceText
      : photoPartLookup
      ? photoPartLookup.message
      : photoPartCompatibilityText
      ? photoPartCompatibilityText
      : (missingModelManual || noEvidenceForMachine) && declineKind(message)
      ? declineText(declineKind(message)!, (missingModelManual ?? noEvidenceForMachine)!, oemManufacturer!.name)
      : acquisitionText
      ? acquisitionText
      // Codex r1 F1 (#4172, HIGH) — a candidate acquisition's honest status
      // (never "I haven't searched": the search either started or already
      // reported a result) outranks a generic "couldn't find" fallback.
      : candidateAcquisitionText
      ? candidateAcquisitionText
      : missingModelManual
      ? `I couldn't find that in the ${missingModelManual} manual pages I have, so I won't guess a documented value. Upload the manual (or the page that covers it) to this notebook, or photograph the nameplate, and ask again — I'll answer from it and show you the page.`
      : noEvidenceForMachine
        ? `I couldn't find anything about this in the ${noEvidenceForMachine} manuals I have${oemEquipmentType && oemEquipmentType !== "Other" ? ", or in related manuals from the same maker" : ""}, so I won't guess at a procedure for your machine. Upload the manual for the equipment this is about (or the page that covers it) to this notebook, or photograph the nameplate, and ask again — I'll answer from it and show you the page.`
      : visualEntry
        ? "I saw your photo, but I couldn't find anything about it in the selected sources."
        : null;
    const gateAnswerGateSpan = tracer.startSpan("answer_gate.evaluate", undefined, rootCtx);
    lifecycleOutcome = "abstained";
    rec.stage("answer_gate", {
      invoked: true,
      decision: "insufficient_evidence",
      reason: oemRetrievalFailed && (missingModelManual || noEvidenceForMachine) ? "identity_bound_retrieval_failed" : unidentifiedServiceText ? "unidentified_service_decline" : missingModelManual ? "identity_bound_no_manual" : noEvidenceForMachine ? "identity_bound_no_evidence" : "gate_g_no_evidence",
      answer_chars: abstainAnswerText?.length ?? 0,
      refusal_phrase_matched: false,
      evidence_phrase_matched: false,
      safety_classification: "none",
      evidence_sufficient: false,
      ungrounded_unit_claim: false,
    });
    setSpanAttrs(
      {
        "mira.answer_gate.invoked": true,
        "mira.answer_gate.decision": "insufficient_evidence",
        "mira.answer_gate.reason": oemRetrievalFailed && (missingModelManual || noEvidenceForMachine) ? "identity_bound_retrieval_failed" : unidentifiedServiceText ? "unidentified_service_decline" : missingModelManual ? "identity_bound_no_manual" : noEvidenceForMachine ? "identity_bound_no_evidence" : "gate_g_no_evidence",
        "mira.answer_gate.answer_chars": abstainAnswerText?.length ?? 0,
      },
      gateAnswerGateSpan,
    );
    gateAnswerGateSpan.end();
    // F004 contract v2: no provider was called; record why (retrieval status
    // kept separate from citation status, which is not applicable here).
    const gateGrounding = groundingOn
      ? buildGroundingStatus({
          ...groundingBase(),
          modelCalled: false,
          served: false,
          refused: false,
          stopped: false,
          terminalSafetyStop: false,
          emittedCitations: [],
          unresolvedMarkerCount: 0,
        })
      : null;
    const gatePersistSpan = startStage("turn.persist");
    const gateTurnRowId = await releaseClaimOnFailure(() => recordTurn(ctx.tenantId, notebookId, {
      // 086: the owner is the authenticated technician (session), never the body.
      ownerUserId: ctx.userId,
      threadId,
      clientRequestId,
      claimToken: requestClaimToken,
      question: message,
      answerStatus: "insufficient_evidence",
      answerText: abstainAnswerText,
      enabledSourceDocIds: docIds,
      // #3788: the verified photo is part of the record of this refusal, so a
      // history read renders the same card the live turn showed.
      evidence: [
        ...disputeEntries,
        ...(visualEntry ? [visualEntry] : []),
        // #4150 — the pending proposal is what a confirmation is checked against.
        ...(photoPartLookup?.proposal ? [photoPartLookup.proposal] : []),
        // Codex r1 F1 (#4172, HIGH) — the identity_proposal entry is what the
        // client's later confirm/reject PATCH is checked against, and what a
        // history reload needs to render the same proposal the live turn
        // carried (once a client renders it — #4095). Persisted on EVERY reply
        // path, abstention included.
        ...proposalEntries,
        ...(gateGrounding ? [gateGrounding] : []),
      ],
      model: null,
      // An abstain about a specific machine is still a record about that
      // machine — omitting the snapshot here would make "what has MIRA been
      // asked about this conveyor" silently under-count refusals.
      ...assetSnapshot,
    }));
    const gateUsage: TurnUsage = {
      provider: null,
      model: null,
      routeReason: "legacy_cascade",
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      costUsdEstimate: null,
      status: "empty",
      attempted: [],
    };
    await finishAndPersist(gateTurnRowId, gateUsage, {
      answerText: abstainAnswerText,
      citationsPresent: false,
      latencyMs: null,
    });
    setSpanAttrs({ "mira.persist.outcome": "ok", "mira.turn.row_id": gateTurnRowId }, gatePersistSpan);
    endTimed(gatePersistSpan, "persist");
    endRoot();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (rootTraceId) {
          const traceFrame: NotebookTraceFrame = { kind: "trace", traceId: rootTraceId, turnId };
          controller.enqueue(enc.encode(sse(traceFrame)));
        }
        const sources: NotebookSourcesFrame = {
          kind: "sources",
          citations: [],
          sourceSnapshot: docIds,
        };
        const status: NotebookStatusFrame = {
          kind: "status",
          status: "insufficient_evidence",
          message: abstainAnswerText ?? "I couldn't find that in the selected sources.",
        };
        if (identityDisputed) controller.enqueue(enc.encode(sse(IDENTITY_DISPUTE_FRAME)));
        controller.enqueue(enc.encode(sse(sources)));
        // #3788: the verified photo rides the abstain as a basis-less evidence
        // MARKER frame — the same grammar as `IDENTITY_DISPUTE_FRAME` (readers
        // treat `basis`/`label` as absent). No basis is claimed because nothing
        // grounded an answer; the frame only says "this photo was verified for
        // this turn", which is exactly what the persisted `evidence[]` says.
        if (visualEntry) {
          controller.enqueue(enc.encode(sse(visualEvidenceMarker(visualEntry))));
        }
        if (showGrounding && gateGrounding) controller.enqueue(enc.encode(sse(gateGrounding)));
        controller.enqueue(enc.encode(sse(status)));
        // Codex r1 F1 (#4172, HIGH) — emitted whatever the answer status
        // (mirrors the answered path below): the client offers "Use its
        // manuals" / "Not this" on an abstained turn too, not only an
        // answered one.
        if (identityProposal) {
          const proposalFrame: NotebookIdentityProposalFrame = { kind: "identity_proposal", ...identityProposal };
          controller.enqueue(enc.encode(sse(proposalFrame)));
        }
        // T2 (#4189) — see manualSearchStatusFrame's own header. Transient only.
        const searchStatusFrame = manualSearchStatusFrame(identityProposal, manualSearchRunning, candidateAcquisitionText, candidateSearchStartedAt);
        if (searchStatusFrame) controller.enqueue(enc.encode(sse(searchStatusFrame)));
        if (photoPartLookup?.proposal) {
          const chips: NotebookFollowupsFrame = {
            kind: "followups",
            suggestions: [partSearchConfirmation(photoPartLookup.proposal.candidate), PART_SEARCH_CANCEL],
          };
          controller.enqueue(enc.encode(sse(chips)));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...(rootTraceId ? { "x-mira-trace-id": rootTraceId } : {}),
      },
    });
  }

  const citations = await releaseClaimOnFailure(() =>
    buildCitations(ctx.tenantId, notebookId, chunks, message),
  );

  // Approved-context gate — for MACHINE evidence only (D3). Mirrors the asset
  // chat route's summary: live real signals count as approved context; the
  // notebook's validated (user_confirmed/verified) sources are its approved
  // documents. Verified kg relationships are not counted on this route (the
  // asset route's inline SQL is not extracted; 0 is the conservative value).
  // Turns WITHOUT machine evidence never reach this gate, so document
  // retrieval behaviour is byte-identical to before.
  //
  // `approvedMachineEvidenceCount` is the fourth counter (approved-context.ts):
  // a REPLAYED window is never live, so `approvedLiveSignalCount` is 0 for it —
  // on prod, where MIRA_ENFORCE_APPROVED_RETRIEVAL=true, every replay of a
  // notebook without retrieved chunks was refusing 412. Recorded observations
  // the SERVER re-fetched from its own tenant-scoped tables are approved
  // context; that is what "the server re-derives" means. The gate keeps its
  // teeth: it now runs for ANY turn that asked for machine grounding, so a
  // window that came back empty or unavailable with no approved documents
  // still refuses.
  if (machineRequest && approvedAskEnforcementEnabled()) {
    const approvedSummary = {
      approvedSourceCount: new Set(chunks.map((c) => c.docId).filter(Boolean)).size,
      verifiedRelationshipCount: 0,
      approvedLiveSignalCount: machinePacket ? machinePacket.freshness.live : 0,
      approvedMachineEvidenceCount: groundedMachineEntry ? groundedMachineEntry.rowCount : 0,
    };
    if (!approvedContextReady(approvedSummary)) {
      const refusal = buildApprovedContextRefusal(approvedSummary);
      // `error` is a sentence (mira-mobile renders it verbatim); `code` is the
      // discriminator.
      await abandonRequestClaim();
      endRoot();
      const flaggedReason = withSafetyFlag(refusal.reason, safetyTrigger);
      return NextResponse.json(
        { error: flaggedReason, code: "approved_context", ...refusal, reason: flaggedReason },
        { status: 412, headers: safetyFlagHeaders(safetyTrigger) },
      );
    }
  }
  const machineSection = machinePacket
    ? renderMachineEvidenceSection(machinePacket, sanitizeMachineMemoryField)
    : "";

  // Slice 1 (owner decision B): the machine's PHOTOGRAPHED nameplate evidence,
  // retrieved by the notebook's SERVER-bound asset id (never a label/tag/client
  // id → a stale display name cannot change retrieval, and one machine's photos
  // cannot surface under another). Loads only for a bound, non-disputed notebook
  // — unbound or disputed → nothing (owner: "if no equipment is explicitly
  // bound, return no visual evidence"). Own try/catch: a ledger read failure
  // never drops the document/machine context already built.
  let visualSection = "";
  if (boundAsset.state === "resolved" && !identityDisputed) {
    try {
      const visualRows = await withTenantContext(ctx.tenantId, (c) =>
        loadVisualEvidenceForAsset(c, ctx.tenantId, boundAsset.entityId),
      );
      visualSection = renderVisualEvidenceSection(visualRows);
    } catch (err) {
      console.error(
        `[notebook-chat] visual evidence load failed code=${(err as { code?: string }).code ?? "?"} ` +
          "(continuing without it):",
        err,
      );
    }
  }

  // #3788 — the LOOK observation for the photo attached THIS turn. Keyed ONLY on
  // the SERVER-VERIFIED file id (`visualEntry.fileId`, already checked by
  // `photoLinkedToTarget` in verifyVisualEntry), so a client string can never
  // reach it and it works on an UNBOUND notebook (keyed by file id, not asset).
  // It rides in the injection-hardened user-data channel (buildManualUserContent
  // below), NEVER the system prompt. Fail-open: a load failure must not drop the
  // turn. No stored observation → "" → no block, the turn still answers.
  const lookContext = [renderLookObservationSection(lookRow), renderPriorLookObservationsSection(priorLookRows)]
    .filter(Boolean)
    .join("\n\n");
  // Correction to `evidence.materialize`'s earlier default: the LOOK
  // observation, when present, DOES reach the prompt (buildManualUserContent
  // below carries `lookContext`) — `observation_available`/`observation_in_context`
  // must reflect that, not the design table's placeholder `false`, or
  // VISUAL_EVIDENCE_DROPPED fires on every healthy photo turn (false positive
  // on the flagship anomaly).
  rec.stage("visual_evidence", {
    observation_available: Boolean(lookRow?.text?.trim()) || priorLookRows.length > 0,
    observation_in_context: lookContext.length > 0,
    prior_turn_observation_count: priorLookRows.length,
    prior_file_ids: priorLookFileIds,
  });

  // Machine-context header — gives the model the equipment identity and the
  // documents actually loaded, so "what do you know about the machine?" answers
  // from notebook facts (identity + coverage) instead of the first excerpt, and
  // so it can flag when the loaded doc only partially covers a question.
  // (`nb`/`srcs` are loaded above, before retrieval — the OEM routing decision
  // needs the notebook's manufacturer/model.)
  // `nb` (manufacturer/model) is only known here — a second tenant-scoped
  // query — so identity.resolve's packet fields AND its still-open span get
  // the real flags now, and the span ends. A second `.stage()` merges safely.
  rec.stage("identity", {
    manufacturer_present: Boolean(nb?.manufacturer),
    model_present: Boolean(nb?.model),
    proposal: identityProposal
      ? {
          manufacturer: identityProposal.manufacturer,
          model_sha256: createHash("sha256").update(identityProposal.model.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex"),
        }
      : null,
  });
  setSpanAttrs(
    {
      "mira.identity.manufacturer_present": Boolean(nb?.manufacturer),
      "mira.identity.model_present": Boolean(nb?.model),
    },
    identityResolveSpan,
  );
  endTimed(identityResolveSpan, "identity");
  openChildren.delete(identityResolveSpan);
  const identity = identityDisputed
    ? "identity DISPUTED for this question (the notebook's bound machine is withheld)"
    : [nb?.manufacturer, nb?.model].filter(Boolean).join(" ") || "an unspecified machine";
  // A bound asset is a stronger identity claim than free-text manufacturer/model,
  // so it is stated explicitly. Until a human confirms it, it is marked SELECTED:
  // a QR scan proves which sticker was scanned, not which machine wears it, and
  // the model must never present a scan as a confirmed identity.
  const assetLine = identityDisputed
    ? " Asset identity DISPUTED for this question: the technician's device reports a different machine than this notebook is bound to. Treat the identity as unconfirmed — do NOT state any machine-specific fact as confirmed for this machine; say the identity must be re-selected before machine-specific guidance."
    : boundAsset.state === "resolved"
      ? " Asset: " +
        (boundAsset.name || "(unnamed)") +
        " — canonical path " +
        boundAsset.unsPath +
        ". " +
        (boundAsset.confirmedAt
          ? "Identity CONFIRMED by a technician."
          : "Identity SELECTED but NOT yet confirmed — if the answer depends on which machine this is, say the identity is unconfirmed.")
      : "";
  const loadedDocs = srcs.map((s) => s.filename).filter(Boolean).join(", ") || "none";
  // #4099: the block is emitted only when it states a fact — a known identity,
  // a bound asset, loaded documents, or a disputed identity. On a blank chat it
  // said only "an unspecified machine", "none" and a quick-start note that
  // applies to no document, and that noise measurably broke answers: on
  // gpt-oss-120b (Groq, the served model/params) the Q9 option letter
  // contradicted its own correct explanation in 11 of 24 samples with the
  // block vs 0 of 24 without; the ablation isolated the "Equipment: an
  // unspecified machine" line. The general prompt already says no manual is
  // loaded, so nothing is lost.
  const machineHasFacts =
    identityDisputed || Boolean(nb?.manufacturer || nb?.model) || boundAsset.state === "resolved" || srcs.length > 0;
  const machineContext = !machineHasFacts
    ? ""
    : `\n\nMACHINE CONTEXT (facts about this notebook, not retrieved excerpts):\n` +
    `- Equipment: ${identity}${nb?.displayName && !identityDisputed ? ` — "${nb.displayName}"` : ""}.${assetLine}\n` +
    `- Loaded source documents: ${loadedDocs}.\n` +
    `- Coverage note: a quick-start guide does not replace the full user manual; if a question needs detail the loaded docs lack, say so and point to the full user manual.`;

  // Coverage planning (answer completeness): the answer SHAPE determines how
  // much evidence the answer owes. Family questions get an explicit EVIDENCE
  // MAP (facet → the pages whose excerpts prove it) plus a cover-or-declare-gap
  // contract; generic enumerations keep the enumerate-everything directive;
  // impossible exhaustives get an honest-scope contract.
  const plan = classifyCoverage(message);
  let coverageDirective = "";
  if ((plan.shape === "multi_facet" || plan.shape === "exhaustive") && plan.facets.length) {
    const evidence = facetEvidencePages(chunks, plan.facets);
    const proven = [...evidence].filter(([, pages]) => pages.length);
    const gaps = [...evidence].filter(([, pages]) => !pages.length).map(([f]) => f);
    coverageDirective =
      `\n\nREQUIRED COVERAGE — this is a ${plan.shape === "exhaustive" ? "complete-enumeration" : "multi-facet"} question. ` +
      `The excerpts contain evidence for these distinct options/aspects: ` +
      proven.map(([f, pages]) => `${f} (excerpts from p.${pages.join(", p.")})`).join("; ") +
      `. Your answer MUST name each of these, each with its own citation — do not stop after the first. ` +
      `Never list an option the excerpts do not prove.` +
      (gaps.length
        ? ` No excerpt covers: ${gaps.join(", ")} — do NOT invent these; omit them or say the loaded excerpts don't cover them.`
        : "");
  } else if (plan.shape === "exhaustive") {
    coverageDirective =
      `\n\nEXHAUSTIVE-LIST QUESTION — the technician asked for a complete enumeration that the excerpts cannot fully provide. ` +
      `Do NOT pretend completeness and do NOT dump a partial list as if it were the whole. Instead: say plainly that the full ` +
      `enumeration is beyond the loaded excerpts, then describe the manual's own STRUCTURE for it from the excerpts (e.g. the ` +
      `parameter GROUPS and where the full list lives). This structural description IS a grounded answer, not a refusal — ` +
      `every structural claim MUST carry an inline [n] citation to the excerpt that shows it.`;
  } else if (classifyBroad(message).broad) {
    coverageDirective = `\n\nBROAD / ENUMERATION QUESTION — the technician asked what options/methods/protections exist. Answer as a short list that names EVERY distinct one the excerpts prove — both embedded/built-in AND optional — each with its own citation. Do NOT stop after the first method; if different excerpts describe different methods, include them all. Never list an option the excerpts do not prove. After the list, offer the natural next step (e.g. "want the setup steps for one of these?").`;
  }
  // Machine evidence rides after the base prompt and BEFORE appendManualContext
  // — the exact order the asset chat route uses. With no machine evidence the
  // string is byte-identical to before.
  // #4068: excerpts from the same-manufacturer fallback belong to a SIBLING
  // model (each excerpt header names it). Say so, and never present a sibling
  // model's value as this machine's own specification.
  const fallbackSources = [
    ...new Set(
      chunks
        .filter((c) => c.retrievalScope === "vendor_fallback")
        .map((c) => [c.manufacturer, c.modelNumber].filter(Boolean).join(" "))
        .filter(Boolean),
    ),
  ];
  const relatedManualWarning =
    oemModel && fallbackSources.length > 0
      // Codex #4069 pass 11 F2: this text streams (gate off) before the answer's
      // refusal status is known, so it states what was FOUND, never that the
      // answer used it — true whether the model then answers or refuses.
      ? `⚠️ No page of the ${oemManufacturer?.name ?? ""} ${oemModel.value} manual matched this question. The closest match is a related manual (${fallbackSources.join(", ")}). ` +
        `Anything taken from it may differ on your ${oemModel.value} — confirm them in your ${oemModel.value} manual before you act.`
      : null;
  const vendorFallbackDirective =
    oemModel && chunks.some((c) => c.retrievalScope === "vendor_fallback")
      ? `\n\nRELATED-MANUAL EXCERPTS — no page of the ${oemManufacturer?.name ?? ""} ${oemModel.value} manual matched this question; ` +
        `these excerpts come from related ${oemManufacturer?.name ?? "same-manufacturer"} manuals named in each excerpt header. ` +
        `Say that the source is a related manual when you cite it. Use them only for behaviour and protocols the models share. ` +
        `Do NOT present a value from them (rating, parameter, address, setting) as the ${oemModel.value}'s own specification, and do NOT ` +
        `present a step-by-step procedure from them (reset, wiring, firmware, parameter steps) as the ${oemModel.value}'s procedure — ` +
        `describe it as how the related model does it and tell the technician to confirm the steps in the ${oemModel.value} manual.`
      : "";
  const basePrompt = docGrounded ? BASE_SYSTEM_PROMPT : GENERAL_SYSTEM_PROMPT;
  // #3763: hazard-intent turns carry the NFPA 70E directive in BOTH modes; with
  // no hazard the string is byte-identical to before.
  const withHazard = electricalHazardDirective
    ? `${basePrompt}\n\n${ELECTRICAL_HAZARD_DIRECTIVE}`
    : safetyTrigger
      ? `${basePrompt}\n\n${safetyFlagDirective(safetyTrigger)}`
      : basePrompt;
  const withMachine = machineSection ? `${withHazard}\n\n${machineSection}` : withHazard;
  // Visual (photographed nameplate) evidence rides after machine evidence; with
  // none the string is byte-identical to before.
  const withVisual = visualSection ? `${withMachine}\n\n${visualSection}` : withMachine;
  // #4131: a label data identifier ("1P <order no.>") in this turn's photo
  // context gets its standard meaning stated; otherwise byte-identical.
  // #4133: a retail/warehouse code (FNSKU) in the photo context is named as
  // not-a-part-number; otherwise byte-identical.
  // #4143: a photo in context gets the "quote the label text" note — inside the
  // #4131/#4133 label notes, which stay last.
  const systemPrompt = withRetailCodeNote(withLabelDataIdentifiers(withPhotoProvenance(withStepSafety(withAnswerLanguage(
    docGrounded
      ? appendManualContext(withVisual, chunks) + machineContext + coverageDirective + vendorFallbackDirective
      : withVisual + machineContext + (identityProposal ? unconfirmedMachineDirective(identityProposal, candidateAcquisitionText) : ""),
 )), lookContext), lookContext), lookContext);
  // appendManualContext only appends the grounding RULES — the excerpts
  // themselves ride in the user message (injection-hardened data channel),
  // same as the asset-chat and node-chat routes. Conversation history rides
  // between the system prompt and the current (evidence-bearing) turn so the
  // model has thread memory without diluting the live grounding.
  // Referential follow-ups get a deterministic topic note (transcript tokens
  // only) riding IN the user turn next to the question — an end-of-system-prompt
  // hint measurably failed to stop "what's the maximum?" in a decel thread from
  // resolving to the lexically similar P044 [Maximum Freq] row (battery defect D).
  const topicHint = buildTopicHint(message, history);
  const messages = buildProviderMessages(
    systemPrompt,
    history,
    buildManualUserContent(topicHint ? `${message}\n\n${topicHint}` : message, chunks, lookContext),
  );
  {
    const contextSpan = startStage("context.assemble");
    // Same identity rule as retrieval.returned_doc_ids: doc id for notebook
    // chunks, source_url#page for shared-OEM chunks (which carry no doc id) —
    // so "what reached the model" is never empty when chunks did.
    const evidenceDocIds = [
      ...new Set(
        chunks
          .map((c) => c.docId || (c.sourceUrl ? `${c.sourceUrl}#p${c.sourcePage ?? "?"}` : null))
          .filter((d): d is string => Boolean(d)),
      ),
    ];
    const visualEvidenceCount = (lookRow?.text?.trim() ? 1 : 0) + priorLookRows.length + (visualSection ? 1 : 0);
    const identityIncluded = boundAsset.state === "resolved" || identityDisputed;
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const systemPromptKind = !docGrounded ? "general" : groundedMachineEntry ? "machine" : "grounded";
    rec.stage("context", {
      evidence_doc_ids: evidenceDocIds,
      chunk_count: chunks.length,
      visual_evidence_count: visualEvidenceCount,
      identity_included: identityIncluded,
      history_turns: history.length,
      prompt_chars: promptChars,
      system_prompt_kind: !docGrounded ? "general" : groundedMachineEntry ? "machine" : "grounded",
    });
    setSpanAttrs(
      {
        "mira.context.evidence_doc_ids": evidenceDocIds.slice(0, 32),
        "mira.context.chunk_count": chunks.length,
        "mira.context.visual_evidence_count": visualEvidenceCount,
        "mira.context.identity_included": identityIncluded,
        "mira.context.history_turns": history.length,
        "mira.context.prompt_chars": promptChars,
        "mira.context.system_prompt_kind": systemPromptKind,
      },
      contextSpan,
    );
    endTimed(contextSpan, "context");
  }

  // SHADOW (MIRA_JEV_SHADOW=1, off by default): a calibrated relevance
  // judgment over (question, retrieved chunks), started here so it overlaps
  // generation and adds no first-token latency; awaited only when the packet's
  // answer_gate stage is written, after the stream. Fail-open, bounded by its
  // own timeout, and NEVER consulted by the gate — it is recorded beside
  // `evidence_sufficient` so the two can be compared on staging traffic.
  const jevShadow: Promise<JevShadowResult> = judgeEvidenceSufficiencyShadow(
    message,
    chunks.map((c) => ({ content: c.content, title: c.title })),
  ).catch(() => ({
    noul: null,
    skipped_reason: "error",
    latency_ms: null,
    model: null,
    input_tokens: null,
    instructions_version: "unknown",
  }));

  // STRM-2 (client stop). Two ways the technician can vanish mid-answer —
  // the request signal (client aborted the fetch / socket closed) and the
  // response stream being cancelled by the runtime — both fold into ONE
  // signal. `abortedRead` is a handled-rejection sentinel raced against the
  // provider read so a stalled upstream cannot keep a stopped turn alive; it
  // is created once and never awaited on its own, so it can't leak as an
  // unhandled rejection.
  const clientAbort = new AbortController();
  const onClientGone = () => {
    // The technician closed the app / lost signal. Classify it before the
    // abort unwinds, so the ledger says `cancelled` rather than the `error`
    // an unclassified exit would default to.
    lifecycleOutcome = "cancelled";
    clientAbort.abort();
  };
  req.signal?.addEventListener("abort", onClientGone, { once: true });
  const abortedRead = new Promise<never>((_, reject) =>
    clientAbort.signal.addEventListener(
      "abort",
      () => reject(new DOMException("client stopped generation", "AbortError")),
      { once: true },
    ),
  );
  abortedRead.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      clientAbort.abort();
    },
    async start(controller) {
      try {
      // Turn Flight Recorder correlation frame — FIRST, additive, only when a
      // real trace id exists (see file header + notebook-chat-types.ts).
      if (rootTraceId) {
        const traceFrame: NotebookTraceFrame = { kind: "trace", traceId: rootTraceId, turnId };
        controller.enqueue(enc.encode(sse(traceFrame)));
      }
      // 086 §3: the dispute marker goes out before the first content byte, so
      // a Stop mid-answer (persisted WITH the dispute) has already shown it.
      if (identityDisputed) controller.enqueue(enc.encode(sse(IDENTITY_DISPUTE_FRAME)));
      // Citations are emitted AFTER generation, filtered to what the answer
      // actually cited — so a refusal ships no pages and a grounded answer ships
      // only its supporting evidence (no retrieved-but-unused pages as proof).
      const responseBuffer: string[] = [];
      const normalize = makeCitationNormalizer();
      // Only used in general mode; constructing it unconditionally keeps the
      // grounded delta path byte-identical to before.
      const stripBrackets = makeGeneralBracketStripper();
      // B2: with the gate on, candidate deltas accumulate in responseBuffer
      // and are NOT enqueued — the full answer is validated first, then the
      // accepted text is released through the same frame grammar. The client
      // keeps its existing "working" state until the first content frame.
      const gate = answerGateEnabled();
      // #4068: with the gate off, content streams live — the related-manual
      // warning goes out as the first content, before any model text.
      let relatedWarningStreamed = false;
      let served = false;
      let servedModel: string | null = null;
      let internalError: unknown = null;

      // ONE cascade definition per turn. Flag off => byte-identical legacy list.
      const seam = canonicalSeamEnabled();
      const cascadeProviders = seam ? canonicalProviders() : providers();
      const outputCap = maxOutputTokens();
      const attempted: string[] = [];
      let turnUsage: TurnUsage | null = null;
      // Held so persistence runs AFTER the stream is closed — the ledger
      // write must never delay a byte of the technician's answer.
      let pendingUsage: TurnUsage | null = null;
      // Wall time for the whole turn (decision_traces.latency_ms).
      const turnStartedAt = Date.now();
      let rawUsage: unknown = null;
      let capped = false;
      // The provider whose stream was open when the client stopped — the
      // partial turn is recorded against it, and its upstream read is
      // cancelled so a stopped answer costs no further tokens.
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let activeProvider: { name: string; model: string } | null = null;
      // Per-attempt `chat <model>` span (design §3). Manual span management,
      // not `withSpan`: the labeled `break cascade`/`continue` statements pass
      // through a `finally` on the SAME try/catch fine, but cannot cross into
      // a nested callback function the way `withSpan` would require.
      let genSpan: Span | null = null;
      let genOutcome: "served" | "http_error" | "exception" | "client_stop" = "exception";
      let genResponseId: string | null = null;
      let genAttemptIndex = 0;

      cascade: for (const provider of cascadeProviders) {
        if (!provider.key) continue;
        // STRM-2: a stopped turn must never open a second provider stream.
        // The catch block below breaks on abort, but the two NON-throwing
        // `continue` paths (non-OK / empty-body response, empty responseBuffer)
        // also land here — checking once at the top of the loop covers all of
        // them (e.g. Groq 429 arriving after the technician tapped Stop).
        if (clientAbort.signal.aborted) break cascade;
        genSpan = startStage(`chat ${provider.model}`);
        genOutcome = "exception";
        genResponseId = null;
        const genAttemptStartedAt = Date.now();
        try {
          const res = await fetch(provider.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.key}`,
            },
            // A broad/enumeration answer legitimately needs more room; a narrow
            // answer stays tight. On gpt-oss the model's hidden reasoning also
            // draws from the completion budget, which was truncating broad
            // answers mid-list — hence reasoning_effort:low on Groq (frees the
            // budget for the visible answer; see the gpt-oss Groq migration
            // trap) plus the larger broad cap.
            body: JSON.stringify(
              seam
                ? buildRequestBody(
                    provider as never,
                    messages,
                    Math.min(coverageDirective ? 1400 : 800, outputCap),
                  )
                : {
                    model: provider.model,
                    messages,
                    stream: true,
                    max_tokens: coverageDirective ? 1400 : 800,
                    temperature: 0.3,
                    ...(provider.name === "Groq"
                      ? { reasoning_effort: process.env.GROQ_REASONING_EFFORT ?? "low" }
                      : {}),
                  },
            ),
            // The client-stop signal is composed with the timeout so a stop
            // during the connect phase aborts the upstream request instead
            // of waiting on the provider to answer first.
            signal: composeTimeout(clientAbort.signal, 30_000),
          });
          if (!res.ok || !res.body) {
            // Record the attempt BEFORE continuing: an HTTP-level rejection is
            // a fallback just as much as a thrown error, and skipping it here
            // made a Cerebras-served turn report routeReason 'primary'.
            if (seam) attempted.push(provider.name);
            genOutcome = "http_error";
            continue;
          }
          const reader = res.body.getReader();
          activeReader = reader;
          activeProvider = { name: provider.name, model: provider.model };
          const dec = new TextDecoder();
          let buffer = "";
          let finished = false;
          while (!finished) {
            // Race the upstream read against the client-stop signal: a stop
            // must interrupt a read that is waiting on a slow provider, not
            // wait for the next delta to notice it.
            const { done, value } = await Promise.race([reader.read(), abortedRead]);
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") {
                finished = true;
                break;
              }
              try {
                const parsed = JSON.parse(data) as {
                  id?: string;
                  choices?: { delta?: { content?: string }; finish_reason?: string }[];
                  usage?: unknown;
                };
                // include_usage delivers the usage block on a FINAL chunk that
                // carries no choices — capture it whenever present rather than
                // only at finish_reason, or it is missed on some providers.
                if (parsed.usage) rawUsage = parsed.usage;
                if (parsed.id && !genResponseId) genResponseId = parsed.id;
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  const norm = !docGrounded ? stripBrackets.push(normalize.push(delta)) : normalize.push(delta);
                  if (norm) {
                    responseBuffer.push(norm);
                    // B2: under the gate the candidate is buffered, not shown.
                    if (!gate) {
                      if (relatedManualWarning && !relatedWarningStreamed) {
                        relatedWarningStreamed = true;
                        controller.enqueue(
                          enc.encode(sse({ kind: "content", content: `${relatedManualWarning}\n\n` } as NotebookContentFrame)),
                        );
                      }
                      const frame: NotebookContentFrame = { kind: "content", content: norm };
                      controller.enqueue(enc.encode(sse(frame)));
                    }
                  }
                  // Cost cap. Chars/4 is a deliberately cheap proxy: a real
                  // tokenizer here would cost more than the tokens it guards,
                  // and the cap exists to stop a RUNAWAY turn, not to bill.
                  if (seam && responseBuffer.join("").length / 4 > outputCap) {
                    capped = true;
                    finished = true;
                    break;
                  }
                }
                if (parsed.choices?.[0]?.finish_reason === "stop") finished = true;
              } catch {
                // partial frame — keep buffering
              }
            }
          }
          if (responseBuffer.length > 0) {
            const tail = !docGrounded
              ? stripBrackets.push(normalize.flush()) + stripBrackets.flush()
              : normalize.flush();
            if (tail) {
              responseBuffer.push(tail);
              if (!gate) {
                controller.enqueue(enc.encode(sse({ kind: "content", content: tail } as NotebookContentFrame)));
              }
            }
            served = true;
            servedModel = `${provider.name}:${provider.model}`;
            genOutcome = "served";
            if (seam) {
              turnUsage = usageFromRaw(
                provider.name,
                provider.model,
                rawUsage as never,
                routeReasonFor(attempted),
                attempted,
                capped ? "capped" : "ok",
              );
            }
            break;
          }
          if (seam) attempted.push(provider.name);
          genOutcome = "http_error";
        } catch (err) {
          // Client stopped generation (STRM-2). Checked BEFORE the cascade
          // classifier: the race rejects with an AbortError, and a cancelled
          // controller makes enqueue throw a TypeError — neither is a
          // provider failure, and a stopped turn must never retry on the
          // next provider.
          if (clientAbort.signal.aborted) {
            genOutcome = "client_stop";
            break cascade;
          }
          if (!isProviderCascadeError(err)) {
            // A bug in this route, not a provider outage — fail loud with a
            // DISTINCT status so it can never read as provider exhaustion.
            internalError = err;
            console.error("[notebook-chat] internal error (NOT provider exhaustion):", err);
            genOutcome = "exception";
            break cascade;
          }
          console.error(
            `[notebook-chat] provider ${provider.name} failed:`,
            err instanceof Error ? err.message : err,
          );
          if (seam) attempted.push(provider.name);
          genOutcome = "exception";
          continue; // cascade to next provider
        } finally {
          if (genSpan) {
            const rawUsageObj = rawUsage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
            setSpanAttrs(
              {
                "gen_ai.operation.name": "chat",
                "gen_ai.provider.name": provider.name.toLowerCase(),
                "gen_ai.request.model": provider.model,
                "gen_ai.response.model": genOutcome === "served" ? provider.model : null,
                "gen_ai.response.id": genResponseId,
                "gen_ai.usage.input_tokens": genOutcome === "served" ? (rawUsageObj?.prompt_tokens ?? null) : null,
                "gen_ai.usage.output_tokens": genOutcome === "served" ? (rawUsageObj?.completion_tokens ?? null) : null,
                "mira.gen.attempt_index": genAttemptIndex,
                "mira.gen.route_reason": routeReasonFor(attempted),
                "mira.gen.outcome": genOutcome,
                "mira.gen.has_image_input": false,
                "mira.gen.has_observation_text": Boolean(lookContext),
              },
              genSpan,
            );
            // MIRA_OTEL_CAPTURE_CONTENT=1 only (design §3/§8), scrubbed +
            // truncated — see scrubGenAiContent's header for the
            // MAX_STRING_LEN=512 clamp caveat (tracing.ts, I1's module).
            if (captureContentEnabled()) {
              setSpanAttrs(
                {
                  "gen_ai.input.messages": scrubGenAiContent(JSON.stringify(messages)),
                  ...(genOutcome === "served"
                    ? { "gen_ai.output.messages": scrubGenAiContent(JSON.stringify(responseBuffer.join(""))) }
                    : {}),
                },
                genSpan,
              );
            }
            endTimed(genSpan, "generation");
            rec.generationAttempt({
              provider: provider.name,
              model: provider.model,
              outcome: genOutcome,
              latency_ms: Date.now() - genAttemptStartedAt,
              route_reason: routeReasonFor(attempted),
              response_id: genResponseId,
            });
            genAttemptIndex += 1;
            genSpan = null;
          }
        }
      }
      {
        const u = rawUsage as { prompt_tokens?: number; completion_tokens?: number } | null;
        rec.stage("generation", {
          has_image_input: false,
          has_observation_text: Boolean(lookContext),
          input_tokens: served ? (u?.prompt_tokens ?? null) : null,
          output_tokens: served ? (u?.completion_tokens ?? null) : null,
        });
      }

      // STRM-2: the technician stopped the answer. Nothing more is written to
      // the (already cancelled) stream. The partial text is persisted as an
      // `error` turn — a stopped answer is not an answer — with no citations,
      // no basis and no follow-ups, so nothing downstream can mistake it for
      // a grounded reply. Spend is still recorded when the seam is on: the
      // tokens were consumed whether or not the technician read them.
      if (clientAbort.signal.aborted) {
        req.signal?.removeEventListener("abort", onClientGone);
        activeReader?.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          // already cancelled by the consumer
        }
        let partial = responseBuffer.join("");
        // Same second bracket guard as the answered path: a general partial
        // must not carry [n] markers that resolve to no document.
        if (!docGrounded) partial = partial.replace(/\s*\[\d+\]/g, "");
        // B2: under the gate no candidate byte was released to the client — an
        // unvalidated, undisplayed buffer is not a partial answer and must not
        // be stored (a Stop before validation never flushes unchecked text).
        // Codex #4069 pass 18 F2: gate off, the related-manual warning already
        // streamed ahead of this text — the saved turn carries what the tech saw.
        if (relatedWarningStreamed && relatedManualWarning && partial.length) {
          partial = `${relatedManualWarning}\n\n${partial}`;
        }
        const partialText = gate ? null : partial.length ? (flagBanner ? `${flagBanner}\n\n${partial}` : partial) : null;
        const stoppedModel = activeProvider ? `${activeProvider.name}:${activeProvider.model}` : null;
        const stoppedAnswerGateSpan = tracer.startSpan("answer_gate.evaluate", undefined, rootCtx);
        rec.stage("answer_gate", {
          invoked: true,
          decision: "error",
          reason: "client_stop",
          answer_chars: partialText?.length ?? 0,
          refusal_phrase_matched: false,
          evidence_phrase_matched: false,
          safety_classification: "none",
          evidence_sufficient: false,
          ungrounded_unit_claim: false,
        });
        setSpanAttrs(
          { "mira.answer_gate.invoked": true, "mira.answer_gate.decision": "error", "mira.answer_gate.reason": "client_stop" },
          stoppedAnswerGateSpan,
        );
        stoppedAnswerGateSpan.end();
        // F004 contract v2: a stop is not an answer — saved, never offered a
        // general-guidance action (Retry is). No frame: the client is gone.
        const stoppedGrounding = groundingOn
          ? buildGroundingStatus({
              ...groundingBase(),
              modelCalled: true,
              served,
              refused: false,
              stopped: true,
              terminalSafetyStop: false,
              emittedCitations: [],
              unresolvedMarkerCount: 0,
            })
          : null;
        const stoppedPersistSpan = startStage("turn.persist");
        let stoppedTurnRowId: string | null = null;
        try {
          stoppedTurnRowId = await recordTurn(ctx.tenantId, notebookId, {
            // 086: the owner is the authenticated technician (session), never the body.
            ownerUserId: ctx.userId,
            threadId,
            clientRequestId,
            claimToken: requestClaimToken,
            question: message,
            answerStatus: "error",
            answerText: partialText,
            enabledSourceDocIds: docIds,
            // The technician's own photo stays on their saved question (#4289
            // F3); a stop is still not an answer — hydration shows no
            // observation, citation or basis on a stopped answer, and prior-look
            // grounding reads answered turns only.
            evidence: [
              ...hazardEntries,
              ...disputeEntries,
              ...(visualEntry ? [visualEntry] : []),
              ...(stoppedGrounding ? [stoppedGrounding] : []),
            ],
            model: stoppedModel,
            basis: null,
            ...assetSnapshot,
          });
        } catch (err) {
          console.error("[notebook-chat] recordTurn (stopped) failed:", err instanceof Error ? err.message : err);
          setSpanAttrs({ "mira.persist.outcome": "failed", "mira.persist.error_code": "record_turn_failed" }, stoppedPersistSpan);
          await abandonRequestClaim().catch((releaseErr) => {
            console.error(
              "[notebook-chat] request claim release failed:",
              releaseErr instanceof Error ? releaseErr.message : releaseErr,
            );
          });
        }
        // Turn Flight Recorder (design §4): the packet is persisted on EVERY
        // completed path, seam on or off. The seam still decides how much
        // SPEND detail the ledger row carries — on the legacy cascade token
        // counts and cost are UNKNOWN (null), never zero, and routeReason is
        // 'legacy_cascade'. The `usage` SSE frame stays seam-only (wire
        // contract unchanged).
        {
          const stoppedUsage: TurnUsage = seam
            ? activeProvider
              ? {
                  ...usageFromRaw(
                    activeProvider.name,
                    activeProvider.model,
                    rawUsage as never,
                    routeReasonFor(attempted),
                    attempted,
                    "error",
                  ),
                  // The provider `usage` block rides the FINAL chunk, which a
                  // stopped turn never receives — so on a stop the token counts
                  // are UNKNOWN, not zero. estimateCostUsd() turns all-null
                  // counts into 0.000000, which is a positive claim that a turn
                  // that really did burn tokens was free: it disappears into
                  // SUM(cost_usd_estimate) and is NOT caught by
                  // tenantSpendSince's `unpriced_turns` (… IS NULL) filter.
                  // Unknown cost stays NULL — persist-usage.ts's own rule.
                  ...(rawUsage ? {} : { costUsdEstimate: null }),
                }
              : exhaustedUsage(attempted)
            : legacyCascadeUsage(activeProvider, "error");
          if (seam) logTurnUsage({ tenantId: ctx.tenantId, notebookId }, stoppedUsage);
          await finishAndPersist(stoppedTurnRowId, stoppedUsage, {
            answerText: partialText,
            citationsPresent: false,
            latencyMs: Date.now() - turnStartedAt,
          });
        }
        setSpanAttrs({ "mira.turn.row_id": stoppedTurnRowId }, stoppedPersistSpan);
        endTimed(stoppedPersistSpan, "persist");
        endRoot();
        return;
      }
      let answerText = normalizeCitationMarkers(responseBuffer.join(""));

      // Determine the honest status + which citations to ship. A refusal ships
      // ZERO citations (no irrelevant pages as proof) and is recorded as
      // insufficient_evidence; a grounded answer ships only the [n] it used.
      // #3953: a doc-grounded answer that asserts something and cites a
      // shipped source is not a refusal just because it also states a
      // limitation. `isRefusal` itself is unchanged (the observability mirror
      // below still reports the raw phrase match).
      const refused = served && refusalVerdict(answerText, { docGrounded, citations });
      // SECOND BRACKET GUARD (the prompt is the first). A general answer has no
      // sources, so any [n] the model emitted anyway points at nothing and would
      // render as a citation chip in mira-mobile. Strip the markers rather than
      // ship a chip that resolves to no document.
      if (!docGrounded) answerText = answerText.replace(/\s*\[\d+\]/g, "");

      // B2/B3 (#3790/#3787, PR #3791): pre-display validation on the COMPLETE
      // candidate. Under the gate nothing has been released yet, so a rejected
      // candidate is replaced before the technician sees a byte of it. The
      // rejected draft is never persisted and never re-enters chat context —
      // only its bounded excerpt reaches the server log. With the gate off the
      // validator still runs detection-only so rejected shapes stay observable.
      // Evidence behind THIS turn: retrieved chunks (notebook or OEM), a machine
      // packet, or a photo observation (current or earlier). Feeds the
      // pre-display gate so an exact equipment rating with nothing behind it is
      // withheld, not merely recorded as evidence_sufficient=false afterwards.
      const evidenceSufficient = chunks.length > 0 || Boolean(groundedMachineEntry) || Boolean(lookContext);
      // The specificity lane keys on "no documents behind the answer", which
      // is `!docGrounded` (an OEM-grounded turn is held to the citation
      // contract, exactly like a notebook-grounded one).
      const validation = validateAnswer({
        answerText,
        question: message,
        general: !docGrounded,
        served,
        refused,
        evidenceSufficient,
        manualSearchRunning,
      });
      let outputRejected: { kind: "unsafe_answer" | "unsupported_specificity"; violation: string } | null = null;
      // #4098: which quantity word + unit the exact-rating rule matched —
      // closed-vocabulary tokens, never text — so false refusals are
      // diagnosable from the Turn Evidence Packet. Recorded gate on or off.
      const gateMatch = !validation.ok && validation.match ? validation.match : null;
      if (!validation.ok) {
        console.error(
          `[notebook-chat] pre-display ${gate ? "REJECTED" : "flagged (gate off)"} ${validation.violation}: ${validation.detail}`,
        );
        if (gate) {
          if (validation.kind === "hazard_warning") {
            // 2026-09-27: a step the gate flags stays in the answer, quoted in
            // a warning above it — served as an ordinary answered turn.
            answerText = validation.replacement;
          } else if (validation.kind === "energized_warning") {
            // #3984 (Mike 2026-09-26): warn and keep troubleshooting. The
            // replacement is the candidate with a warning above it, served as
            // an ordinary answered turn — not a Safety STOP. The existing
            // non-terminal energized directive (#3841) rides the evidence
            // frame so web + mobile render the same warning chip.
            answerText = validation.replacement;
            if (!hazardEntries.some((e) => e.trigger === ENERGIZED_ELECTRICAL_HAZARD)) {
              hazardEntries.push({ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD });
            }
          } else {
            outputRejected = { kind: validation.kind, violation: validation.violation };
            answerText = validation.replacement;
          }
        }
      }

      // #3793 semantic layer (2026-09-14 coverage audit): meaning-aware check
      // on the ACCEPTED candidate. Fail-closed: a flagged candidate that cannot
      // be judged (timeout, provider failure, malformed verdict) is withheld
      // behind the controlled unverified fallback — never silently released.
      // Lives inside the gate: gate-off stays byte-identical legacy with zero
      // inference spend. Class/verdict/latency are logged so the real
      // invocation rate is measured, not assumed.
      //
      // HAZARD TRIAGE — SHADOW ONLY (2026-09-23, #3957 remount / Mike mission):
      // Observational would-skip telemetry only. ALWAYS await semanticSafetyCheck
      // on this enabled path; triage never gates citations/badge/production
      // behavior. Unsafe/unverified gating comes solely from the semantic verdict.
      // Prior tip IR PASS on 3674c65a was intent-stale (accepted real skip).
      let triagePromise: Promise<HazardTriageResult | null> | null = null;
      if (gate && !outputRejected && served && !refused && answerText && semanticCheckEnabled()) {
        const candidateForTriage = answerText;
        // The existing Jev request started before generation. Classify its
        // result asynchronously; never await triage before the semantic judge.
        // Its catch is telemetry-only, while the judge controls the wire.
        triagePromise = jevShadow.then((jev) =>
          triageSemanticSafetyCheck({
            question: message,
            answerText: candidateForTriage,
            refused,
            general: !docGrounded,
            jev,
          }),
        ).catch((err): null => {
          console.warn(`[notebook-chat] hazard-triage telemetry failed (ignored):`, err);
          return null;
        });

        // ALWAYS run the semantic check — never skip based on triage/Jev.
        // Iteration-9 F1: classification is TELEMETRY only, never a selection boundary.
        const selectedClass = selectForSemanticCheck(answerText, message) ?? "unclassified";
        const semStart = Date.now();
        const sv = await semanticSafetyCheck({
          question: message,
          answerText,
          general: !docGrounded,
          selectedClass,
        });
        console.log(`[notebook-chat] semantic-check class=${selectedClass} verdict=${sv.verdict} in ${Date.now() - semStart}ms`);
        // 2026-09-27 (Mike, settles #4022): the judge FLAGS, it never
        // withholds. "unsafe" puts a hazard banner above the answer; a judge
        // that could not decide (timeout, provider blip) fails OPEN — a broken
        // judge is not evidence of a dangerous answer.
        if (sv.verdict === "unsafe") {
          const cls = (sv.hazardClass ?? selectedClass).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
          console.warn(`[notebook-chat] semantic FLAGGED ${cls}: ${sv.reason ?? ""}`);
          answerText = `${hazardBanner(cls)}\n\n${answerText}`;
        } else if (sv.verdict !== "safe") {
          console.warn(`[notebook-chat] semantic UNVERIFIED (${sv.reason ?? "unknown"}): serving the answer (fail-open)`);
        }
      }

      if (flagBanner && served && !refused && answerText) answerText = `${flagBanner}\n\n${answerText}`;

      // #4068 — owner decision 2026-09-27 ("allow with a warning"): an answer
      // grounded on related-manual pages (the same-family fallback) may relay
      // that manual's steps, but ALWAYS under a fixed, server-written warning —
      // never left to the model's phrasing. Stacked below any hazard banner.
      if (relatedManualWarning && served && !refused && answerText) {
        answerText = flagBanner && answerText.startsWith(flagBanner)
          ? `${flagBanner}\n\n${relatedManualWarning}${answerText.slice(flagBanner.length)}`
          : `${relatedManualWarning}\n\n${answerText}`;
      }

      // The Jev shadow judgment (started before generation) is collected here,
      // BEFORE the commit point, for the same reason the semantic await is: the
      // tail below must stay await-free. Bounded by its own timeout; fail-open;
      // read only by the packet.
      const jev = await jevShadow;
      const triage = await triagePromise;
      if (triage) {
        console.log(
          `[notebook-chat] hazard-triage would_skip=${triage.decision === "would_skip"} ` +
            `reason=${triage.reason} jev.noul=${triage.jev?.noul ?? "null"} ` +
            `in ${triage.latency_ms}ms`,
        );
      }

      // ADR-0038 rule 7 commit point: the stopped-vs-answered decision was
      // made once, above; validation (deterministic AND semantic) is complete;
      // from here to the write the tail is synchronous and never re-reads the
      // abort signal. The semantic await lives BEFORE this detach on purpose —
      // a disconnect during the judge falls into the same designed bucket as a
      // disconnect after commit (the turn stays answered).
      req.signal?.removeEventListener("abort", onClientGone);

      // A rejected turn ships ZERO citations — the retrieved content that drove
      // the rejected draft must not be presented as the replacement's authority.
      const emittedCitations =
        !docGrounded || !served || refused || outputRejected ? [] : citationsUsedInAnswer(answerText, citations);
      const answerStatus: "answered" | "insufficient_evidence" | "error" = !served
        ? "error"
        : refused
          ? "insufficient_evidence"
          : "answered";

      {
        const finalAnswerGateSpan = tracer.startSpan("answer_gate.evaluate", undefined, rootCtx);
        const answerLower = answerText.toLowerCase();
        // isRefusal's two clauses, split so each is independently observable
        // without changing isRefusal's own result (design §3 answer_gate
        // fields `refusal_phrase_matched` / `evidence_phrase_matched`).
        const refusalPhraseMatched =
          /\b(could|couldn'?t|can'?t|cannot|do(?:es)? not|don'?t)\b[^.]*\b(find|contain|include|have|see|specify|state|list|give|provide|mention|show|cover)\b/.test(
            answerLower,
          );
        const evidencePhraseMatched =
          /\b(excerpts?|sources?|references?|documents?|documentation|manuals?|data ?sheets?|ratings?|specifications?|specs?|provided|supplied|selected|information)\b/.test(answerLower);
        const gateReason = outputRejected
          ? outputRejected.violation
          : !served
            ? internalError
              ? "internal_error"
              : "provider_exhausted"
            : refused
              ? "refusal_regex"
              : "served";
        const gateDecision: "answered" | "insufficient_evidence" | "blocked" | "error" = outputRejected
          ? "blocked"
          : answerStatus;
        const ungroundedClaim = served && !refused ? ungroundedUnitClaim(answerText) : false;
        // #3962 — run on the RAW strings here, like ungroundedUnitClaim, because
        // the packet deliberately carries no answer text and so this can never
        // be recomputed later from stored packets. Only the verdict, its version
        // and small counts are kept.
        const evidenceFollowed =
          served && !refused && lookContext ? assessEvidenceFollowed(lookContext, answerText) : null;
        // The LEDGER outcome, mapped from the gate decision. Distinct from
        // `gateDecision` on purpose: the gate answers "what did we decide about
        // the answer", the lifecycle answers "how did this accepted turn end" —
        // and a blocked answer that still shipped a replacement is a `refused`
        // turn, not an error.
        lifecycleOutcome = outputRejected
          ? outputRejected.kind === "unsafe_answer"
            ? "safety_stop"
            : "refused"
          : gateDecision === "insufficient_evidence"
            ? "abstained"
            : gateDecision === "error"
              ? "error"
              : refused
                ? "refused"
                : "answered";
        rec.stage("answer_gate", {
          invoked: true,
          decision: gateDecision,
          reason: gateReason,
          answer_chars: served ? answerText.length : 0,
          refusal_phrase_matched: refusalPhraseMatched,
          evidence_phrase_matched: evidencePhraseMatched,
          safety_classification: electricalHazardDirective ? "hazard_directive" : "none",
          evidence_sufficient: evidenceSufficient,
          ungrounded_unit_claim: ungroundedClaim,
          jev_sufficient: jev.noul,
          jev_skipped_reason: jev.skipped_reason,
          jev_latency_ms: jev.latency_ms,
          jev_input_tokens: jev.input_tokens,
          citations_shipped: emittedCitations.length,
          evidence_followed: evidenceFollowed,
          gate_match: gateMatch,
        });
        // SHADOW. Assemble the judgeable view of this turn while the text still
        // exists. The packet deliberately stores no question and no answer, so
        // this can never be reconstructed afterwards — but only the VERDICTS
        // are kept, never the text (see turn-decision-state.ts for the audited
        // payload). Assembly is pure and cannot throw the turn; the metered call
        // happens later, after the stream is closed.
        decisionState = buildTurnDecisionState({
          question: message,
          answer: answerText,
          // The strongest identity the turn actually resolved, in the order the
          // retrieval layer trusts them. `null` is a real answer here — an
          // unresolved subject is exactly the #3962 shape and the judge should
          // see it as unresolved rather than be handed a guess.
          assetIdentity:
            chunks.length > 0 && chunks[0].manufacturer
              ? [chunks[0].manufacturer, chunks[0].modelNumber].filter(Boolean).join(" ")
              : null,
          observations: [lookContext],
          evidence: chunks.map((c) => ({
            source: c.title,
            // The mismatch signal for #3966: the family the SOURCE belongs to,
            // which is what diverged from the panel in the photo.
            family: [c.manufacturer, c.modelNumber].filter(Boolean).join(" ") || null,
            content: c.content,
          })),
          gates: {
            decision: gateDecision,
            evidence_sufficient: evidenceSufficient,
            citations_shipped: emittedCitations.length,
            ungrounded_unit_claim: ungroundedClaim,
            system_prompt_kind: !docGrounded ? "general" : groundedMachineEntry ? "machine" : "grounded",
            retrieval_strategy: oemRetrieval ? "oem_corpus" : "notebook",
          },
          traceId: rootTraceId,
          attemptId: null,
        });
        setSpanAttrs(
          {
            "mira.answer_gate.invoked": true,
            "mira.answer_gate.decision": gateDecision,
            "mira.answer_gate.reason": gateReason,
            "mira.answer_gate.answer_chars": served ? answerText.length : 0,
            "mira.answer_gate.refusal_phrase_matched": refusalPhraseMatched,
            "mira.answer_gate.evidence_phrase_matched": evidencePhraseMatched,
            "mira.safety.classification": electricalHazardDirective ? "hazard_directive" : "none",
            "mira.evidence.sufficient": evidenceSufficient,
            "mira.answer_gate.citations_shipped": emittedCitations.length,
            "mira.evidence.followed": evidenceFollowed?.verdict ?? "not_applicable",
          },
          finalAnswerGateSpan,
        );
        finalAnswerGateSpan.end();
      }

      const sourcesFrame: NotebookSourcesFrame = {
        kind: "sources",
        citations: emittedCitations,
        sourceSnapshot: docIds,
      };
      const evidenceFrame: NotebookBasisEvidenceFrame = groundedMachineEntry
        ? groundedMachineEntry.freshness === "live"
          ? {
              kind: "evidence",
              basis: "live_machine_evidence",
              label: !docGrounded
                ? "Grounded in live machine evidence — no documents for this machine."
                : oemRetrieval
                  ? "Grounded in live machine evidence and the manufacturer's documentation."
                  : "Grounded in live machine evidence and this notebook's sources.",
            }
          : {
              kind: "evidence",
              basis: "machine_history",
              label: !docGrounded
                ? "Grounded in recorded machine history — not live, no documents for this machine."
                : oemRetrieval
                  ? "Grounded in recorded machine history and the manufacturer's documentation — not live."
                  : "Grounded in recorded machine history and this notebook's sources — not live.",
            }
        : docGrounded && emittedCitations.length > 0
          ? {
              kind: "evidence",
              basis: "oem_documentation",
              label: oemRetrieval
                ? "Grounded in the manufacturer's documentation (shared library)."
                : "Grounded in this notebook's sources.",
            }
          : lookContext
            ? {
                // The answer rests on a photo the technician attached (this turn
                // or an earlier one in the thread) — the tenant's own captured
                // evidence, not a document. Staging traces cf204938… / 104883fb…
                // (2026-09-22) answered "24 V DC" straight from the nameplate
                // photo and were labelled general / documentation respectively.
                kind: "evidence",
                basis: "workspace_evidence",
                label: priorLookRows.length > 0 && !lookRow
                  ? "Grounded in a photo attached earlier in this conversation — an unconfirmed reading."
                  : "Grounded in the attached photo — an unconfirmed reading.",
              }
            : {
                kind: "evidence",
                basis: "general_reasoning",
                label: "General guidance — not grounded in this machine's documents.",
              };
      if (machineEntry) evidenceFrame.machineEvidence = machineEntry;
      if (visualEntry) evidenceFrame.visualEvidence = visualEntry;
      if (hazardEntries.length > 0) evidenceFrame.hazardEntries = hazardEntries;
      if (identityDisputed) evidenceFrame.identityDisputed = true;

      // Complete the durable turn before touching the response controller.
      // Cancellation during the semantic judge closes that controller; a
      // later enqueue may throw, but terminal truth must already be replayable.
      // F004 contract v2: built once from the final, shipped answer; persisted,
      // streamed and replayed as this same object.
      const finalGrounding = groundingOn
        ? buildGroundingStatus({
            ...groundingBase(),
            modelCalled: true,
            served,
            refused: refused || (outputRejected !== null && outputRejected.kind !== "unsafe_answer"),
            stopped: false,
            terminalSafetyStop: outputRejected?.kind === "unsafe_answer",
            emittedCitations,
            unresolvedMarkerCount: served && docGrounded ? countUnresolvedMarkers(answerText, citations) : 0,
          })
        : null;
      const finalPersistSpan = startStage("turn.persist");
      let finalTurnRowId: string | null = null;
      try {
        finalTurnRowId = await recordTurn(ctx.tenantId, notebookId, {
          ownerUserId: ctx.userId,
          threadId,
          clientRequestId,
          claimToken: requestClaimToken,
          question: message,
          answerStatus,
          answerText: served ? answerText : null,
          enabledSourceDocIds: docIds,
          evidence: served
            ? outputRejected?.kind === "unsafe_answer"
              ? [
                  ...hazardEntries,
                  { kind: "safety_notice", trigger: outputRejected.violation } satisfies SafetyNoticeEntry,
                  { kind: "safety_stop", trigger: outputRejected.violation } satisfies SafetyStopEntry,
                  ...disputeEntries,
                  ...(visualEntry ? [visualEntry] : []),
                  ...proposalEntries,
                  ...(finalGrounding ? [finalGrounding] : []),
                ]
              : [
                  ...hazardEntries,
                  ...emittedCitations,
                  ...(machineEntry ? [machineEntry] : []),
                  ...(visualEntry ? [visualEntry] : []),
                  ...disputeEntries,
                  ...proposalEntries,
                  ...(finalGrounding ? [finalGrounding] : []),
                ]
            // Not served: the technician's own photo still stays on their saved
            // question (#4289 F4); hydration shows no observation on a failed answer.
            : [
                ...hazardEntries,
                ...emittedCitations,
                ...disputeEntries,
                ...proposalEntries,
                ...(visualEntry ? [visualEntry] : []),
                ...(finalGrounding ? [finalGrounding] : []),
              ],
          model: servedModel,
          basis: served ? (outputRejected?.kind === "unsafe_answer" ? null : evidenceFrame.basis) : null,
          ...assetSnapshot,
        });
      } catch (err) {
        console.error("[notebook-chat] recordTurn failed:", err instanceof Error ? err.message : err);
        setSpanAttrs({ "mira.persist.outcome": "failed", "mira.persist.error_code": "record_turn_failed" }, finalPersistSpan);
        if (clientRequestId) {
          await abandonRequestClaim().catch(() => undefined);
          try {
            controller.error(err);
          } catch {
            // The cancelled client already owns the transport failure.
          }
          endTimed(finalPersistSpan, "persist");
          // Design §4's sixth exit path: "recordTurn failure" still gets a
          // packet with `persistence.outcome='failed'`, seam on or off.
          {
            const failedUsage: TurnUsage = seam
              ? { ...exhaustedUsage(attempted), status: "error" }
              : legacyCascadeUsage(activeProvider, "error");
            await finishAndPersist(null, failedUsage, {
              answerText: null,
              citationsPresent: false,
              latencyMs: Date.now() - turnStartedAt,
            });
          }
          endRoot();
          return;
        }
      }

      // An unsafe replacement is already a terminal Safety STOP. Emit its
      // warning before the first stoppable content byte so an interruption can
      // never erase the server's authoritative safety determination.
      if (outputRejected?.kind === "unsafe_answer") {
        controller.enqueue(
          enc.encode(sse({ kind: "safety", trigger: outputRejected.violation } as NotebookSafetyFrame)),
        );
      }

      // B2: release the ACCEPTED answer. Content precedes sources/basis/status
      // for ordinary answers; chunked on whitespace so
      // clients keep their incremental-render path. Time-to-first-accepted-
      // content is logged — the gate trades first-token latency for the
      // guarantee that no unvalidated byte is ever displayed.
      if (gate && served && answerText) {
        for (const piece of chunkForRelease(answerText)) {
          controller.enqueue(enc.encode(sse({ kind: "content", content: piece } as NotebookContentFrame)));
        }
        console.log(
          `[notebook-chat] gate released ${answerText.length} chars at +${Date.now() - turnStartedAt}ms` +
            (outputRejected ? ` (replacement for ${outputRejected.violation})` : ""),
        );
      }

      controller.enqueue(enc.encode(sse(sourcesFrame)));

      // Evidence basis (spec §1.3) — emitted before `status` so a client that
      // stops at `status` has still received it, same discipline as `usage`.
      // Says out loud what the answer rests on, so general reasoning can never
      // be mistaken for a manual.
      // With machine evidence (§4.4): `live_machine_evidence` only when the
      // asset's CURRENT signals roll up fresh; anything else is
      // `machine_history` — a replay is never labelled live (contract §2.8).
      // An empty or unavailable window claims NO machine basis (see
      // `machineGrounded` above): the turn keeps the basis it would have had
      // without the selection, and the entry rides along additively so the
      // client can render the honest caption.
      // The machine entry and the verified visual observation ride on the SAME
      // frame, additively — the basis and label above are untouched by them.
      if (outputRejected?.kind === "unsafe_answer") {
        // The replacement IS the safety stop: same grammar as the input-side
        // stop — no basis-bearing evidence frame. The rejected candidate's
        // lane must not certify the replacement. Its safety frame was emitted
        // before content above; only the verified-photo marker remains here.
        if (visualEntry) controller.enqueue(enc.encode(sse(visualEvidenceMarker(visualEntry))));
      } else {
        controller.enqueue(enc.encode(sse(evidenceFrame)));
      }

      const statusFrame: NotebookStatusFrame =
        answerStatus === "answered"
          ? { kind: "status", status: "answered" }
          : answerStatus === "insufficient_evidence"
            ? {
                kind: "status",
                status: "insufficient_evidence",
                // F004 v2 §4: about the attempt, never "the manual lacks it" —
                // only where the grounding status is shown, so every other
                // client's output stays byte-identical.
                message: showGrounding ? HONEST_REFUSAL_STATUS_MESSAGE : "Not found in the selected sources.",
              }
            : internalError
              ? { kind: "status", status: "error", message: "Internal chat error — see server logs." }
              : { kind: "status", status: "error", message: "No answer provider available." };
      // Canonical per-turn spend, emitted BEFORE status so a client that stops
      // reading at `status` has still received it. Seam-flagged only; the
      // legacy path's frame sequence is byte-for-byte unchanged.
      if (seam) {
        const finalUsage: TurnUsage = turnUsage ?? exhaustedUsage(attempted);
        controller.enqueue(enc.encode(sse(usageFrame(finalUsage))));
        // Structured log: still emitted, because a log line survives a database
        // outage and is the thing you grep DURING an incident.
        logTurnUsage({ tenantId: ctx.tenantId, notebookId }, finalUsage);
        pendingUsage = finalUsage;
      }

      // F004 contract v2: before `status`, so a client that stops reading at
      // `status` still has it. Declaring clients only.
      if (showGrounding && finalGrounding) controller.enqueue(enc.encode(sse(finalGrounding)));
      controller.enqueue(enc.encode(sse(statusFrame)));

      // Deterministic follow-up chips (CONV-4, answered turns only) — derived
      // from the coverage plan + proven facet evidence; no LLM call, no new
      // retrieval. General mode gets only the answer-derived lanes (chunks is
      // empty, so no facet chip can name unproven evidence).
      // A disputed identity never gets machine-flavoured follow-ups ("… on this
      // drive?") — the technician must re-select the machine first.
      // #4095 — the proposal rides next to the answer for a client that
      // renders it (none ships that yet; unknown frames are ignored). Emitted
      // whatever the answer status.
      if (identityProposal) {
        const proposalFrame: NotebookIdentityProposalFrame = { kind: "identity_proposal", ...identityProposal };
        controller.enqueue(enc.encode(sse(proposalFrame)));
      }
      // T2 (#4189) — see manualSearchStatusFrame's own header. Transient only.
      {
        const searchStatusFrame = manualSearchStatusFrame(identityProposal, manualSearchRunning, candidateAcquisitionText, candidateSearchStartedAt);
        if (searchStatusFrame) controller.enqueue(enc.encode(sse(searchStatusFrame)));
      }
      if (answerStatus === "answered" && !identityDisputed && !outputRejected) {
        const provenFacets = plan.facets.length
          ? [...facetEvidencePages(chunks, plan.facets)]
              .filter(([, pages]) => pages.length)
              .map(([facet]) => facet)
          : [];
        const suggestions = buildFollowupSuggestions({
          plan,
          provenFacets,
          answer: answerText,
          status: answerStatus,
        });
        if (suggestions.length) {
          const followupsFrame: NotebookFollowupsFrame = { kind: "followups", suggestions };
          controller.enqueue(enc.encode(sse(followupsFrame)));
        }
      }

      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();

      // Durable spend ledger (migration 080) + Turn Flight Recorder packet.
      // Deliberately LAST and non-fatal: the answer is already streamed and
      // already persisted as conversation history, so a telemetry outage must
      // not retroactively destroy a correct, cited answer. `finishAndPersist`
      // wraps `persistTurnUsage`, which never throws on its own — it returns a
      // result and logs a distinct `turn.usage.persist_failed` event, so a
      // spend gap stays diagnosable without becoming a chat outage.
      //
      // Persisted on EVERY completed turn (design §4). With the seam on the
      // row carries the canonical spend; on the legacy cascade it carries the
      // served provider/model with UNKNOWN (null) tokens and cost.
      {
        const ledgerUsage: TurnUsage =
          pendingUsage ?? legacyCascadeUsage(activeProvider, served ? "ok" : "error");
        // Yield once after close so the consumer observes its terminal body
        // before telemetry starts. A ledger exception is non-fatal and must
        // never turn an already-closed, valid answer into a transport error.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await finishAndPersist(finalTurnRowId, ledgerUsage, {
          answerText: served ? answerText : null,
          citationsPresent: emittedCitations.length > 0,
          latencyMs: Date.now() - turnStartedAt,
        });
      }
      setSpanAttrs({ "mira.turn.row_id": finalTurnRowId, "mira.persist.outcome": "ok" }, finalPersistSpan);
      endTimed(finalPersistSpan, "persist");
      endRoot();
      } catch (err) {
        req.signal?.removeEventListener("abort", onClientGone);
        await abandonRequestClaim().catch((releaseErr) => {
          console.error(
            "[notebook-chat] request claim release failed:",
            releaseErr instanceof Error ? releaseErr.message : releaseErr,
          );
        });
        // Last-resort net: an exception here means no `endRoot()` on any
        // earlier path fired (every designed exit path already calls it) —
        // never leave the root span dangling unexported.
        try {
          const error = err instanceof Error ? err : new Error(String(err));
          rootSpan.recordException(error);
        } catch {
          // best-effort
        }
        endRoot();
        try {
          controller.error(err);
        } catch {
          // A cancelled response controller is already terminal.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      ...(rootTraceId ? { "x-mira-trace-id": rootTraceId } : {}),
    },
  });
}


/**
 * INGRESS WRAPPER (093) — the outermost thing in this route, on purpose.
 *
 * Everything below `handleChatTurn` is the recorder's world: it starts after
 * `sessionOr401`, after body parsing, after validation. So every 401, every
 * `invalid_json`, every `message_too_long` returned before `openTurn` left NO
 * TRACE OF ANY KIND — and, worse, a turn that was accepted but whose start
 * record failed to write was equally invisible, because the only thing that
 * could have reported it was the write that failed.
 *
 * This wrapper writes "a request arrived" into a DIFFERENT table before any of
 * that runs, and "a response left, with this status" in a `finally` that no
 * early return can skip. Reconciling the two against the ledger turns a silence
 * into a number:
 *
 *   responded 4xx, never opened  → a pre-accept rejection (expected, own denominator)
 *   responded 2xx, never opened  → a LOST START (the capture defect)
 *
 * Both writes are fire-and-forget and neither can fail a turn; the response
 * write is chained onto the arrival so the two rows cannot be written out of
 * order under load.
 */
/** The notebook id goes into a UUID column; a non-UUID path segment (a 404 on
 *  its way) must be recorded as an arrival with no notebook, not crash the
 *  counter that exists to notice it. */
const INGRESS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, routeCtx: { params: Promise<{ id: string }> }) {
  const attemptId = crypto.randomUUID();
  let notebookId: string | null = null;
  try {
    const p = await routeCtx.params;
    notebookId = typeof p?.id === "string" && INGRESS_UUID_RE.test(p.id) ? p.id : null;
  } catch {
    notebookId = null;
  }
  // The client's own key, read from a HEADER before any parsing. The body is
  // where it normally travels, but a malformed body is precisely the attempt
  // that most needs accounting for and its id is unreachable in there — so a
  // request that fails to parse can still be joined to the client that sent it.
  // Shape-checked: this lands in a TEXT column that operators read.
  const headerKey = req.headers.get("x-client-request-id");
  const ingress: IngressRecord = {
    attemptId,
    route: "hub_notebook_chat",
    tenantId: null,
    clientRequestId: headerKey && INGRESS_UUID_RE.test(headerKey) ? headerKey : null,
    notebookId,
    environment: environmentName(),
    gitSha: gitSha(),
  };
  // A SNAPSHOT, deliberately. `handleChatTurn` sets `ingress.tenantId` once
  // auth succeeds, and this call is not awaited — so passing the live object
  // would make "did the arrival row get a tenant" a race that COALESCE hides
  // from every assertion while leaving the tenant index unreliable. The arrival
  // row has no tenant because at arrival there is no tenant.
  const arrival = recordArrival({ ...ingress });
  let status = 500;
  try {
    const res = await handleChatTurn(req, routeCtx, ingress);
    status = res.status;
    return res;
  } catch (err) {
    // A throw that escaped every `endRoot` would leave the start record open
    // until the reconciler swept it — reported as `abandoned` when it was in
    // fact an error, which is a worse lie than no record at all.
    ingress.closeOnUnhandled?.("error");
    throw err;
  } finally {
    // `ingress.tenantId` is populated by now on every authenticated path.
    void arrival
      .then(() => recordResponse({ ...ingress, httpStatus: status }))
      .catch(() => {
        /* counted inside the module; never fails a turn */
      });
  }
}
