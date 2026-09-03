/**
 * Equipment Notebook chat — the ONE typed SSE frame contract shared by the
 * route and the client (closes the untyped-frame gap: NodeChat duplicates
 * ad-hoc shapes on both sides).
 *
 * Wire format: `data: <json>\n\n` frames on text/event-stream, terminated by
 * the literal `data: [DONE]`. Real order on an answered turn:
 * `content`* → [`photo_read`] → `sources` → `evidence` → [`usage`] → `status`
 * → [`followups`]. `photo_read` rides only under NOTEBOOK_PHOTO_REREAD_ENABLED.
 * `sources` arrives AFTER the content deltas (citations are filtered to the
 * [n] the answer actually used), so a client must buffer content and attach
 * citations when `sources` lands. Abstain: `sources` (empty) → `status`.
 * Safety: `sources` (empty) → `content`* → `safety` → `status`.
 *
 * STOPPED-TURN CONTRACT (STRM-2, no schema change — `answer_status` is the
 * three-value CHECK from migration 073; a first-class 'stopped' value would
 * need a migration and is Mike's call, mira-hub-migrations rule 8):
 *   - Client-stopped turn (request signal aborted / response cancelled):
 *     the server persists `answer_status='error'`, `answer_text` = the
 *     content streamed so far (or NULL if nothing streamed), `evidence=[]`,
 *     `basis=NULL`. No further frames are written; no fallback provider runs.
 *   - Provider/cascade failure (every provider failed, or an internal error):
 *     the server persists `answer_status='error'` with `answer_text=NULL` —
 *     NEVER the partial text a failed provider may have streamed before it
 *     died. The wire still ends `sources`(empty) → `evidence` → [`usage`] →
 *     `status: error` → `[DONE]`.
 * So the client rule, applied identically live and on reload (hydration):
 *   `answer_status==='error' && answer_text` non-empty ⇒ render the partial
 *     with the "Stopped" caption, no citations, no follow-ups, and EXCLUDE
 *     it from the history sent to the server;
 *   `answer_status==='error' && answer_text` null ⇒ the existing error copy.
 */

export type EvidenceCitation = {
  citationId: string; // "1", "2", ... matches [n] markers in the answer text
  docId: string;
  sourceTitle: string;
  page: number | null;
  /** namespace_direct_uploads id — byte-serving door for the viewer; null when
   *  the original file was not parked (chunks-only doc). */
  fileId: string | null;
  /** Canonical ORIGIN file this doc was derived from (085) — e.g. the
   *  nameplate photograph behind a materialized nameplate text doc. The
   *  technician-facing "original". Null/absent for ordinary uploads (the
   *  doc's own file IS the original) and on pre-085 persisted turns (the
   *  read path enriches those server-side). */
  originFileId?: string | null;
  /**
   * Set to `"live_photo_read"` ONLY when this citation's text was transcribed
   * off the attached PHOTOGRAPH by a vision reader during THIS turn
   * (`notebook-photo-reread.ts`, behind NOTEBOOK_PHOTO_REREAD_ENABLED) — as
   * opposed to retrieved from an indexed document.
   *
   * WHY A FIELD AND NOT A PATTERN OVER `sourceTitle`. Constraint: a
   * vision-derived claim must be distinguishable from a manual-derived one, and
   * that discriminator has to be durable. Making a client regex human-facing
   * copy ("Photo: … (read on request)") breaks the first time the copy is
   * reworded, and the failure mode is a transcription silently rendering as an
   * OEM citation. ABSENT on every other citation, so a flag-off turn serializes
   * byte-identically.
   */
  provenance?: "live_photo_read";
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
  /** Sensor REPLAY (contract §4.4, D5): the machine window this turn was
   *  grounded on. Additive — same frame kind, so FRAME_KINDS is untouched and
   *  older clients simply ignore the field. */
  machineEvidence?: MachineEvidenceEntry;
  /** Sensor LOOK (S5 D3 cross-lane contract): the verified phone photo this
   *  turn was asked with. Additive, same discipline as `machineEvidence`. */
  visualEvidence?: VisualObservationEntry;
};

/**
 * Machine evidence attached to a turn (Sensor REPLAY, contract §4.4 / D5).
 * Rides INSIDE the turn's existing `evidence[]` JSONB next to
 * `EvidenceCitation` entries, discriminated by `kind` — no new table, no new
 * frame kind. It is NOT a citation: it never carries a `docId`, never appears
 * in `sources.citations` or `sourceSnapshot`, and every `evidence[]` reader
 * that assumes `{docId}` must skip it (enrichCitationsWithOrigin / listTurns
 * do; `persistedTurns` on web splits it out).
 */
export type MachineEvidenceEntry = {
  kind: "machine_evidence";
  assetId: string;
  /** Canonical ISO anchor (the fault time the window is centred on). */
  anchorAt: string;
  pre: number;
  post: number;
  /** Recorded observations in the window — the "N observed changes" count. */
  rowCount: number;
  /** Roll-up of the asset's CURRENT signals when the turn was served. */
  freshness: "live" | "stale" | "simulated" | "unknown";
  runId?: string | null;
  windowId?: string | null;
  /**
   * Why the window is empty, when it is (contract §2.8 honesty). Present ONLY
   * as `"unavailable"` — the machine-history tables (033/037) are missing in
   * this environment, so nothing COULD be observed. Absent with `rowCount: 0`
   * means the opposite and equally honest thing: the tables are there and the
   * window was genuinely quiet.
   *
   * Cross-lane contract (same spelling as `AssetHistory.reason` in
   * mira-mobile/src/lib/replay.ts, which the phone already reads off
   * GET /api/assets/[id]/history):
   *   `reason === "unavailable"` → "Machine history unavailable"
   *   `rowCount === 0` (no reason) → "No machine changes recorded in this window"
   * Neither ever renders as "0 observed changes", and neither carries a
   * machine `basis` — the server leaves the turn on the basis it would have
   * had without the selection.
   */
  reason?: "unavailable" | null;
};

/** Type guard: an `evidence[]` entry that is machine evidence, not a citation. */
export function isMachineEvidenceEntry(e: unknown): e is MachineEvidenceEntry {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "machine_evidence" &&
    typeof (e as { anchorAt?: unknown }).anchorAt === "string"
  );
}

/**
 * Visual observation attached to a turn (Sensor LOOK, S5 D3 cross-lane
 * contract). The client sends `{fileId, capturedAt}`; the SERVER verifies the
 * file is a workspace file linked to THIS notebook (workspace_file_links,
 * same tenant) and re-derives the entry — an unverified/foreign fileId is
 * ignored silently, never a 4xx. Rides INSIDE `evidence[]` next to citations
 * and machine entries, discriminated by `kind`. It is NOT a citation: no
 * `docId`, never in `sources.citations` / `sourceSnapshot`, never changes
 * `basis`. Readers that assume `{docId}` skip it.
 */
export type VisualObservationEntry = {
  kind: "visual_observation";
  /** namespace_direct_uploads id — the byte-serving door for the thumbnail. */
  fileId: string;
  /** Server-normalized ISO (the phone's capture time, re-serialized). */
  capturedAt: string;
  provenance: "phone_photo";
};

/** Type guard: an `evidence[]` entry that is a visual observation. */
export function isVisualObservationEntry(e: unknown): e is VisualObservationEntry {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "visual_observation" &&
    typeof (e as { fileId?: unknown }).fileId === "string" &&
    typeof (e as { capturedAt?: unknown }).capturedAt === "string"
  );
}

/**
 * Safety hard-stop marker persisted INSIDE `evidence[]` so a reloaded turn is
 * distinguishable from an ordinary `answered` turn on hydration.
 *
 * Rides INSIDE the turn's existing `evidence[]` JSONB, discriminated by `kind`.
 * It is NOT a citation: no `docId`, never in `sources.citations` or
 * `sourceSnapshot`. Every `evidence[]` reader that assumes `{docId}` already
 * skips it — `enrichCitationsWithOrigin` checks `typeof c.docId === "string"`;
 * `splitEvidence` checks `isMachineEvidenceEntry`, `isVisualObservationEntry`,
 * and then `docId`. The marker is additive: existing clients that only know
 * citations will silently drop it; clients that know the type can restore the
 * safety warning on reload.
 *
 * No migration required — `evidence` is an existing `jsonb` column with no
 * per-entry schema enforcement (migration 073 defines the COLUMN, not entries).
 */
export type SafetyNoticeEntry = {
  kind: "safety_notice";
  /** The matched phrase, for observability. Same value as `NotebookSafetyFrame.trigger`. */
  trigger: string;
};

/** Type guard: an `evidence[]` entry that is a safety-stop marker. */
export function isSafetyNoticeEntry(e: unknown): e is SafetyNoticeEntry {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "safety_notice" &&
    typeof (e as { trigger?: unknown }).trigger === "string"
  );
}

/**
 * A photograph attached to this notebook was RE-READ by a vision model during
 * this turn (NOTEBOOK_PHOTO_REREAD_ENABLED; `notebook-photo-reread.ts`).
 *
 * Emitted immediately before `sources`, and ONLY under the flag — a flag-off
 * turn never carries it, which is what keeps the wire byte-identical. Additive,
 * same precedent as `usage` and `safety`: older clients ignore unknown kinds.
 *
 *   state "read"        — a vision reader looked at the picture. `found:false`
 *                         means it looked and the detail was not legible; that
 *                         is a stronger, more honest statement than "I have no
 *                         photo", and the UI may say so.
 *   state "skipped"     — the stored extraction already covered the question,
 *                         so no vision call was made (`reason` says which).
 *   state "unavailable" — a read was wanted but did not happen (not configured,
 *                         timed out, provider error, or the file was not
 *                         authorized for this notebook). The turn answers as it
 *                         would have with the flag off. NEVER a sight claim.
 */
export type NotebookPhotoReadFrame = {
  kind: "photo_read";
  state: "read" | "skipped" | "unavailable";
  found?: boolean;
  filename?: string;
  reason?: string;
};

export type NotebookChatFrame =
  | NotebookSourcesFrame
  | NotebookContentFrame
  | NotebookStatusFrame
  | NotebookSafetyFrame
  | NotebookUsageFrame
  | NotebookEvidenceFrame
  | NotebookPhotoReadFrame
  | NotebookFollowupsFrame;

/** Deterministic follow-up suggestions (notebook-followups.ts) — emitted after
 *  `status` on answered turns only; each string is a complete question the
 *  client may send verbatim as the next user turn. Additive: clients that
 *  don't know the kind ignore it. */
export type NotebookFollowupsFrame = { kind: "followups"; suggestions: string[] };

const FRAME_KINDS = new Set([
  "sources",
  "content",
  "status",
  "safety",
  "usage",
  "evidence",
  "photo_read",
  "followups",
]);

export function parseFrame(data: string): NotebookChatFrame | null {
  try {
    const obj = JSON.parse(data);
    // Every kind in the union passes through. This list previously stopped at
    // the original three, which silently dropped `evidence` (the live basis
    // badge on web never fired) — keep it in lockstep with NotebookChatFrame.
    if (obj && FRAME_KINDS.has(obj.kind)) {
      return obj as NotebookChatFrame;
    }
    return null;
  } catch {
    return null;
  }
}
