/**
 * Equipment Notebook chat — the ONE typed SSE frame contract shared by the
 * route and the client (closes the untyped-frame gap: NodeChat duplicates
 * ad-hoc shapes on both sides).
 *
 * Wire format: `data: <json>\n\n` frames on text/event-stream, terminated by
 * the literal `data: [DONE]`. The evidence frame is emitted FIRST so the UI
 * can render citations while the answer streams.
 */

export type EvidenceCitation = {
  citationId: string; // "1", "2", ... matches [n] markers in the answer text
  docId: string;
  sourceTitle: string;
  page: number | null;
  /** namespace_direct_uploads id — byte-serving door for the viewer; null when
   *  the original file was not parked (chunks-only doc). */
  fileId: string | null;
  quote: string | null;
  /** Room for richer selectors later without changing the API shape (PRD §14). */
  selector?: { type: "page" | "text" | "bbox" | "section"; value: unknown };
};

export type NotebookSourcesFrame = {
  kind: "sources";
  citations: EvidenceCitation[];
  /** Snapshot of the doc ids this turn was allowed to use (auditability). */
  sourceSnapshot: string[];
};

export type NotebookContentFrame = { kind: "content"; content: string };

export type NotebookStatusFrame = {
  kind: "status";
  status: "answered" | "insufficient_evidence" | "error";
  message?: string;
};

/**
 * Per-turn spend (canonical seam only, MIRA_CANONICAL_SEAM=1). Mirrors
 * migration 078's decision_traces columns so persistence needs no reshape.
 * Existing clients ignore unknown frame kinds, so this is additive.
 */
export type NotebookUsageFrame = {
  kind: "usage";
  provider: string | null;
  model: string | null;
  routeReason: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /** Estimate, not billing truth. null (never 0) when the provider is unpriced. */
  costUsdEstimate: number | null;
  status: "ok" | "empty" | "error" | "capped";
};

/**
 * A safety hard-stop occurred: the turn was refused before retrieval and before
 * any provider call, and the streamed content is the isolation/LOTO notice
 * rather than an answer.
 *
 * WHY A FRAME AND NOT A NEW `status` VALUE. `status` is a three-value union
 * pinned by the `equipment_notebook_turns.answer_status` CHECK constraint
 * (migration 073), and every client switches on it. Adding a fourth value would
 * mean a migration plus a coordinated client release to say something additive.
 * A new frame kind costs nothing — existing clients ignore unknown kinds, which
 * is the precedent the `usage` frame set. The turn still reports
 * `status: "answered"` because the technician did receive a complete, intended
 * response; this frame is what distinguishes it from a grounded answer.
 */
export type NotebookSafetyFrame = {
  kind: "safety";
  /** The matched phrase, for observability. Never shown to the technician. */
  trigger: string;
};

export type NotebookChatFrame =
  | NotebookSourcesFrame
  | NotebookContentFrame
  | NotebookStatusFrame
  | NotebookSafetyFrame
  | NotebookUsageFrame;

export function parseFrame(data: string): NotebookChatFrame | null {
  try {
    const obj = JSON.parse(data);
    if (obj && (obj.kind === "sources" || obj.kind === "content" || obj.kind === "status")) {
      return obj as NotebookChatFrame;
    }
    return null;
  } catch {
    return null;
  }
}
