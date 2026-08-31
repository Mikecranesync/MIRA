// Pure SSE frame parser for the Hub chat endpoints. Actual wire order:
// content* → sources → evidence → [usage] → status → [followups] → [DONE].
// One incremental parser (`createChatSseParser`) owns the frame semantics;
// `parseChatSse` is the one-shot convenience over it, so a streamed turn
// (STRM-1) and a buffered turn are byte-identical by construction.

import { machineEvidenceEntries, type MachineEvidenceEntry } from "./replay";
import { visualObservationEntries, type VisualObservationEntry } from "./sensor";

export interface ChatCitation {
  citationId: string;
  sourceTitle: string;
  page?: number | null;
  /** 240-char cited passage from the server's sources frame (CIT-07: the
   *  tap-a-chip trust feature renders this). */
  quote?: string | null;
  docId?: string | null;
  /** Workspace file the cited chunk came from — the door to "Open original at
   *  cited page" (`/api/namespace/files/{fileId}/`). Present on live sources
   *  frames AND on persisted turn evidence; never invented client-side. */
  fileId?: string | null;
  /** Canonical ORIGIN file the cited doc was DERIVED from (server-resolved,
   *  085) — the nameplate photograph behind a materialized text doc. When
   *  present, THIS is the technician's original; `fileId` is the derived
   *  sidecar. Null/absent for ordinary uploads. */
  originFileId?: string | null;
}

export interface ChatTurn {
  answer: string;
  citations: ChatCitation[];
  status: string;
  /** Evidence basis (spec 1.3). Absent on older servers -> render nothing
   *  rather than guessing; an unlabelled answer must never be presented as
   *  grounded. */
  evidenceBasis?: string;
  /** One-sentence caption the server supplies for the badge. */
  evidenceLabel?: string;
  /** Deterministic follow-up questions (CONV-4) — answered turns only. */
  followups?: string[];
  /** Sensor REPLAY (D5): `{kind:"machine_evidence"}` entries the server put
   *  in the turn's evidence[] and echoed on the existing `evidence` frame.
   *  Absent on servers that predate it; never inferred. */
  machineEvidence?: MachineEvidenceEntry[];
  /** Sensor LOOK (S5 D3): `{kind:"visual_observation"}` entries the server
   *  re-derived from `body.visualEvidence` and echoed on the same `evidence`
   *  frame. Never a citation. Absent = none. */
  visualEvidence?: VisualObservationEntry[];
  /** Safety hard-stop (hub `{kind:"safety", trigger}` frame): the streamed
   *  content is an isolation/LOTO notice, not an answer, and the UI must
   *  render it distinctly (PRD §9.2 safety_notice). The trigger phrase is
   *  observability-only — never shown to the technician. Previously this
   *  frame was silently dropped, which erased the safety identity of the
   *  turn on every surface. Absent = no safety stop. */
  safetyTrigger?: string;
  /** Frames whose `kind` this parser version does not know (PRD §9.2
   *  unknown-part rule): preserved for inspection, never a crash, never
   *  rendered as content. `usage` is known-and-ignored, not unknown. */
  unknownFrames?: unknown[];
  /**
   * Did the authoritative `status` frame actually arrive?
   *
   * The ONLY trustworthy terminal marker on this wire is the `status` frame —
   * `[DONE]` is not modelled as one, and a closed body is not one either. A
   * stream that dies after `sources` (server crash, proxy timeout, dropped
   * connection) otherwise folds into a turn that carries answer text AND
   * citations and is indistinguishable from a completed answer: a fabricated
   * completion (PRD §10.9) and a client inferring terminal state the server
   * never sent (PRD §7.6). Consumers MUST treat `sawStatus === false` as a
   * truncated turn — no citations, no basis, not an answer.
   *
   * Only ever `false` (present) when the frame was absent, so an existing
   * consumer comparing whole turns is unaffected on the healthy path.
   */
  sawStatus?: false;
}

/** Explicit field-by-field mapping so a new server field is a deliberate
 *  addition here, not an accident of casting — and so `fileId` (the
 *  open-the-original door) can never be silently dropped. */
export function normalizeCitations(raw: unknown): ChatCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      // A `{kind:"machine_evidence"}` entry (D5) shares the array but is not
      // a citation: no citationId, so it is skipped here by construction and
      // read by `machineEvidenceEntries` instead.
      (c): c is Record<string, unknown> =>
        typeof c === "object" && c !== null && "citationId" in c,
    )
    .map((c) => ({
      citationId: String(c.citationId),
      sourceTitle: String(c.sourceTitle ?? "Attached document"),
      page: typeof c.page === "number" ? c.page : null,
      quote: typeof c.quote === "string" ? c.quote : null,
      docId: c.docId != null ? String(c.docId) : null,
      fileId: c.fileId != null ? String(c.fileId) : null,
      originFileId: c.originFileId != null ? String(c.originFileId) : null,
    }));
}

/** Incremental SSE parser. Feed raw body chunks in any split (mid-line,
 *  mid-frame, mid-terminator); `turn()` returns the state so far, so the UI can
 *  re-render on every `content` frame; `finish()` flushes a trailing frame
 *  that never got its blank-line terminator. Same frame semantics as the
 *  old one-shot parse — that function is now implemented on top of this. */
export interface ChatSseParser {
  push(chunk: string): ChatTurn;
  finish(): ChatTurn;
  turn(): ChatTurn;
}

export function createChatSseParser(httpStatus = 200): ChatSseParser {
  let answer = "";
  let citations: ChatCitation[] = [];
  let status = httpStatus === 200 ? "" : `http ${httpStatus}`;
  let evidenceBasis: string | undefined;
  let followups: string[] | undefined;
  let evidenceLabel: string | undefined;
  let machineEvidence: MachineEvidenceEntry[] | undefined;
  let visualEvidence: VisualObservationEntry[] | undefined;
  let safetyTrigger: string | undefined;
  let unknownFrames: unknown[] | undefined;
  let sawStatus = false;
  let buffer = "";

  const applyBlock = (block: string) => {
    const line = block.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    try {
      const frame = JSON.parse(payload) as Record<string, unknown>;
      if (frame.kind === "content") answer += String(frame.content ?? "");
      else if (frame.kind === "sources")
        citations = normalizeCitations(frame.citations);
      else if (frame.kind === "status") {
        status = String(frame.status ?? "");
        sawStatus = true;
      }
      else if (frame.kind === "followups") {
        followups = Array.isArray(frame.suggestions)
          ? (frame.suggestions as unknown[]).map(String)
          : undefined;
      } else if (frame.kind === "evidence") {
        evidenceBasis = String(frame.basis ?? "");
        evidenceLabel = String(frame.label ?? "");
        // Same frame kind (no new SSE frame, D5). The Hub puts the entry on
        // the frame as ONE object (`machineEvidence: {kind:"machine_evidence",…}`,
        // chat/route.ts evidenceFrame) and, additively, the LOOK photo the
        // same way (`visualEvidence: {kind:"visual_observation",…}`); an
        // echoed evidence[] array is also read. Every carrier is flattened
        // and each entry goes to its own reader by `kind` — so a visual entry
        // riding in the machine field (or vice versa) is still found.
        const carried: unknown[] = [];
        for (const raw of [frame.machineEvidence, frame.visualEvidence, frame.evidence, frame.entries]) {
          if (raw == null) continue;
          if (Array.isArray(raw)) carried.push(...raw);
          else carried.push(raw);
        }
        const entries = machineEvidenceEntries(carried);
        if (entries.length) machineEvidence = entries;
        const visual = visualObservationEntries(carried);
        if (visual.length) visualEvidence = visual;
      } else if (frame.kind === "safety") {
        safetyTrigger = String(frame.trigger ?? "");
      } else if (frame.kind !== "usage") {
        // `usage` is known-and-deliberately-ignored (telemetry only). Any
        // OTHER kind is a future frame: keep it inspectable (PRD §9.2).
        (unknownFrames ??= []).push(frame);
      }
    } catch {
      /* keep parsing subsequent frames */
    }
  };

  const turn = (): ChatTurn => ({
    answer,
    citations,
    status,
    evidenceBasis,
    evidenceLabel,
    followups,
    ...(machineEvidence ? { machineEvidence } : {}),
    ...(visualEvidence ? { visualEvidence } : {}),
    ...(safetyTrigger !== undefined ? { safetyTrigger } : {}),
    ...(unknownFrames ? { unknownFrames } : {}),
    // Present ONLY when the authoritative terminal frame never arrived.
    ...(sawStatus ? {} : { sawStatus: false as const }),
  });

  return {
    push(chunk) {
      buffer += chunk;
      // A frame is complete only at its blank-line terminator; whatever
      // follows the last one stays buffered for the next chunk.
      let i: number;
      while ((i = buffer.indexOf("\n\n")) !== -1) {
        applyBlock(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
      }
      return turn();
    },
    finish() {
      if (buffer.length) {
        applyBlock(buffer);
        buffer = "";
      }
      return turn();
    },
    turn,
  };
}

export function parseChatSse(body: string, httpStatus = 200): ChatTurn {
  const p = createChatSseParser(httpStatus);
  p.push(body);
  return p.finish();
}
