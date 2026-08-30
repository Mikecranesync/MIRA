/**
 * Spike criteria proven here (docs/plans/2026-08-30-chatgpt-class-ui-spike-plan.md):
 * - Criterion 1: persisted thread → canonical parts (hydration).
 * - Criterion 4: structured source/evidence events arrive typed; an unknown
 *   frame kind is preserved and inspectable, never a crash.
 * - Criterion 6 (translation half): a live-folded turn and its rehydrated
 *   persisted row project to identical comparable state.
 * - STRM-2: stopped vs provider-failure disambiguation matches the shipped rule.
 */
import { describe, expect, it } from "vitest";
import {
  comparableProjection,
  foldFrames,
  hydrateMessages,
  liveAssistantMessage,
  parseSseTranscript,
  stoppedAssistantMessage,
} from "../frames-to-parts";
import { citationsOf, textOf } from "../contract";
import {
  ABSTAIN_TRANSCRIPT,
  ANSWERED_TRANSCRIPT,
  CITATIONS,
  MACHINE_EVIDENCE_ENTRY,
  MACHINE_EVIDENCE_TRANSCRIPT,
  PERSISTED_ROWS,
  PROVIDER_ERROR_TRANSCRIPT,
  SAFETY_TRANSCRIPT,
  STOPPED_PARTIAL_TRANSCRIPT,
  UNKNOWN_FRAME_TRANSCRIPT,
} from "../__fixtures__/transcripts";

describe("parseSseTranscript", () => {
  it("splits frames exactly like readNotebookStream and keeps unknown kinds", () => {
    const parsed = parseSseTranscript(UNKNOWN_FRAME_TRANSCRIPT);
    expect(parsed.frames.map((frame) => frame.kind)).toEqual(["content", "sources", "status"]);
    expect(parsed.unknown).toEqual([{ kind: "hologram", payload: { x: 1 } }]);
  });

  it("ignores the [DONE] terminator and non-data lines", () => {
    const parsed = parseSseTranscript("noise\n\n" + ANSWERED_TRANSCRIPT);
    expect(parsed.frames.at(-1)?.kind).toBe("followups");
    expect(parsed.unknown).toEqual([]);
  });
});

describe("liveAssistantMessage (criterion 4)", () => {
  it("answered turn: text + typed sources + basis + usage + followups", () => {
    const msg = liveAssistantMessage("a1", foldFrames(parseSseTranscript(ANSWERED_TRANSCRIPT)));
    expect(msg.lifecycle).toBe("completed");
    expect(msg.status).toBe("answered");
    expect(textOf(msg)).toContain("output overcurrent");
    expect(citationsOf(msg)).toEqual(CITATIONS);
    const text = msg.parts.find((p) => p.type === "text");
    expect(text && "knownCitationIds" in text ? text.knownCitationIds : []).toEqual(["1", "2"]);
    expect(msg.parts.some((p) => p.type === "basis" && p.basis === "oem_documentation")).toBe(true);
    expect(msg.parts.some((p) => p.type === "usage")).toBe(true);
    expect(msg.parts.some((p) => p.type === "followups")).toBe(true);
  });

  it("abstain turn carries zero citations and insufficient_evidence status", () => {
    const msg = liveAssistantMessage("a2", foldFrames(parseSseTranscript(ABSTAIN_TRANSCRIPT)));
    expect(msg.status).toBe("insufficient_evidence");
    expect(citationsOf(msg)).toEqual([]);
    expect(msg.lifecycle).toBe("completed");
  });

  it("safety turn renders a safety_notice part BEFORE the text part", () => {
    const msg = liveAssistantMessage("a3", foldFrames(parseSseTranscript(SAFETY_TRANSCRIPT)));
    expect(msg.parts[0]).toEqual({ type: "safety_notice", trigger: "arc flash" });
    expect(textOf(msg)).toMatch(/^STOP\./);
    expect(msg.status).toBe("answered");
  });

  it("machine evidence arrives as a machine_evidence part, never a source", () => {
    const msg = liveAssistantMessage(
      "a4",
      foldFrames(parseSseTranscript(MACHINE_EVIDENCE_TRANSCRIPT)),
    );
    const machine = msg.parts.filter((p) => p.type === "machine_evidence");
    expect(machine).toEqual([{ type: "machine_evidence", entry: MACHINE_EVIDENCE_ENTRY }]);
    expect(citationsOf(msg)).toEqual([CITATIONS[0]]);
  });

  it("unknown frames become inspectable unknown parts, not a crash", () => {
    const msg = liveAssistantMessage("a5", foldFrames(parseSseTranscript(UNKNOWN_FRAME_TRANSCRIPT)));
    expect(msg.parts.some((p) => p.type === "unknown")).toBe(true);
    expect(msg.lifecycle).toBe("completed");
  });

  it("STRM-2: status error + no text is a provider failure", () => {
    const msg = liveAssistantMessage(
      "a6",
      foldFrames(parseSseTranscript(PROVIDER_ERROR_TRANSCRIPT)),
    );
    expect(msg.lifecycle).toBe("failed");
    expect(msg.parts.some((p) => p.type === "error" && p.reason === "provider_failure")).toBe(true);
  });
});

describe("stoppedAssistantMessage (STRM-2)", () => {
  it("keeps the partial, carries no citations, lifecycle stopped", () => {
    const fold = foldFrames(parseSseTranscript(STOPPED_PARTIAL_TRANSCRIPT));
    const msg = stoppedAssistantMessage("s1", fold.content);
    expect(textOf(msg)).toBe("The oC fault is an output overcurrent during accel");
    expect(citationsOf(msg)).toEqual([]);
    expect(msg.lifecycle).toBe("stopped");
    expect(msg.status).toBe("error");
  });
});

describe("hydrateMessages (criterion 1)", () => {
  const messages = hydrateMessages(PERSISTED_ROWS);

  it("emits a user + assistant message per row with the persistedTurns id scheme", () => {
    expect(messages).toHaveLength(8);
    expect(messages.map((m) => m.id)).toEqual([
      "t1-q", "t1-a", "t2-q", "t2-a", "t3-q", "t3-a", "t4-q", "t4-a",
    ]);
  });

  it("answered row: citations + basis survive hydration", () => {
    const a1 = messages[1];
    expect(citationsOf(a1)).toEqual(CITATIONS);
    expect(a1.parts.some((p) => p.type === "basis" && p.basis === "oem_documentation")).toBe(true);
    expect(a1.lifecycle).toBe("completed");
  });

  it("stopped row: partial text, zero citations, stopped lifecycle", () => {
    const a2 = messages[3];
    expect(textOf(a2)).toBe("The oC fault is an output overcurrent during accel");
    expect(citationsOf(a2)).toEqual([]);
    expect(a2.lifecycle).toBe("stopped");
    expect(a2.parts.some((p) => p.type === "error" && p.reason === "stopped")).toBe(true);
  });

  it("machine-evidence row: entry splits out of evidence[], never a citation", () => {
    const a4 = messages[7];
    expect(citationsOf(a4)).toEqual([CITATIONS[0]]);
    expect(a4.parts.filter((p) => p.type === "machine_evidence")).toEqual([
      { type: "machine_evidence", entry: MACHINE_EVIDENCE_ENTRY },
    ]);
  });

  it("full-thread part snapshot (criterion 1 regression pin)", () => {
    expect(messages).toMatchSnapshot();
  });
});

describe("live/hydrated parity (criterion 6, translation half)", () => {
  it("an answered live turn equals its rehydrated persisted row", () => {
    const live = liveAssistantMessage("t1-a", foldFrames(parseSseTranscript(ANSWERED_TRANSCRIPT)));
    const hydrated = hydrateMessages([PERSISTED_ROWS[0]])[1];
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
  });

  it("a stopped live turn equals its rehydrated persisted row", () => {
    const fold = foldFrames(parseSseTranscript(STOPPED_PARTIAL_TRANSCRIPT));
    const live = stoppedAssistantMessage("t2-a", fold.content);
    const hydrated = hydrateMessages([PERSISTED_ROWS[1]])[1];
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
  });

  it("a machine-evidence live turn equals its rehydrated persisted row", () => {
    const live = liveAssistantMessage(
      "t4-a",
      foldFrames(parseSseTranscript(MACHINE_EVIDENCE_TRANSCRIPT)),
    );
    const hydrated = hydrateMessages([PERSISTED_ROWS[3]])[1];
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
  });
});
