/**
 * Recorded-shape SSE transcripts for the chat-adapter spike (criteria 1/4/6).
 * Frame order and semantics follow the contract header in
 * src/lib/notebook-chat-types.ts verbatim:
 *   answered: content* → sources → evidence → [usage] → status → [followups]
 *   abstain:  sources(empty) → status
 *   safety:   sources(empty) → content* → safety → status
 * plus the STRM-2 stopped/failed persisted shapes.
 */
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";

const f = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const DONE = "data: [DONE]\n\n";

export const CITATIONS = [
  {
    citationId: "1",
    docId: "doc-gs10-manual",
    sourceTitle: "GS10 Drive User Manual",
    page: 42,
    fileId: "file-gs10",
    quote: "Fault oC indicates output overcurrent during acceleration.",
  },
  {
    citationId: "2",
    docId: "doc-gs10-manual",
    sourceTitle: "GS10 Drive User Manual",
    page: 57,
    fileId: "file-gs10",
    quote: "Check motor lead insulation before resetting the fault.",
  },
];

/** Answered turn, two citations used, OEM basis, usage + follow-ups. */
export const ANSWERED_TRANSCRIPT =
  f({ kind: "content", content: "The oC fault is an output overcurrent" }) +
  f({ kind: "content", content: " during acceleration [1]." }) +
  f({ kind: "content", content: " Check the motor leads before resetting [2]." }) +
  f({ kind: "sources", citations: CITATIONS, sourceSnapshot: ["doc-gs10-manual"] }) +
  f({ kind: "evidence", basis: "oem_documentation", label: "Grounded in OEM documentation" }) +
  f({
    kind: "usage",
    provider: "groq",
    model: "llama-3.3-70b",
    routeReason: "primary",
    inputTokens: 1200,
    cachedInputTokens: null,
    outputTokens: 180,
    costUsdEstimate: null,
    status: "ok",
  }) +
  f({ kind: "status", status: "answered" }) +
  f({ kind: "followups", suggestions: ["What causes repeated oC faults?"] }) +
  DONE;

/** Abstain: refusal carries zero citations, insufficient_evidence status. */
export const ABSTAIN_TRANSCRIPT =
  f({ kind: "sources", citations: [], sourceSnapshot: ["doc-gs10-manual"] }) +
  f({ kind: "status", status: "insufficient_evidence" }) +
  DONE;

/** Safety hard-stop: notice text streamed, safety frame, then answered status
 *  (per the contract: the technician DID receive the intended response). */
export const SAFETY_TRANSCRIPT =
  f({ kind: "sources", citations: [], sourceSnapshot: [] }) +
  f({ kind: "content", content: "STOP. De-energize and lock out the drive before opening the cabinet." }) +
  f({ kind: "safety", trigger: "arc flash" }) +
  f({ kind: "status", status: "answered" }) +
  DONE;

/** Provider failure: wire still closes sources(empty) → status error, no text. */
export const PROVIDER_ERROR_TRANSCRIPT =
  f({ kind: "sources", citations: [], sourceSnapshot: ["doc-gs10-manual"] }) +
  f({ kind: "status", status: "error" }) +
  DONE;

/** Client stop: content deltas only — the abort fired before sources/status. */
export const STOPPED_PARTIAL_TRANSCRIPT =
  f({ kind: "content", content: "The oC fault is an output overcurrent" }) +
  f({ kind: "content", content: " during accel" });

export const MACHINE_EVIDENCE_ENTRY = {
  kind: "machine_evidence" as const,
  assetId: "asset-cv101",
  anchorAt: "2026-08-28T14:03:00.000Z",
  pre: 120,
  post: 120,
  rowCount: 7,
  freshness: "stale" as const,
  runId: "run-91",
  windowId: "win-14",
};

/** Answered REPLAY turn grounded on a recorded machine window. */
export const MACHINE_EVIDENCE_TRANSCRIPT =
  f({ kind: "content", content: "Around 14:03 the DC bus dipped before the trip [1]." }) +
  f({ kind: "sources", citations: [CITATIONS[0]], sourceSnapshot: ["doc-gs10-manual"] }) +
  f({
    kind: "evidence",
    basis: "machine_history",
    label: "Grounded in recorded machine history",
    machineEvidence: MACHINE_EVIDENCE_ENTRY,
  }) +
  f({ kind: "status", status: "answered" }) +
  DONE;

/** A future frame kind this contract version does not know (PRD §9.2). */
export const UNKNOWN_FRAME_TRANSCRIPT =
  f({ kind: "content", content: "Answer text." }) +
  f({ kind: "hologram", payload: { x: 1 } }) +
  f({ kind: "sources", citations: [], sourceSnapshot: [] }) +
  f({ kind: "status", status: "answered" }) +
  DONE;

/** The same conversation as persisted rows (GET hydration shape), covering
 *  answered-with-citations, stopped-partial, abstain, machine evidence. */
export const PERSISTED_ROWS: PersistedTurn[] = [
  {
    id: "t1",
    question: "What does the oC fault on the GS10 mean?",
    answerStatus: "answered",
    answerText:
      "The oC fault is an output overcurrent during acceleration [1]. Check the motor leads before resetting [2].",
    evidence: CITATIONS,
    basis: "oem_documentation",
  },
  {
    id: "t2",
    question: "Tell me everything about the drive",
    answerStatus: "error",
    answerText: "The oC fault is an output overcurrent during accel",
    evidence: [],
    basis: null,
  },
  {
    id: "t3",
    question: "What is the torque spec for the terminal screws?",
    answerStatus: "insufficient_evidence",
    answerText: null,
    evidence: [],
    basis: null,
  },
  {
    id: "t4",
    question: "What happened around 14:03?",
    answerStatus: "answered",
    answerText: "Around 14:03 the DC bus dipped before the trip [1].",
    evidence: [CITATIONS[0], MACHINE_EVIDENCE_ENTRY],
    basis: "machine_history",
  },
];
