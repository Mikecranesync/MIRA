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
  InteractionPart,
  InteractionThread,
  InteractionTurn,
  Lifecycle,
  SourceReference,
} from "../../../packages/factorylm-interaction/src";
import type {
  EvidenceCitation,
  MachineEvidenceEntry,
  SafetyNoticeEntry,
  VisualObservationEntry,
} from "@/lib/notebook-chat-types";
import { isMachineEvidenceEntry, isSafetyNoticeEntry, isVisualObservationEntry } from "@/lib/notebook-chat-types";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import type { PersistedTurn, StreamResult } from "@/components/equipment/notebook-chat-utils";
import { splitEvidence } from "@/components/equipment/notebook-chat-utils";

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

export function sourceFor(citation: EvidenceCitation, turnId: string): SourceReference {
  const page = citation.page ?? null;
  const locator = page !== null ? `p. ${page}` : citation.quote ? citation.quote.slice(0, 80) : "cited passage";
  return {
    id: sourceIdFor(turnId, citation.citationId),
    title: citation.sourceTitle,
    kind: citation.fileId ? "workspace_file" : "oem_documentation",
    locator,
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
    observation: { fileId: entry.fileId, capturedAt: entry.capturedAt, provenance: "phone_photo", verified: false },
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
 * A completed live stream → the assistant turn's parts, in the shell's order:
 * text, sources, basis, machine/visual evidence, safety, follow-ups, error.
 * Honesty rules carried from the classic web notebook:
 *  - `sawStatus === false` is a TRUNCATION: keep the partial text, claim
 *    nothing (no citations, no basis, no follow-ups) and end in an error part.
 *  - `status === "error"` with text is a stop; without text a provider failure.
 *  - `status === "insufficient_evidence"` renders the abstention text only.
 */
export function partsFromStream(result: StatusAwareStreamResult, opts: { stopped?: boolean; turnId: string }): InteractionPart[] {
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
    if (result.basis) {
      // `authorized` is server-owned; the stream carries no such signal, so it is never asserted.
      parts.push({ type: "evidence_basis", basis: { kind: basisKind(result.basis), label: result.basis, authorized: false } });
    }
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
export function turnsFromPersisted(row: PersistedTurn & { createdAt?: string }, meta: HubNotebookMeta): InteractionTurn[] {
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
    parts: [{ type: "text", text: row.question }],
    lifecycle: "completed",
    context,
    createdAt: at,
    updatedAt: at,
  };

  const answerId = answerTurnId(row.id);
  const parts: InteractionPart[] = [];
  const text =
    row.answerText ??
    (row.answerStatus === "error"
      ? ""
      : row.answerStatus === "insufficient_evidence" && visualEvidence.length > 0
        ? PHOTO_ABSTENTION_COPY
        : GENERIC_ABSTENTION_COPY);
  if (text) parts.push({ type: "text", text });
  if (disputed) parts.push({ type: "identity_dispute" });
  if (!stopped && row.answerStatus !== "error") {
    for (const c of citations) parts.push({ type: "source", source: sourceFor(c, answerId) });
    if (row.basis) {
      parts.push({ type: "evidence_basis", basis: { kind: basisKind(row.basis), label: row.basis, authorized: false } });
    }
    for (const m of machineEvidence) parts.push(machineEvidencePart(m));
    for (const v of visualEvidence) parts.push(visualObservationPart(v));
    for (const n of notices) parts.push(safetyNoticePart(n));
  } else if (stopped) {
    parts.push({ type: "error", error: { code: "stopped", message: "Stopped before the answer completed.", retryable: false } });
  } else {
    parts.push({ type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: false } });
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

export function threadFromPersisted(
  rows: readonly (PersistedTurn & { createdAt?: string })[],
  meta: HubNotebookMeta,
): InteractionThread {
  const turns = rows.flatMap((row) => turnsFromPersisted(row, meta));
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
