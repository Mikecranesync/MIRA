/**
 * Hub notebook-chat vocabulary → the shared interaction contract.
 *
 * The Hub already has one typed wire contract for the canonical conversation
 * backend (`POST /api/equipment-notebooks/[id]/chat`): the SSE frames in
 * `@/lib/notebook-chat-types` and the persisted-turn rows the GET route returns
 * (`notebook-chat-utils.ts`). The shared shell (`@factorylm/ui`) renders the
 * `InteractionPart` union from `packages/factorylm-interaction`. This module is
 * the ONE Hub-side mapping between them — the counterpart of mobile's
 * `src/unified/to-interaction.ts`, which maps the mobile chat-adapter vocabulary
 * onto the same union. It never touches transport, never invents evidence,
 * never upgrades provenance, and keeps the server's own words for labels.
 *
 * Trust rule: a visual observation from the chat route carries no verification
 * signal, so `verified` is always `false` here. The confirm/correct trust ladder
 * (visual-evidence-context, PR #3832/#3833) is a separate read the mount wires
 * when it is on main; this mapper must never claim it.
 */
import type {
  ContextSnapshot,
  EvidenceBasisKind,
  IdentityProposal,
  InteractionPart,
  InteractionThread,
  InteractionTurn,
  Lifecycle,
  ManualSearchStatus,
  SourceReference,
} from "../../../packages/factorylm-interaction/src";
import {
  fallbackSourceOf,
  groundingStatusOf,
  sameManufacturerModel,
  suppressesBasisLabel,
} from "../../../packages/factorylm-interaction/src";
import type {
  EvidenceCitation,
  MachineEvidenceEntry,
  SafetyNoticeEntry,
  VisualObservationEntry,
} from "@/lib/notebook-chat-types";
import { isMachineEvidenceEntry, isSafetyNoticeEntry, isVisualObservationEntry } from "@/lib/notebook-chat-types";
import { API_BASE } from "@/lib/config";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import type { PersistedTurn, StreamResult } from "@/components/equipment/notebook-chat-utils";
import { BASIS_LABEL, splitEvidence } from "@/components/equipment/notebook-chat-utils";

type StatusAwareStreamResult = StreamResult & { statusMessage?: string | null };

const GENERIC_ABSTENTION_COPY = "I couldn't find that in the selected sources.";
const PHOTO_ABSTENTION_COPY =
  "I saw your photo, but I couldn't find anything about it in the selected sources.";

/** What the host knows about the notebook it is rendering; the server owns every field. */
export interface HubNotebookMeta {
  readonly notebookId: string;
  readonly threadId?: string | null;
  readonly title: string;
  readonly tenantId?: string | null;
  /** Confirmed machine binding (`asset.entityId`), when the notebook has one. */
  readonly asset?: { readonly id: string; readonly name: string; readonly unsPath?: string | null } | null;
  /** `identityStatus === "user_confirmed" | "verified"` AND `asset.confirmedAt` set — never inferred client-side. */
  readonly identityConfirmed: boolean;
  /**
   * The notebook's CURRENT confirmed manufacturer+model — `identityStatus`
   * `user_confirmed`/`verified`, regardless of `asset` BINDING (a separate
   * concept `identity-proposal.ts`'s confirm route never creates;
   * `identityConfirmed` above also requires that binding). Settles a
   * persisted `identity_proposal` card that no longer matches the notebook's
   * current identity (light-review fix, PR #4195) — never read for
   * grounding/authorization, which stay `identityConfirmed`'s job. `null`/
   * omitted: not (yet) confirmed.
   */
  readonly confirmedIdentity?: { readonly manufacturer: string; readonly model: string } | null;
  /** The docIds of the notebook's own sources (not rejected). The basis chip
   *  names the notebook only for an answer whose citations are all among
   *  these; omitted, it never does (#4025, Codex #4301 F1). */
  readonly notebookDocIds?: readonly string[];
  /** One ISO timestamp per hydrate/turn; the caller passes it so tests stay deterministic. */
  readonly capturedAt: string;
}

export function threadIdFor(meta: HubNotebookMeta): string {
  return meta.threadId ?? `notebook-${meta.notebookId}:thread-legacy`;
}

export function projectIdFor(meta: HubNotebookMeta): string {
  return `project-${meta.notebookId}`;
}

export function contextFor(meta: HubNotebookMeta, identityDisputed = false): ContextSnapshot {
  const asset = meta.asset ?? null;
  const trusted = asset !== null && meta.identityConfirmed && !identityDisputed;
  return {
    tenantId: meta.tenantId ?? "tenant",
    projectId: projectIdFor(meta),
    ...(asset ? { machineId: asset.id } : {}),
    machineIdentity: asset ? (trusted ? "confirmed" : "unconfirmed") : "not_applicable",
    evidenceAuthorization: asset ? (trusted ? "authorized" : "not_authorized") : "not_applicable",
    capturedAt: meta.capturedAt,
  };
}

/** The server's basis enum (migration 084) mapped 1:1. An unknown value must
 *  never become a STRONGER claim, so unknown → general_reasoning. */
const BASIS_BY_VALUE: Readonly<Record<string, EvidenceBasisKind>> = {
  live_machine_evidence: "live_machine_evidence",
  machine_history: "machine_history",
  oem_documentation: "oem_documentation",
  workspace_evidence: "workspace_evidence",
  identified_component: "identified_component",
  general_reasoning: "general_reasoning",
};

export function basisKind(basis: string): EvidenceBasisKind {
  const normalized = basis.trim().toLowerCase().replace(/\s+/g, "_");
  return BASIS_BY_VALUE[normalized] ?? "general_reasoning";
}

/** One caption per shell basis kind — the classic notebook's wording. Typed
 *  against the SHELL's kind union, so a kind added there without a caption
 *  here fails to compile instead of rendering an undefined label. */
const BASIS_CAPTION: Readonly<Record<EvidenceBasisKind, string>> = BASIS_LABEL;

/** A documentation basis whose sources this adapter cannot place. */
const CITED_DOCUMENTATION_CAPTION = "Grounded in the cited documentation.";

/** True only when every citation is one of the notebook's own sources. The
 *  route sends `oem_documentation` for a shared-library answer as well
 *  (chat/route.ts `oemRetrieval`); only its frame label told the two apart,
 *  and that label never reaches this adapter. Library chunks carry no docId
 *  (manual-rag.ts `ManualChunk.docId`), so they can never match. */
function citesOnlyNotebookSources(citations: readonly EvidenceCitation[], notebookDocIds: readonly string[] | undefined): boolean {
  if (!notebookDocIds || citations.length === 0) return false;
  return citations.every((c) => c.docId !== "" && notebookDocIds.includes(c.docId));
}

/** The answer's basis chip. Its words are a caption for the kind (#4025: it
 *  read "● oem_documentation" under a technician's own cited upload), so an
 *  unknown value reads as general guidance, never as itself. A documentation
 *  basis names the notebook only when that is provable from the citations
 *  (Codex #4301 F1); otherwise it names no scope. `authorized` is
 *  server-owned; nothing here carries it. */
function basisPart(basis: string, citations: readonly EvidenceCitation[], notebookDocIds: readonly string[] | undefined): InteractionPart {
  const kind = basisKind(basis);
  const label = kind === "oem_documentation" && !citesOnlyNotebookSources(citations, notebookDocIds)
    ? CITED_DOCUMENTATION_CAPTION
    : BASIS_CAPTION[kind];
  return { type: "evidence_basis", basis: { kind, label, authorized: false } };
}

/**
 * A shell `SourceReference.id` is TURN-SCOPED (Codex #3839 F1). Citation numbers
 * restart at "1" in every answer, so a thread-wide id of "1" would make the
 * older answer's marker resolve to the newer answer's evidence. The number the
 * technician sees stays the citation's own (`AnswerMarkdown` matches markers
 * on `EvidenceCitation.citationId`); only the shell's identity is scoped.
 */
export function sourceIdFor(turnId: string, citationId: string): string {
  return `${turnId}:${citationId}`;
}

/** The assistant-turn id the mapper gives a persisted row (`turnsFromPersisted`). */
export function answerTurnId(rowId: string): string {
  return `${rowId}-a`;
}

/** The byte route that serves a parked original (photo or document) inline —
 *  the same door the classic notebook's photo thumbnail, its source page and
 *  the mobile file preview already use. */
export function fileUrl(fileId: string): string {
  return `${API_BASE}/api/namespace/files/${encodeURIComponent(fileId)}/`;
}

/** Where a citation opens, by the classic source page's rule
 *  ((hub)/equipment/[id]/source/[docId]): the canonical origin wins (085), so a
 *  photo-derived doc opens the photograph, which has no page; otherwise the
 *  doc's own parked file at its cited page; otherwise a manufacturer manual's
 *  own http(s) address. Undefined when there is nothing to open. */
export function citationHref(citation: EvidenceCitation): string | undefined {
  const page = citation.page ? `#page=${citation.page}` : "";
  if (citation.originFileId) return fileUrl(citation.originFileId);
  if (citation.fileId) return `${fileUrl(citation.fileId)}${page}`;
  const url = citation.sourceUrl ?? "";
  if (/^https?:\/\//i.test(url)) return url.includes("#") ? url : `${url}${page}`;
  return undefined;
}

/** The photo a question carried, as an attachment on the question turn itself. */
export function questionPhotoPart(entry: { fileId: string }): InteractionPart {
  return {
    type: "attachment",
    attachment: { id: entry.fileId, name: "Photo", mediaType: "image/*", kind: "photo", status: "ready", previewUrl: fileUrl(entry.fileId) },
  };
}

export function sourceFor(citation: EvidenceCitation, turnId: string): SourceReference {
  const page = citation.page ?? null;
  const locator = page !== null ? `p. ${page}` : citation.quote ? citation.quote.slice(0, 80) : "cited passage";
  const href = citationHref(citation);
  return {
    id: sourceIdFor(turnId, citation.citationId),
    title: citation.sourceTitle,
    kind: citation.fileId ? "workspace_file" : "oem_documentation",
    locator,
    ...(href ? { href } : {}),
  };
}

export function machineEvidencePart(entry: MachineEvidenceEntry): InteractionPart {
  const freshness = entry.freshness;
  return {
    type: "machine_evidence",
    evidence: {
      assetId: entry.assetId,
      anchorAt: entry.anchorAt,
      preSeconds: entry.pre,
      postSeconds: entry.post,
      rowCount: entry.rowCount,
      freshness,
      source: freshness === "live" ? "live" : "recorded",
      ...(entry.reason === "unavailable" ? { reason: "unavailable" as const } : {}),
    },
  };
}

export function visualObservationPart(entry: VisualObservationEntry): InteractionPart {
  return {
    type: "visual_observation",
    observation: { fileId: entry.fileId, capturedAt: entry.capturedAt, provenance: "phone_photo", verified: false, previewUrl: fileUrl(entry.fileId) },
  };
}

const SAFETY_STOP_MESSAGE =
  "Stop. This request involves a hazard. Follow the site lockout/tagout and safety procedure before proceeding; MIRA will not guide the unsafe step.";
const ELECTRICAL_DIRECTIVE_MESSAGE =
  "Energized electrical work: this answer is framed by the NFPA 70E directive. De-energize, lock out, and verify absence of voltage before any hands-on step.";

/**
 * The notebook route persists two kinds of `safety_notice` and discriminates
 * them with its OWN sentinel, not prose (chat/route.ts: `safetyTrigger ===
 * ENERGIZED_ELECTRICAL_HAZARD`): the energized-electrical DIRECTIVE, whose
 * answer still streams and completes, carries the sentinel as its trigger; a
 * terminal refusal (input-side hard stop, or an unsafe answer rejected by
 * output validation) carries the matched phrase / violation. Mirroring that
 * rule here keeps live and re-hydrated lifecycles identical (Codex #3839 round
 * 2 F1) and keeps refusal prose out of model history (F2).
 */
export function isTerminalSafetyNotice(entry: SafetyNoticeEntry): boolean {
  return entry.trigger !== ENERGIZED_ELECTRICAL_HAZARD;
}

/** Every `safety_notice` entry on a persisted row (a rejected unsafe answer can carry the directive AND the violation). */
export function safetyNoticesOf(evidence: readonly unknown[]): SafetyNoticeEntry[] {
  return evidence.filter(isSafetyNoticeEntry);
}

export function hasTerminalSafetyStop(evidence: readonly unknown[]): boolean {
  return safetyNoticesOf(evidence).some(isTerminalSafetyNotice);
}

export function safetyNoticePart(entry: SafetyNoticeEntry): InteractionPart {
  const terminal = isTerminalSafetyNotice(entry);
  return {
    type: "safety_notice",
    notice: {
      severity: terminal ? "stop" : "warning",
      message: terminal ? SAFETY_STOP_MESSAGE : ELECTRICAL_DIRECTIVE_MESSAGE,
      ...(entry.trigger ? { trigger: entry.trigger } : {}),
    },
  };
}

/** Persisted `{kind:"identity_dispute"}` marker (086 §3). `splitEvidence` drops
 *  it (no docId, not a typed entry it knows), so it is detected here. */
export function hasIdentityDispute(evidence: readonly unknown[]): boolean {
  return evidence.some(
    (e) => typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "identity_dispute",
  );
}

/**
 * The persisted `{kind:"identity_proposal", manufacturer, model, ...}` entry
 * (#4120/#4175), or null. `splitEvidence` drops it the same way it drops
 * `identity_dispute` — no `docId`, not a typed entry it knows — so it is read
 * straight off the raw evidence array here, same pattern as
 * `hasIdentityDispute` above. chat/route.ts persists this entry on EVERY
 * reply path (answered and abstained) so a reload renders the SAME confirm
 * card the live turn offered (T2 acceptance). The live-stream half (while a
 * turn is still in flight) is a narrower, accepted gap: `readNotebookStream`
 * / `StreamResult` (`mira-hub/src/components/equipment/notebook-chat-utils.ts`)
 * are guarded legacy presentation under the Unified UI Cutover and do not
 * carry this field — see the PR body for the BLOCKED note.
 */
export function identityProposalOf(evidence: readonly unknown[]): IdentityProposal | null {
  for (const e of evidence) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    if (r.kind !== "identity_proposal") continue;
    if (typeof r.manufacturer !== "string" || typeof r.model !== "string") continue;
    return {
      manufacturer: r.manufacturer,
      model: r.model,
      ...(typeof r.catalogNumber === "string" && r.catalogNumber ? { catalogNumber: r.catalogNumber } : {}),
    };
  }
  return null;
}

/**
 * A completed live stream → the assistant turn's parts, in the shell's order:
 * text, sources, basis, machine/visual evidence, safety, follow-ups, error.
 * Honesty rules carried from the classic web notebook:
 *  - `sawStatus === false` is a TRUNCATION: keep the partial text, claim
 *    nothing (no citations, no basis, no follow-ups) and end in an error part.
 *  - `status === "error"` with text is a stop; without text a provider failure.
 *  - `status === "insufficient_evidence"` renders the abstention text only.
 */
export function partsFromStream(result: StatusAwareStreamResult, opts: { stopped?: boolean; turnId: string; notebookDocIds?: readonly string[] }): InteractionPart[] {
  const parts: InteractionPart[] = [];
  const truncated = !result.sawStatus;
  const stopped = opts.stopped === true;
  const nonAnswer = truncated || stopped || result.status === "error";
  const text =
    result.content ||
    (!nonAnswer && result.status === "insufficient_evidence"
      ? result.statusMessage?.trim() || (result.visualEvidence ? PHOTO_ABSTENTION_COPY : GENERIC_ABSTENTION_COPY)
      : "");

  if (text) parts.push({ type: "text", text });
  // A safety frame is an authoritative server determination even when the
  // stream loses its terminal status. Preserve that warning while continuing
  // to suppress every evidence claim on the truncated path.
  if ((truncated || stopped) && result.safetyNotice) parts.push(safetyNoticePart(result.safetyNotice));

  if (!nonAnswer) {
    for (const c of result.citations) parts.push({ type: "source", source: sourceFor(c, opts.turnId) });
    if (result.basis) parts.push(basisPart(result.basis, result.citations, opts.notebookDocIds));
    if (result.machineEvidence) parts.push(machineEvidencePart(result.machineEvidence));
    if (result.visualEvidence) parts.push(visualObservationPart(result.visualEvidence));
    if (result.safetyNotice) parts.push(safetyNoticePart(result.safetyNotice));
    // #3841: the live directive arrives on the evidence frame as
    // `hazardNotice`; it classifies as a warning through the same rule the
    // hydrated row uses, so live and reloaded turns render identically.
    if (result.hazardNotice) parts.push(safetyNoticePart(result.hazardNotice));
    if (result.followups.length) parts.push({ type: "followups", suggestions: result.followups });
    return parts;
  }

  if (stopped) {
    parts.push({ type: "error", error: { code: "stopped", message: "Stopped before the answer completed.", retryable: false } });
  } else if (truncated) {
    parts.push({
      type: "error",
      error: { code: "provider_failure", message: "The answer ended before it completed.", retryable: true },
    });
  } else {
    parts.push({ type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: true } });
  }
  return parts;
}

/**
 * Lifecycle precedence: stopped > truncated/failed > safety_stop > completed.
 * `safety_stop` is FIRST-CLASS in the interaction contract (Codex #3839 F2): a
 * refusal on a hazardous request is not an answered turn, even though the
 * stream ended with an ordinary status frame, so completed-answer actions
 * (copy / regenerate / feedback) must not treat it as one.
 */
export function lifecycleFromStream(result: StreamResult, opts: { stopped?: boolean } = {}): Lifecycle {
  if (opts.stopped) return "stopped";
  if (!result.sawStatus) return "failed";
  if (result.status === "error") return "failed";
  return result.safetyNotice && isTerminalSafetyNotice(result.safetyNotice) ? "safety_stop" : "completed";
}

/**
 * A persisted turn keeps the machine context it was SERVED with, not the
 * notebook's current binding (Codex #3839 Spec P1: rebinding a notebook must
 * not make old turns appear to concern the new machine). The only durable
 * record of that context is the row's own `machine_evidence` (086): its
 * `assetId` names the machine the answer was grounded in. A row with none was
 * served without machine context and stays `not_applicable`. The binding is
 * called confirmed only when it is the notebook's CURRENT confirmed asset —
 * a row from a since-rebound machine is shown, never re-authorized.
 */
export function persistedMeta(
  meta: HubNotebookMeta,
  machineEvidence: readonly Pick<MachineEvidenceEntry, "assetId">[],
): HubNotebookMeta {
  const servedAssetId = machineEvidence[0]?.assetId ?? null;
  if (!servedAssetId) return { ...meta, asset: null, identityConfirmed: false };
  const current = meta.asset && meta.asset.id === servedAssetId ? meta.asset : null;
  return {
    ...meta,
    asset: current ?? { id: servedAssetId, name: servedAssetId },
    identityConfirmed: current !== null && meta.identityConfirmed,
  };
}

/** A persisted GET row → its two turns (question, answer). STOPPED-TURN CONTRACT
 *  (STRM-2): `answerStatus==="error"` with text is a stopped turn (partial shown,
 *  no citations/basis/evidence); with null text it is the provider-failure copy. */
export function turnsFromPersisted(
  row: PersistedTurn & { createdAt?: string },
  meta: HubNotebookMeta,
  /** F004: row ids whose general-guidance offer a later turn already used. */
  usedFallbacks: ReadonlySet<string> = new Set(),
): InteractionTurn[] {
  const at = row.createdAt ?? meta.capturedAt;
  const stopped = row.answerStatus === "error" && !!row.answerText;
  const disputed = hasIdentityDispute(row.evidence);
  const threadId = threadIdFor(meta);
  const { citations, machineEvidence, visualEvidence } = splitEvidence(row.evidence);
  const context = contextFor(persistedMeta(meta, machineEvidence), disputed);
  // All safety entries, not `splitEvidence`'s single slot: a rejected unsafe
  // answer persists the directive AND the violation, and the violation decides.
  const notices = safetyNoticesOf(row.evidence);
  const terminalStop = notices.some(isTerminalSafetyNotice);

  const question: InteractionTurn = {
    id: `${row.id}-q`,
    threadId,
    role: "user",
    // The technician's own photo shows on their own message, as in any chat app.
    parts: [{ type: "text", text: row.question }, ...visualEvidence.map(questionPhotoPart)],
    lifecycle: "completed",
    context,
    createdAt: at,
    updatedAt: at,
  };

  const answerId = answerTurnId(row.id);
  const parts: InteractionPart[] = [];
  // F004 (#4303): the server's own record of what this turn's evidence was —
  // only present when the flag is on AND this client declared the capability.
  const grounding = groundingStatusOf(row.evidence);
  const text =
    row.answerText ??
    (row.answerStatus === "error"
      ? ""
      : row.answerStatus === "insufficient_evidence" && visualEvidence.length > 0
        ? PHOTO_ABSTENTION_COPY
        : GENERIC_ABSTENTION_COPY);
  if (text) parts.push({ type: "text", text });
  if (disputed) parts.push({ type: "identity_dispute" });
  // T2 (#4175): rendered on EVERY reply path (chat/route.ts persists it that
  // way — "the client offers 'Use its manuals' / 'Not this' on an abstained
  // turn too, not only an answered one") — never gated by `stopped`/`error`.
  const proposal = identityProposalOf(row.evidence);
  if (proposal) {
    // Light-review fix (PR #4195): settle against the notebook's CURRENT
    // confirmed identity — `meta` (not `persistedMeta`'s served-context
    // variant used for `context` above), so a rebind AFTER this turn still
    // settles it correctly, never the frozen context this turn was served
    // with.
    const current = meta.confirmedIdentity ?? null;
    const priorOutcome = current ? (sameManufacturerModel(proposal, current) ? "confirmed" : "superseded") : undefined;
    parts.push({ type: "identity_proposal", ...proposal, ...(priorOutcome ? { priorOutcome } : {}) });
  }
  if (!stopped && row.answerStatus !== "error") {
    for (const c of citations) parts.push({ type: "source", source: sourceFor(c, answerId) });
    if (row.basis && !suppressesBasisLabel(grounding)) parts.push(basisPart(row.basis, citations, meta.notebookDocIds));
    for (const m of machineEvidence) parts.push(machineEvidencePart(m));
    for (const v of visualEvidence) parts.push(visualObservationPart(v));
    for (const n of notices) parts.push(safetyNoticePart(n));
  } else if (stopped) {
    parts.push({ type: "error", error: { code: "stopped", message: "Stopped before the answer completed.", retryable: false } });
  } else {
    parts.push({ type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: false } });
  }

  if (grounding) {
    parts.push({ type: "grounding_status", ...grounding, ...(usedFallbacks.has(row.id) ? { fallbackUsed: true } : {}) });
  }

  // Same precedence as `lifecycleFromStream`: a persisted TERMINAL refusal stays a
  // safety_stop; a directive-framed answer completed live and completes here too.
  const lifecycle: Lifecycle = stopped
    ? "stopped"
    : row.answerStatus === "error"
      ? "failed"
      : terminalStop
        ? "safety_stop"
        : "completed";
  const answer: InteractionTurn = {
    id: answerId,
    threadId,
    role: "assistant",
    parts,
    lifecycle,
    context,
    createdAt: at,
    updatedAt: at,
  };
  return [question, answer];
}

/**
 * T2 (#4189 F6) — overlay the notebook's CURRENT manual-search status (the
 * GET route's `manualSearch` field — `currentManualSearchStatus`, computed
 * FRESH on every read, never persisted on a turn) onto the LAST assistant
 * turn's parts, mirroring where the live SSE stream pairs it with that
 * turn's own `identity_proposal` card. This is the "post-turn refresh"
 * render path the PR body's BLOCKED note names: the Hub's live, in-flight
 * stream (`notebook-chat-utils.ts`, guarded legacy presentation) cannot carry
 * this status while a turn is still streaming, so it appears here, once the
 * send completes and `hub-host.tsx` re-loads detail — not before.
 * `status: null` (no acquisition running/recorded, or the flag is off)
 * returns the turns unchanged.
 */
export function withManualSearchStatus(
  turns: readonly InteractionTurn[],
  status: ManualSearchStatus | null,
): InteractionTurn[] {
  if (!status) return [...turns];
  let lastAssistantIndex = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i]!.role === "assistant") lastAssistantIndex = i;
  }
  if (lastAssistantIndex === -1) return [...turns];
  const part: InteractionPart = {
    type: "manual_search_status",
    manufacturer: status.manufacturer,
    model: status.model,
    running: status.running,
    ...(status.message ? { message: status.message } : {}),
  };
  return turns.map((t, i) => (i === lastAssistantIndex ? { ...t, parts: [...t.parts, part] } : t));
}

export function threadFromPersisted(
  rows: readonly (PersistedTurn & { createdAt?: string })[],
  meta: HubNotebookMeta,
): InteractionThread {
  const usedFallbacks = new Set(rows.map((r) => fallbackSourceOf(r.evidence)).filter((id): id is string => id !== null));
  const turns = rows.flatMap((row) => turnsFromPersisted(row, meta, usedFallbacks));
  return {
    id: threadIdFor(meta),
    tenantId: meta.tenantId ?? "tenant",
    projectId: projectIdFor(meta),
    notebookId: meta.notebookId,
    ...(meta.asset ? { primaryAssetId: meta.asset.id } : {}),
    title: meta.title,
    mode: "ask",
    visibility: "workspace",
    turns,
    createdAt: rows[0]?.createdAt ?? meta.capturedAt,
    updatedAt: rows[rows.length - 1]?.createdAt ?? meta.capturedAt,
  };
}

/** Citation lookup so the host's own viewer can open the real `EvidenceCitation`
 *  (docId + page + fileId) behind a shell `source` part's id. Keys are the
 *  TURN-SCOPED ids `sourceFor` mints (Codex #3839 F1), so two answers that both
 *  cite "[1]" keep their own evidence and a streaming answer's "[1]" never
 *  replaces a persisted one. `liveTurnId` is the assistant-turn id the host
 *  gives the in-flight exchange; live citations are ignored without it. */
export function citationIndex(
  rows: readonly PersistedTurn[],
  live: readonly EvidenceCitation[] = [],
  liveTurnId: string | null = null,
): ReadonlyMap<string, EvidenceCitation> {
  const index = new Map<string, EvidenceCitation>();
  for (const row of rows) {
    const turnId = answerTurnId(row.id);
    for (const c of splitEvidence(row.evidence).citations) index.set(sourceIdFor(turnId, c.citationId), c);
  }
  if (liveTurnId) for (const c of live) index.set(sourceIdFor(liveTurnId, c.citationId), c);
  return index;
}

// Re-exported so the host does not reach into two modules for the guards.
export { isMachineEvidenceEntry, isSafetyNoticeEntry, isVisualObservationEntry };
