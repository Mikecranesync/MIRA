/**
 * single_pass.ts — Arm H0: "production retrieval at the notebook chat route's
 * topK + the route's system prompt + one model call" (PREREGISTRATION.md §2/§3).
 *
 * H0 is deliberately NOT a re-implementation of the notebook chat route. It
 * reuses the route's own EXPORTED, pure building blocks so the prompt text and
 * citation numbering are byte-identical to production, and lifts the base
 * system prompt text verbatim (with a path:line citation + sha256) rather than
 * retyping it — avoiding both transcription risk and the risk of importing a
 * server-only module with side effects.
 *
 * Reused PRODUCTION exports (all read-only, pure or near-pure; grounded by
 * `grep`/`git show` against this worktree's `mira-hub/src`, pinned at
 * origin/main 524106a06):
 *   - `BASE_SYSTEM_PROMPT`        mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:325
 *   - `GENERAL_SYSTEM_PROMPT`     mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:411
 *   - `buildProviderMessages`     mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:865
 *   - `citationsUsedInAnswer`     mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:904
 *   - `retrieveNodeChunks`        mira-hub/src/lib/manual-rag.ts:1277
 *   - `appendManualContext`       mira-hub/src/lib/manual-rag.ts:2339 (approx; exported)
 *   - `buildManualUserContent`    mira-hub/src/lib/manual-rag.ts (exported, same file)
 *   - `chunksToSources`           mira-hub/src/lib/manual-rag.ts (exported, same file)
 *   - `displayPage`               mira-hub/src/lib/manual-rag.ts (exported, same file)
 *
 * Importing `BASE_SYSTEM_PROMPT`/`GENERAL_SYSTEM_PROMPT` directly from the
 * route module (rather than hand-copying the text) was verified safe in this
 * lane: `npx vite-node --config vitest.config.ts <probe importing them>`
 * completed in <1s with no side effects (no DB connection attempted — the
 * route's module-scope code does not eagerly connect). This also means the
 * sha256 recorded below is always computed from the LIVE current value of the
 * constant, so a future edit to the route is detected (hash changes) rather
 * than silently drifting from a stale hand-copy.
 *
 * ## Runtime directives H0 deliberately does NOT reproduce
 * (full production assembly: route.ts:3719-3765 and the three hundred lines
 * around it). Listed here, NOT implemented, because reproducing them would
 * mean re-implementing most of the chat route rather than measuring "the base
 * prompt + one retrieval + one model call" in isolation:
 *   - Conversation history (`history: ChatHistoryTurn[]`) — H0 passes `[]`.
 *   - Prior technician report context (`buildPriorReportContext`) — passed as `""`.
 *   - `FIELD_OBSERVATION_DIRECTIVE`, `ELECTRICAL_HAZARD_DIRECTIVE`,
 *     `safetyFlagDirective`, `RESTART_DIRECTIVE` (hazard/restart banners).
 *   - `machineSection` / `visualSection` (bound-equipment + photographed-nameplate context).
 *   - `coverageDirective` (the multi-facet "answer-shape" coverage plan from
 *     `classifyCoverage`/`notebook-query.ts`).
 *   - `vendorFallbackDirective` / `relatedManualWarning` (same-manufacturer fallback framing).
 *   - `identityProposalDirective` / `GUIDED_DEAD_END_DIRECTIVE`.
 *   - The five post-assembly wrappers: `withStepSafety`, `withAnswerLanguage`,
 *     `withPhotoProvenance`, `withLabelDataIdentifiers`, `withRetailCodeNote`.
 *   - `topicHint` (deterministic follow-up topic note).
 *   - ALL four terminal/safety mechanisms on the real route: the off-topic
 *     scope short-circuit (`isOffTopic`), the energized-work hard stop
 *     (TQ-29), Gate G's zero-chunk abstain, and the output-side
 *     `unsafe_answer` (prompt-leak-guard) rejection. H0 never stops the turn —
 *     it always attempts a synthesis call (budget permitting). H0's safety
 *     numbers therefore do NOT represent production safety behavior; that is
 *     exactly why H1/H2 exist as separate arms with the real hazard gate.
 *   - `validateAnswer` (deterministic floor) and `semanticSafetyCheck` (model
 *     judge) — the output-side `hazard_warning`/`energized_warning` banners.
 * This list is the deliverable the mission's PREREGISTRATION.md asks for
 * ("list every runtime directive you did NOT reproduce").
 *
 * ## Post-check and spend accounting
 * CORE's `capabilities/investigator/grounding.ts` and `.../budget.ts` landed
 * mid-build (after this lane's first draft, which had a bench-local fallback
 * post-check and its own pricing lookup for exactly this contingency — see
 * git history / PR diff if a prior revision of this file is visible). Both
 * are now imported directly: `ungroundedNumbers`/`unsafeInstructionPhrases`
 * for the post-check, `worstCaseUsd` for the ledger reservation. Nothing here
 * is a "pending" placeholder for those two modules any more.
 */

import { createHash } from "node:crypto";

import {
  BASE_SYSTEM_PROMPT,
  GENERAL_SYSTEM_PROMPT,
  buildProviderMessages,
  citationsUsedInAnswer,
} from "@/app/api/equipment-notebooks/[id]/chat/route";
import {
  retrieveNodeChunks,
  appendManualContext,
  buildManualUserContent,
  chunksToSources,
  displayPage,
  type ManualChunk,
} from "@/lib/manual-rag";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { EvidenceItem, SpendLedger, StopReason, SynthesisModel } from "@/capabilities/investigator/types";
// CORE lane (landed mid-build): the real deterministic post-checks. Reused
// here rather than re-implemented — `ungroundedNumbers`/`unsafeInstructionPhrases`
// are exactly the pair the mission brief named ("grounding.ts/unsafeInstructionPhrases").
import { ungroundedNumbers, unsafeInstructionPhrases } from "@/capabilities/investigator/grounding";
// CORE lane: the real worst-case cost estimator (chars/4 + 10% margin, at the
// Hub's own OpenAI list prices) — reused instead of single_pass.ts inventing
// its own pricing lookup, so H0's cost accounting matches H1/H2's exactly.
// `DEFAULT_PRICE_PER_MTOK_{IN,OUT}` are the SAME two constants `worstCaseUsd`
// is built on (budget.ts imports them from this module) — reused for the
// ACTUAL (unmargined) cost once real usage is known from the completion.
import { worstCaseUsd } from "@/capabilities/investigator/budget";
import { DEFAULT_PRICE_PER_MTOK_IN, DEFAULT_PRICE_PER_MTOK_OUT } from "@/capabilities/openai-run-budget";

/** Production value at the main retrieval call site (route.ts:2481 `topK: 6`). */
export const PRODUCTION_TOPK = 6;

const CHAT_ROUTE_SOURCE_PATH = "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts";
const BASE_SYSTEM_PROMPT_LINE = 325;
const GENERAL_SYSTEM_PROMPT_LINE = 411;

export interface LiftedPrompt {
  text: string;
  sha256: string;
  sourcePath: string;
  sourceLine: number;
}

/**
 * Lift the route's base system prompt VERBATIM — by importing the live
 * exported constant (never a hand-retyped copy), citing its path:line, and
 * hashing the exact text the model would receive in production for the same
 * `docGrounded` branch.
 */
export function liftSystemPrompt(docGrounded: boolean): LiftedPrompt {
  const text = docGrounded ? BASE_SYSTEM_PROMPT : GENERAL_SYSTEM_PROMPT;
  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    sourcePath: CHAT_ROUTE_SOURCE_PATH,
    sourceLine: docGrounded ? BASE_SYSTEM_PROMPT_LINE : GENERAL_SYSTEM_PROMPT_LINE,
  };
}

/** Deterministic post-check the caller may inject — defaults to the real
 *  CORE implementation (`defaultPostCheck` below). Kept as an injectable seam
 *  (not a hard-wired call) so a test can supply a fixed/fake post-check
 *  without depending on `grounding.ts`'s regex behavior. */
export type PostCheckFn = (
  answerText: string,
  evidence: EvidenceItem[],
) => { ungroundedNumbers: string[]; unsafePhrases: string[] };

/** The real post-check (CORE's `grounding.ts`, landed mid-build — see this
 *  file's header). A thin adapter: `grounding.ts` exposes two separate pure
 *  functions; H0's row schema wants them merged into one `{ungroundedNumbers,
 *  unsafePhrases}` shape, matching `InvestigationTrace.postCheck` (types.ts). */
export const defaultPostCheck: PostCheckFn = (answerText, evidence) => ({
  ungroundedNumbers: ungroundedNumbers(answerText, evidence),
  unsafePhrases: unsafeInstructionPhrases(answerText),
});

export interface SinglePassDeps {
  /** A `pg.Client`/`PoolClient` — passed through to `retrieveNodeChunks` with
   *  the same `as never` cast the pinned harness (bench/retrieval_dev.ts)
   *  uses, since `retrieveNodeChunks`'s real parameter type is the Hub's own
   *  `PoolClient` and a bench script connects with plain `pg.Client`. */
  dbClient: unknown;
  tenantId: string;
  nodeId: string;
  docIds: string[];
  identity?: { manufacturer: string | null; model: string | null } | null;
  model: SynthesisModel;
  ledger: SpendLedger;
  /** Default: production value (`PRODUCTION_TOPK` = 6). */
  topK?: number;
  maxOutputTokens?: number;
  postCheck?: PostCheckFn;
}

export interface SinglePassRow {
  /** H0 is free text (PREREGISTRATION.md §3): there is no structured `mode`. */
  mode: null;
  hypothesis: string | null;
  nextCheck: null;
  followUp: null;
  stopReason: StopReason;
  /** Pages the model's answer actually cited (via a `[n]` marker), per
   *  `citationsUsedInAnswer` — the SAME production filter, not a re-derivation. */
  citedPages: Array<number | null>;
  /** Pages of every chunk placed in front of the model, in retrieval order. */
  evidencePages: Array<number | null>;
  ungroundedNumbers: string[];
  unsafePhrases: string[];
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  trace: {
    arm: "H0";
    docGrounded: boolean;
    chunkCount: number;
    systemPromptSha256: string;
    systemPromptSourcePath: string;
    systemPromptSourceLine: number;
    reservationId: string | null;
  };
}

function emptyRow(stopReason: StopReason, trace: SinglePassRow["trace"]): SinglePassRow {
  return {
    mode: null,
    hypothesis: null,
    nextCheck: null,
    followUp: null,
    stopReason,
    citedPages: [],
    evidencePages: [],
    ungroundedNumbers: [],
    unsafePhrases: [],
    latencyMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    trace,
  };
}

/** Shared helper (also used by run_cases.ts's `createBenchTools`): map
 *  retrieved chunks onto the shared `EvidenceItem` contract (types.ts). */
export function chunksToEvidenceItems(chunks: ManualChunk[]): EvidenceItem[] {
  return chunks.map((c, i) => ({
    id: `${c.docId ?? c.sourceUrl ?? "unknown"}:${c.sourcePage ?? "null"}:${i}`,
    source: "manual",
    docId: c.docId ?? null,
    title: c.title,
    page: displayPage(c),
    text: c.content,
    toolCallIndex: 0,
  }));
}

/** Build the `EvidenceCitation[]` the production `citationsUsedInAnswer`
 *  expects, from `chunksToSources`'s numbering (the SAME numbering the model
 *  was shown via `buildManualUserContent`/`buildGroundedContext`) — never a
 *  re-derived numbering scheme. `docId` is best-effort (matched back to the
 *  first chunk sharing the source's url+page); not required for the
 *  citation-usage filter itself, which matches on `citationId`. */
function citationsFromChunks(chunks: ManualChunk[]): EvidenceCitation[] {
  const sources = chunksToSources(chunks);
  return sources.map((s) => {
    const match = chunks.find((c) => (c.sourceUrl || null) === s.url && displayPage(c) === s.page);
    return {
      citationId: String(s.index),
      docId: match?.docId ?? "",
      sourceTitle: s.title,
      page: s.page,
      fileId: null,
      quote: null,
    };
  });
}

/** Run arm H0 for one case: production retrieval (topK=6) + the route's own
 *  system/user prompt assembly + one model call + production-shaped citation
 *  extraction + a post-check (injected, or the bench-local default). */
export async function runSinglePassH0(
  question: { message: string },
  deps: SinglePassDeps,
): Promise<SinglePassRow> {
  const t0 = performance.now();
  const topK = deps.topK ?? PRODUCTION_TOPK;
  const maxOutputTokens = deps.maxOutputTokens ?? 900;
  const postCheck = deps.postCheck ?? defaultPostCheck;

  let chunks: ManualChunk[];
  try {
    chunks = await retrieveNodeChunks(deps.dbClient as never, deps.tenantId, question.message, {
      nodeId: deps.nodeId,
      unsPath: null,
      topK,
      docIds: deps.docIds,
      rawQuery: question.message,
      ...(deps.identity ? { identity: deps.identity } : {}),
      validatedDocScope: true,
      approvedSourceDocIds: deps.docIds,
    });
  } catch (err) {
    const trace: SinglePassRow["trace"] = {
      arm: "H0",
      docGrounded: false,
      chunkCount: 0,
      systemPromptSha256: "",
      systemPromptSourcePath: CHAT_ROUTE_SOURCE_PATH,
      systemPromptSourceLine: 0,
      reservationId: null,
    };
    const row = emptyRow("model_error", trace);
    row.latencyMs = performance.now() - t0;
    console.error("[single_pass] retrieval failed:", err instanceof Error ? err.message : err);
    return row;
  }

  const docGrounded = chunks.length > 0;
  const lifted = liftSystemPrompt(docGrounded);
  const systemPrompt = appendManualContext(lifted.text, chunks);
  const userContent = buildManualUserContent(question.message, chunks);
  // Same production assembly (route.ts:865 `buildProviderMessages`), with the
  // directives listed in this file's header intentionally omitted: empty
  // history, no prior-report context.
  const messages = buildProviderMessages(systemPrompt, [], userContent, "");
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? systemPrompt;
  const userMsg = messages.find((m) => m.role === "user" && m.content === userContent)?.content ?? userContent;

  const baseTrace: SinglePassRow["trace"] = {
    arm: "H0",
    docGrounded,
    chunkCount: chunks.length,
    systemPromptSha256: lifted.sha256,
    systemPromptSourcePath: lifted.sourcePath,
    systemPromptSourceLine: lifted.sourceLine,
    reservationId: null,
  };

  // CORE's own worst-case estimator (chars/4 input tokens + maxOutputTokens
  // output tokens, at the Hub's list prices, +10% margin) — same methodology
  // H1/H2 use via `investigate()`, so arms are cost-comparable apples-to-apples.
  const reservedUsd = worstCaseUsd(systemMsg.length + userMsg.length, maxOutputTokens);
  const reservationId = deps.ledger.reserve(reservedUsd, "H0 single-pass synthesis");
  if (!reservationId) {
    const row = emptyRow("budget_exhausted", baseTrace);
    row.evidencePages = chunks.map((c) => displayPage(c));
    row.latencyMs = performance.now() - t0;
    return row;
  }
  baseTrace.reservationId = reservationId;

  let completion: { text: string; inputTokens: number; outputTokens: number };
  try {
    completion = await deps.model.complete({ system: systemMsg, user: userMsg, maxOutputTokens });
  } catch (err) {
    deps.ledger.settle(reservationId, 0, { inputTokens: 0, outputTokens: 0 });
    const row = emptyRow("model_error", baseTrace);
    row.evidencePages = chunks.map((c) => displayPage(c));
    row.latencyMs = performance.now() - t0;
    console.error("[single_pass] model call failed:", err instanceof Error ? err.message : err);
    return row;
  }

  // Real (unmargined) cost at the SAME list prices `worstCaseUsd` uses.
  const actualUsd =
    (completion.inputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_IN + (completion.outputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_OUT;
  deps.ledger.settle(reservationId, actualUsd, {
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  });

  const citations = citationsFromChunks(chunks);
  const usedCitations = citationsUsedInAnswer(completion.text, citations);
  const citedPages = usedCitations.map((c) => c.page);
  const evidencePages = chunks.map((c) => displayPage(c));

  const evidenceItems = chunksToEvidenceItems(chunks);
  // Renamed from the post-check's own field names to avoid shadowing the
  // imported `ungroundedNumbers` function in this scope.
  const postCheckResult = postCheck(completion.text, evidenceItems);

  return {
    mode: null,
    hypothesis: completion.text || null,
    nextCheck: null,
    followUp: null,
    stopReason: "synthesized",
    citedPages,
    evidencePages,
    ungroundedNumbers: postCheckResult.ungroundedNumbers,
    unsafePhrases: postCheckResult.unsafePhrases,
    latencyMs: performance.now() - t0,
    costUsd: actualUsd,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    trace: baseTrace,
  };
}
