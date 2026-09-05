/**
 * Chat-adapter canonical part contract — MOBILE lane (ADR-0039; PRD §9.2,
 * docs/prd/2026-08-30-chatgpt-class-ui-prd.md). Mirrors
 * mira-hub/src/lib/chat-adapter/contract.ts: same part vocabulary, same
 * message shape, so the two apps' adapters stay pin-compatible (a shared
 * fixture corpus can assert identical part JSON — ADR-0039 drift guard).
 *
 * This is the ADAPTER's vocabulary, not a wire format: the wire stays the
 * typed SSE frame dialect parsed ONLY by `src/lib/sse.ts` (one-canonical-
 * parser rule — no UI surface may add a raw SSE parser).
 */
import type { ChatCitation } from "../lib/sse";
import type { MachineEvidenceEntry } from "../lib/replay";
import type { VisualObservationEntry } from "../lib/sensor";

export const CHAT_ADAPTER_CONTRACT_VERSION = 1;

/** Streamed or completed answer/user text. `knownCitationIds` gates which
 *  literal [n] markers may render as chips — an unknown [7] stays literal. */
export type TextPart = {
  type: "text";
  text: string;
  knownCitationIds: string[];
};

/** Structured citation — never parsed from display text (PRD §12.3). */
export type SourcePart = {
  type: "source";
  citation: ChatCitation;
};

/** Recorded machine window (REPLAY). Never coerced into `source`; the
 *  freshness/reason strings are the frozen cross-lane contract in
 *  src/lib/replay.ts and render verbatim. */
export type MachineEvidencePart = {
  type: "machine_evidence";
  entry: MachineEvidenceEntry;
};

/** Verified phone-photo observation (LOOK) — distinct from inference. */
export type ObservationPart = {
  type: "observation";
  entry: VisualObservationEntry;
};

/** Safety hard-stop notice from a live `safety` frame or persisted
 *  `{kind:"safety_notice"}` evidence marker (ADR-0038 item 3). */
export type SafetyNoticePart = {
  type: "safety_notice";
  /** Matched trigger phrase — observability only, never rendered. */
  trigger: string | null;
};

/** Evidentiary basis badge for the turn (evidence ladder, spec §1.3). */
export type BasisPart = {
  type: "basis";
  basis: string;
  label: string | null;
};

/** Typed terminal error. STRM-2 disambiguation: `stopped` = the user
 *  aborted (partial kept); `provider_failure` = the server failed. */
export type ErrorPart = {
  type: "error";
  reason: "stopped" | "provider_failure";
};

/** Deterministic follow-up suggestions (answered turns only, CONV-4). */
export type FollowupsPart = {
  type: "followups";
  suggestions: string[];
};

/** A frame/evidence entry this contract version doesn't know. Preserved
 *  for inspection, rendered as nothing — never a crash (PRD §9.2). */
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
  | FollowupsPart
  | UnknownPart;

/** Lifecycle (PRD §9.3). `running` exists only on the live in-flight
 *  message; the server owns terminal state. */
export type MessageLifecycle =
  | "running"
  | "completed"
  | "stopped"
  | "failed";

export type AdapterMessage = {
  /** Persisted: `<rowId>-q` / `<rowId>-a` (persistedTurns id scheme).
   *  Live: `live-<i>-q` / `live-<i>-a`; pending: `pending-q`/`pending-a`. */
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  lifecycle: MessageLifecycle;
  /** Terminal answer_status as the server/parser reported it, when known. */
  status: string | null;
};

export function textOf(msg: AdapterMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function citationsOf(msg: AdapterMessage): ChatCitation[] {
  return msg.parts
    .filter((p): p is SourcePart => p.type === "source")
    .map((p) => p.citation);
}
