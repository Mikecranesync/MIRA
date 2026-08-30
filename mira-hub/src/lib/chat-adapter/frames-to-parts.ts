/**
 * Frame → canonical-part translation (pure, unit-testable). Phase 0 spike,
 * criterion 1 (hydrate a persisted thread) + criterion 4 (structured events,
 * unknown-frame tolerance) + criterion 6 (live/hydrated parity) of
 * docs/plans/2026-08-30-chatgpt-class-ui-spike-plan.md.
 *
 * REUSES the shipped semantics rather than re-implementing them:
 * - wire parsing:      `parseFrame` (src/lib/notebook-chat-types.ts)
 * - hydration:         `persistedTurns` / `splitEvidence`
 *                      (src/components/equipment/notebook-chat-utils.ts)
 * - stopped-turn rule:  STRM-2 (error + non-empty text ⇒ stopped)
 */
import {
  isMachineEvidenceEntry,
  isVisualObservationEntry,
  parseFrame,
  type EvidenceCitation,
  type MachineEvidenceEntry,
  type NotebookChatFrame,
  type NotebookUsageFrame,
  type VisualObservationEntry,
} from "@/lib/notebook-chat-types";
import {
  persistedTurns,
  type PersistedTurn,
} from "@/components/equipment/notebook-chat-utils";
import type { AdapterMessage, MessagePart } from "./contract";

/** One parsed SSE transcript: typed frames in order, plus every frame the
 *  contract version didn't recognize (preserved, inspectable — PRD §9.2). */
export type ParsedTranscript = {
  frames: NotebookChatFrame[];
  unknown: unknown[];
};

/**
 * Split a raw `text/event-stream` body into frames, exactly as
 * `readNotebookStream` does (`\n\n` frame separator, `data:` prefix,
 * literal `[DONE]` terminator) — but keep unknown-kind frames instead of
 * dropping them, so the UI can prove the unknown-part rule.
 */
export function parseSseTranscript(raw: string): ParsedTranscript {
  const out: ParsedTranscript = { frames: [], unknown: [] };
  for (const line of raw.split("\n\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;
    const frame = parseFrame(data);
    if (frame) {
      out.frames.push(frame);
      continue;
    }
    try {
      out.unknown.push(JSON.parse(data));
    } catch {
      out.unknown.push(data);
    }
  }
  return out;
}

/** Accumulated result of folding a frame sequence — the same fields
 *  `readNotebookStream` accumulates, plus safety/usage/unknown. */
export type FrameFold = {
  content: string;
  citations: EvidenceCitation[];
  status: "answered" | "insufficient_evidence" | "error";
  basis: string | null;
  basisLabel: string | null;
  followups: string[];
  machineEvidence: MachineEvidenceEntry | null;
  visualEvidence: VisualObservationEntry | null;
  safetyTrigger: string | null;
  usage: Omit<NotebookUsageFrame, "kind"> | null;
  unknown: unknown[];
};

export function foldFrames(parsed: ParsedTranscript): FrameFold {
  const fold: FrameFold = {
    content: "",
    citations: [],
    status: "answered",
    basis: null,
    basisLabel: null,
    followups: [],
    machineEvidence: null,
    visualEvidence: null,
    safetyTrigger: null,
    usage: null,
    unknown: [...parsed.unknown],
  };
  for (const frame of parsed.frames) {
    if (frame.kind === "content") fold.content += frame.content;
    else if (frame.kind === "sources") fold.citations = frame.citations;
    else if (frame.kind === "status") fold.status = frame.status;
    else if (frame.kind === "safety") fold.safetyTrigger = frame.trigger;
    else if (frame.kind === "followups") fold.followups = frame.suggestions;
    else if (frame.kind === "usage") {
      const usage: Record<string, unknown> = { ...frame };
      delete usage.kind;
      fold.usage = usage as FrameFold["usage"];
    } else if (frame.kind === "evidence") {
      fold.basis = frame.basis;
      fold.basisLabel = frame.label;
      fold.machineEvidence = isMachineEvidenceEntry(frame.machineEvidence)
        ? frame.machineEvidence
        : null;
      fold.visualEvidence = isVisualObservationEntry(frame.visualEvidence)
        ? frame.visualEvidence
        : null;
    }
  }
  return fold;
}

/** A COMPLETED live assistant turn (stream reached `status` + `[DONE]`). */
export function liveAssistantMessage(id: string, fold: FrameFold): AdapterMessage {
  const parts: MessagePart[] = [];
  if (fold.safetyTrigger !== null) {
    parts.push({ type: "safety_notice", trigger: fold.safetyTrigger });
  }
  parts.push({
    type: "text",
    text: fold.content,
    knownCitationIds: fold.citations.map((c) => c.citationId),
  });
  for (const citation of fold.citations) parts.push({ type: "source", citation });
  if (fold.machineEvidence) parts.push({ type: "machine_evidence", entry: fold.machineEvidence });
  if (fold.visualEvidence) parts.push({ type: "observation", entry: fold.visualEvidence });
  if (fold.basis) parts.push({ type: "basis", basis: fold.basis, label: fold.basisLabel });
  if (fold.usage) parts.push({ type: "usage", usage: fold.usage });
  if (fold.followups.length) parts.push({ type: "followups", suggestions: fold.followups });
  if (fold.status === "error") {
    parts.push({ type: "error", reason: fold.content ? "stopped" : "provider_failure" });
  }
  for (const raw of fold.unknown) parts.push({ type: "unknown", raw });
  return {
    id,
    role: "assistant",
    parts,
    lifecycle: fold.status === "error" ? (fold.content ? "stopped" : "failed") : "completed",
    status: fold.status,
  };
}

/**
 * A live turn the user STOPPED mid-stream (abort fired before `status`).
 * STRM-2: the partial stays, no citations / basis / follow-ups — a stopped
 * answer is not an answer. Mirrors `stoppedTurn` in notebook-chat-utils.
 */
export function stoppedAssistantMessage(id: string, partial: string): AdapterMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: partial, knownCitationIds: [] },
      { type: "error", reason: "stopped" },
    ],
    lifecycle: "stopped",
    status: "error",
  };
}

/**
 * Criterion 1: persisted rows → canonical messages. Delegates the
 * stopped/failed disambiguation and evidence splitting to the shipped
 * `persistedTurns` (single source of truth), then maps to parts.
 */
export function hydrateMessages(rows: PersistedTurn[]): AdapterMessage[] {
  return persistedTurns(rows).map((t): AdapterMessage => {
    if (t.role === "user") {
      return {
        id: t.id,
        role: "user",
        parts: [{ type: "text", text: t.content, knownCitationIds: [] }],
        lifecycle: "completed",
        status: null,
      };
    }
    const parts: MessagePart[] = [
      {
        type: "text",
        text: t.content,
        knownCitationIds: (t.citations ?? []).map((c) => c.citationId),
      },
    ];
    for (const citation of t.citations ?? []) parts.push({ type: "source", citation });
    for (const entry of t.machineEvidence ?? []) parts.push({ type: "machine_evidence", entry });
    for (const entry of t.visualEvidence ?? []) parts.push({ type: "observation", entry });
    if (t.basis) parts.push({ type: "basis", basis: t.basis, label: null });
    if (t.status === "error") {
      parts.push({ type: "error", reason: t.stopped ? "stopped" : "provider_failure" });
    }
    return {
      id: t.id,
      role: "assistant",
      parts,
      lifecycle: t.stopped ? "stopped" : t.status === "error" ? "failed" : "completed",
      status: t.status ?? null,
    };
  });
}

/**
 * Criterion 6 comparison projection: the fields that MUST be identical
 * between a live-rendered turn and the same turn rehydrated from the server.
 * (Live-only ephemera — usage, followups, basis label, safety trigger — are
 * excluded because the server does not persist them today; those gaps are
 * recorded in ADR-0038, not papered over here.)
 */
export function comparableProjection(msg: AdapterMessage): {
  role: string;
  text: string;
  lifecycle: string;
  status: string | null;
  citations: EvidenceCitation[];
  machineEvidence: MachineEvidenceEntry[];
  visualEvidence: VisualObservationEntry[];
  basis: string | null;
} {
  const parts = msg.parts;
  return {
    role: msg.role,
    text: parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(""),
    lifecycle: msg.lifecycle,
    status: msg.status,
    citations: parts
      .filter((p): p is Extract<MessagePart, { type: "source" }> => p.type === "source")
      .map((p) => p.citation),
    machineEvidence: parts
      .filter((p): p is Extract<MessagePart, { type: "machine_evidence" }> => p.type === "machine_evidence")
      .map((p) => p.entry),
    visualEvidence: parts
      .filter((p): p is Extract<MessagePart, { type: "observation" }> => p.type === "observation")
      .map((p) => p.entry),
    basis:
      (parts.find((p) => p.type === "basis") as { basis?: string } | undefined)?.basis ?? null,
  };
}
