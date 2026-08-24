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

/**
 * What kind of evidence this answer rests on — the evidence ladder from the
 * technician-app spec §1.3.
 *
 * The technician must never have to guess whether "check the DC bus capacitors"
 * came from the drive's manual or from the model's general knowledge of drives.
 * Both are legitimate; presenting them identically is not.
 *
 * Only `general_reasoning` and `oem_documentation` are emitted today. The rest
 * are declared here so the ladder has one vocabulary from the start rather than
 * a second one bolted on when machine history and live signals arrive.
 */
export type EvidenceBasis =
  | "general_reasoning"
  | "identified_component"
  | "oem_documentation"
  | "workspace_evidence"
  | "machine_history"
  | "live_machine_evidence";

/**
 * Emitted once per turn, before `status`, naming the answer's evidentiary
 * basis. Additive: existing clients ignore unknown frame kinds, which is the
 * precedent `usage` and `safety` set — no migration, no coordinated release.
 *
 * A `general_reasoning` turn MUST carry zero citations. That invariant is what
 * keeps the universal door from quietly becoming a way to launder model
 * reasoning as an OEM citation (spec §1.3, §1.4).
 */
export type NotebookEvidenceFrame = {
  kind: "evidence";
  basis: EvidenceBasis;
  /** One short sentence the UI may render verbatim as a badge/caption. */
  label: string;
};

export type NotebookChatFrame =
  | NotebookSourcesFrame
  | NotebookContentFrame
  | NotebookStatusFrame
  | NotebookSafetyFrame
  | NotebookUsageFrame
  | NotebookEvidenceFrame;

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
