/**
 * Pure helpers for the display→control expansion (#4863 / AR-2026-11-03).
 * Kept under capabilities/ so the suite does not touch the guarded
 * `mira-hub/src/lib/__tests__` bucket.
 */
import { describe, expect, it } from "vitest";
import { extractModelNumber } from "@/lib/manual-rag";
import {
  classifyIntent,
  ensureHistoryControlRepresentation,
  historyControlQueries,
  isEmptyHistoryAsk,
  isFaultHistoryDisplayChunk,
  isHistoryControlChunk,
} from "@/lib/notebook-query";

const HISTORY_P79 =
  "b007 [Fault 1 Code] is the most recent fault, b008/b009 are the next two. Related Parameters: F604…F610.";
const HISTORY_P144 =
  "F604…F610 are the older fault codes in the 10-fault history. Related Parameters: b007…b009.";
const CONTROL_P135 =
  "A551 [Fault Clear] 1 Reset Fault (buffers kept) 2 Clear Buffer (all fault buffers to 0).";
const RESET_P160 =
  "The cause must be corrected before the fault can be cleared. Press Stop, then set A551 Fault Clear to reset the drive after you verify the condition.";
const CLEARING_P160 =
  'After the cause is corrected, clear the fault by one of these methods. Press Stop if P045 [Stop Mode] is set to a value between 0 and 3. Set A551 [Fault Clear] to 1 "Reset Fault" or 2 "Clear Buffer". Cycle drive power.';
const STEP1_P160 =
  "Access b007 [Fault 1 Code] to view the most recent fault information.";
const INDEX_P75 =
  "Modified group P034 Motor NP FLA P035 Motor NP Poles P036 Motor NP RPM(1) 641 Fault 9 Current(1)";
const INDEX_FAULT1 =
  "Fault 1 Code | 007 | Fault 9 Freq(1) | 639 | MOP Freq | 427";

describe("fault-history display → control expansion (#4863)", () => {
  it("recognises the empty-history ask and not a fault-meaning lookup", () => {
    expect(isEmptyHistoryAsk("PowerFlex 525: missing fault codes")).toBe(true);
    expect(isEmptyHistoryAsk("F604 through F610 are all zero on a drive in service since May 2024. Why is the extended fault history missing?")).toBe(true);
    expect(isEmptyHistoryAsk("What does PowerFlex 525 fault F004 mean?")).toBe(false);
    expect(isEmptyHistoryAsk("how do I clear a fault?")).toBe(false);
    expect(isEmptyHistoryAsk("How do I read the extended fault history?")).toBe(false);
    expect(isEmptyHistoryAsk("empty applications (no code) on EtherNet/IP")).toBe(false);
    expect(isEmptyHistoryAsk("Why is the EtherNet/IP implicit message buffer empty?")).toBe(false);
  });

  it("classifies an empty/missing fault-history ask as fault, even with incidental comm words", () => {
    expect(classifyIntent("PowerFlex 525: missing fault codes")).toBe("fault");
    expect(classifyIntent("F604 through F610 are all zero. Why is the extended fault history missing?")).toBe("fault");
    expect(classifyIntent("Why are the older fault codes all zero on EtherNet/IP?")).toBe("fault");
  });

  it("splits readout rows from the Clear Buffer control row", () => {
    expect(isFaultHistoryDisplayChunk(HISTORY_P79)).toBe(true);
    expect(isFaultHistoryDisplayChunk(HISTORY_P144)).toBe(true);
    expect(isFaultHistoryDisplayChunk(CONTROL_P135)).toBe(false);
    expect(isFaultHistoryDisplayChunk(INDEX_P75)).toBe(false);
    expect(isFaultHistoryDisplayChunk(INDEX_FAULT1)).toBe(false);
    expect(isFaultHistoryDisplayChunk(STEP1_P160)).toBe(false);
    expect(isHistoryControlChunk(CONTROL_P135)).toBe(true);
    expect(isHistoryControlChunk(HISTORY_P79)).toBe(false);
    expect(isHistoryControlChunk(HISTORY_P144)).toBe(false);
    expect(isHistoryControlChunk(RESET_P160)).toBe(false);
    expect(isHistoryControlChunk(CLEARING_P160)).toBe(false);
  });

  it("derives control queries from the object the display rows named, not a frozen parameter ID", () => {
    const qs = historyControlQueries([HISTORY_P79, HISTORY_P144]);
    expect(qs).toContain("fault clear");
    expect(qs).toContain("clear history");
    expect(qs.join(" ")).not.toMatch(/A551/i);
  });

  it("keeps the control chunk in the slice next to a history readout", () => {
    const display = { content: HISTORY_P144, id: "d" };
    const index = { content: INDEX_P75, id: "i" };
    const control = { content: CONTROL_P135, id: "c" };
    const out = ensureHistoryControlRepresentation([display, index], [display, index, control], 2);
    expect(out.map((c) => c.id)).toContain("c");
    expect(out.map((c) => c.id)).toContain("d");
    expect(out).toHaveLength(2);
  });

  it("does not invent a control chunk the pool does not have", () => {
    const display = { content: HISTORY_P144, id: "d" };
    expect(ensureHistoryControlRepresentation([display], [display], 2)).toEqual([display]);
  });

  it("does not treat a live-fault Reset procedure as the history-control row", () => {
    const display = { content: HISTORY_P144, id: "d" };
    const reset = { content: RESET_P160, id: "r" };
    const control = { content: CONTROL_P135, id: "c" };
    const out = ensureHistoryControlRepresentation([display, reset], [display, reset, control], 2);
    expect(out.map((c) => c.id)).toContain("c");
    expect(out.map((c) => c.content).join("\n")).toMatch(/Clear Buffer/);
    expect(out.map((c) => c.id)).not.toContain("r");
  });

  it("does not treat a parameter-index Fault 1 Code cell as the history readout", () => {
    const index = { content: INDEX_FAULT1, id: "i" };
    const display = { content: HISTORY_P144, id: "d" };
    const control = { content: CONTROL_P135, id: "c" };
    expect(isFaultHistoryDisplayChunk(INDEX_FAULT1)).toBe(false);
    const out = ensureHistoryControlRepresentation(
      [index, control],
      [index, control, display],
      2,
    );
    expect(out.map((c) => c.id)).toContain("d");
    expect(out.map((c) => c.id)).toContain("c");
    expect(out.map((c) => c.id)).not.toContain("i");
  });

  it("does not treat an Access-b007 view step as the history readout", () => {
    const step1 = { content: STEP1_P160, id: "s" };
    const display = { content: HISTORY_P144, id: "d" };
    const control = { content: CONTROL_P135, id: "c" };
    const out = ensureHistoryControlRepresentation(
      [step1, control],
      [step1, control, display],
      2,
    );
    expect(out.map((c) => c.id)).toContain("d");
    expect(out.map((c) => c.id)).toContain("c");
    expect(out.map((c) => c.id)).not.toContain("s");
  });

  it("restores a readout row when rerank left only procedures and the control", () => {
    const display = { content: HISTORY_P144, id: "d" };
    const clearing = { content: CLEARING_P160, id: "p" };
    const reset = { content: RESET_P160, id: "r" };
    const control = { content: CONTROL_P135, id: "c" };
    const out = ensureHistoryControlRepresentation(
      [clearing, reset, control],
      [clearing, reset, control, display],
      3,
    );
    expect(out.map((c) => c.id)).toContain("d");
    expect(out.map((c) => c.id)).toContain("c");
  });

  it("does not treat a Manually Clearing Faults step that names both options as the control row", () => {
    const display = { content: HISTORY_P144, id: "d" };
    const clearing = { content: CLEARING_P160, id: "p" };
    const control = { content: CONTROL_P135, id: "c" };
    const out = ensureHistoryControlRepresentation(
      [display, clearing],
      [display, clearing, control],
      2,
    );
    expect(out.map((c) => c.id)).toContain("c");
    expect(out.map((c) => c.content).join("\n")).toMatch(/all fault buffers to 0/);
    expect(out.map((c) => c.id)).not.toContain("p");
  });
});

describe("extractModelNumber — catalog 25B", () => {
  it("maps a 25B catalog string to the PowerFlex 525 token", () => {
    expect(extractModelNumber("cat 25B-D010N104 won't reset")).toBe("525");
  });
});
