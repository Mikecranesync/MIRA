/**
 * Chat-adapter canonical part contract (PRD §9 — ChatGPT-class UI, Phase 0
 * compatibility spike; docs/prd/2026-08-30-chatgpt-class-ui-prd.md).
 *
 * This is the ADAPTER's vocabulary, not a new wire format: the wire stays the
 * ONE typed SSE frame dialect in `src/lib/notebook-chat-types.ts` (ADR-0038),
 * and this module translates frames/persisted rows into these parts so the
 * conversation UI (assistant-ui, ADR-0039) never sees library- or
 * route-specific shapes.
 *
 * Contract version: bump when a part's shape changes incompatibly. Unknown
 * part types must be preserved and inspectable, never a crash (PRD §9.2).
 */
import type {
  EvidenceBasis,
  EvidenceCitation,
  MachineEvidenceEntry,
  NotebookUsageFrame,
  VisualObservationEntry,
} from "@/lib/notebook-chat-types";

export const CHAT_ADAPTER_CONTRACT_VERSION = 1;

/** Streamed or completed answer/user text. `knownCitationIds` gates which
 *  literal [n] markers may render as chips — an unknown [7] stays literal
 *  text, never a dead chip (inventory §5). */
export type TextPart = {
  type: "text";
  text: string;
  knownCitationIds: string[];
};

/** Structured citation (never parsed from display text — PRD §12.3). */
export type SourcePart = {
  type: "source";
  citation: EvidenceCitation;
};

/** Recorded machine window evidence (REPLAY). Never coerced into `source`;
 *  freshness/reason strings are a frozen cross-lane contract
 *  (mira-mobile/src/lib/replay.ts) and render verbatim. */
export type MachineEvidencePart = {
  type: "machine_evidence";
  entry: MachineEvidenceEntry;
};

/** Verified phone-photo observation (LOOK) — distinct from inference. */
export type ObservationPart = {
  type: "observation";
  entry: VisualObservationEntry;
};

/** Safety hard-stop notice. Live: from the `safety` frame. Persisted: absent
 *  today (known gap, inventory §5 / ADR-0038 item 3) — the part exists so the
 *  UI renders it distinctly whenever the data can express it. */
export type SafetyNoticePart = {
  type: "safety_notice";
  /** Matched trigger phrase — observability only, never rendered. */
  trigger: string | null;
};

/** Evidentiary basis badge for the whole turn (evidence ladder). */
export type BasisPart = {
  type: "basis";
  basis: EvidenceBasis | (string & {});
  label: string | null;
};

/** Typed terminal error. `stopped` disambiguates the STRM-2 overload:
 *  answer_status='error' + non-empty text ⇒ user stop; + null text ⇒ failure. */
export type ErrorPart = {
  type: "error";
  reason: "stopped" | "provider_failure";
};

/** Per-turn spend/model metadata (canonical seam only). */
export type UsagePart = {
  type: "usage";
  usage: Omit<NotebookUsageFrame, "kind">;
};

/** Deterministic follow-up suggestions (answered turns only). */
export type FollowupsPart = {
  type: "followups";
  suggestions: string[];
};

/** A frame kind this contract version doesn't know. Preserved for inspection
 *  (dev panel), rendered as nothing — never a crash (PRD §9.2). */
export type UnknownPart = {
  type: "unknown";
  raw: unknown;
};

export type MessagePart =
  | TextPart
  | SourcePart
  | MachineEvidencePart
  | ObservationPart
  | SafetyNoticePart
  | BasisPart
  | ErrorPart
  | UsagePart
  | FollowupsPart
  | UnknownPart;

/** Lifecycle (PRD §9.3). The server owns terminal state; `queued`/`running`/
 *  `stopping` exist only on live in-flight messages and are never persisted
 *  (they are client fictions today — inventory §7.7 — surfaced honestly here). */
export type MessageLifecycle =
  | "queued"
  | "running"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type AdapterMessage = {
  /** Persisted: `<rowId>-q` / `<rowId>-a` (same scheme as persistedTurns).
   *  Live: client-generated until the wire carries turn IDs (ADR-0038 item 1). */
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  lifecycle: MessageLifecycle;
  /** Terminal answer_status as persisted, when known. */
  status: "answered" | "insufficient_evidence" | "error" | null;
};

export function textOf(msg: AdapterMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function citationsOf(msg: AdapterMessage): EvidenceCitation[] {
  return msg.parts
    .filter((p): p is SourcePart => p.type === "source")
    .map((p) => p.citation);
}
