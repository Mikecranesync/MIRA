/**
 * Work Packet job record — what the technician did on the job, kept apart from the manual review.
 * Run: cd mira-hub && npx vitest run src/capabilities/work-packet/__tests__/job-record
 */
import { describe, expect, it } from "vitest";
import type { Field, WorkPacket } from "../types";
import {
  addNote,
  addPhoto,
  completionSummary,
  emptyRecord,
  parseRecord,
  recordMeasurement,
  removePhoto,
  setNoteResolved,
  setStepPerformed,
  stepPerformedHolds,
  type JobRecord,
} from "../job-record";

const T = "2026-11-02T17:00:00.000Z";
const f = (value: string, extra: Partial<Field> = {}): Field => ({ value, label: "verified", source: null, basis: "t", ...extra });
const PACKET = {
  packetId: "pk-1",
  steps: [
    { section: "Valves", topic: "valves", text: f("Remove valve plugs") },
    { section: "Valves", topic: "valves", text: f("Remove valve assembly") },
    { section: "Seals", topic: "seals", text: f("Remove seal retainer", { struck: true }) },
  ],
  measurements: [{ name: f("Valve Plugs"), value: f("1305 in-lbs"), tool: f("M41 Hex") }],
} as unknown as Pick<WorkPacket, "packetId" | "steps" | "measurements">;

describe("a new record has nothing performed", () => {
  it("starts empty and not started", () => {
    const s = completionSummary(PACKET, emptyRecord("pk-1"));
    expect(s.performed).toBe(0);
    expect(s.status).toBe("not_started");
    expect(s.text).toMatch(/Not started/);
  });
});

describe("steps are only performed when the technician records them", () => {
  it("records who and when", () => {
    const r = setStepPerformed(emptyRecord("pk-1"), 0, true, "tech@x", T);
    expect(r.steps[0]).toEqual({ performed: true, by: "tech@x", at: T });
    expect(completionSummary(PACKET, r).status).toBe("in_progress");
  });
  it("undo removes the record", () => {
    const r = setStepPerformed(setStepPerformed(emptyRecord("pk-1"), 0, true, "a", T), 0, false, "a", T);
    expect(r.steps[0]).toBeUndefined();
  });
  it("a struck step is not counted as performed or as remaining", () => {
    const r = setStepPerformed(setStepPerformed(emptyRecord("pk-1"), 0, true, "a", T), 1, true, "a", T);
    const s = completionSummary(PACKET, r);
    expect(s.struck).toBe(1);
    expect(s.remaining).toBe(0);
    expect(s.status).toBe("all_steps_recorded");
  });
  it("control: one live step left keeps it in progress", () => {
    const s = completionSummary(PACKET, setStepPerformed(emptyRecord("pk-1"), 0, true, "a", T));
    expect(s.remaining).toBe(1);
    expect(s.status).toBe("in_progress");
  });
  it("rejects a step index the packet does not have", () => {
    expect(() => setStepPerformed(emptyRecord("pk-1"), -1, true, "a", T)).toThrow();
  });
});

describe("the summary never claims the equipment is safe, repaired or returned to service", () => {
  const all = setStepPerformed(setStepPerformed(emptyRecord("pk-1"), 0, true, "a", T), 1, true, "a", T);
  it("even with every step recorded", () => {
    const s = completionSummary(PACKET, all);
    expect(s.text).toMatch(/not a return to service/i);
    expect(s.text).not.toMatch(/\b(is safe|repaired|returned to service|complete[d]?\b)/i);
  });
  it("open issues are called out", () => {
    const r = addNote(all, { id: "n1", kind: "issue", text: "Weep at seal", stepIndex: null, by: "a", at: T });
    const s = completionSummary(PACKET, r);
    expect(s.openIssues).toBe(1);
    expect(s.status).toBe("open_issues");
    expect(s.text).toMatch(/1 unresolved issue/);
  });
  it("control: a resolved issue no longer counts as open", () => {
    const r = setNoteResolved(addNote(all, { id: "n1", kind: "issue", text: "Weep", stepIndex: null, by: "a", at: T }), "n1", true, "b", T);
    expect(completionSummary(PACKET, r).openIssues).toBe(0);
    expect(r.notes[0].resolvedBy).toBe("b");
  });
});

describe("measurements and notes", () => {
  it("records a measured value and clears it on empty input", () => {
    const r = recordMeasurement(emptyRecord("pk-1"), 0, " 1300 in-lbs ", "a", T);
    expect(r.measurements[0]).toEqual({ value: "1300 in-lbs", by: "a", at: T });
    expect(completionSummary(PACKET, r).measured).toBe(1);
    expect(recordMeasurement(r, 0, "  ", "a", T).measurements[0]).toBeUndefined();
  });
  it("a blank note is refused", () => {
    expect(() => addNote(emptyRecord("pk-1"), { id: "n", kind: "finding", text: "  ", stepIndex: null, by: "a", at: T })).toThrow();
  });
  it("does not mutate the input record", () => {
    const r0 = emptyRecord("pk-1");
    setStepPerformed(r0, 0, true, "a", T);
    addNote(r0, { id: "n", kind: "finding", text: "ok", stepIndex: null, by: "a", at: T });
    expect(r0).toEqual(emptyRecord("pk-1"));
  });
});

describe("photos", () => {
  const photo = { id: "p1", image: "data:image/jpeg;base64,AAAA", caption: "Worn seal", stepIndex: 1, by: "a", at: T };
  it("adds and removes", () => {
    const r = addPhoto(emptyRecord("pk-1"), photo);
    expect(r.photos).toHaveLength(1);
    expect(removePhoto(r, "p1").photos).toHaveLength(0);
  });
  it("refuses anything but an inline image", () => {
    expect(() => addPhoto(emptyRecord("pk-1"), { ...photo, image: "https://x/y.jpg" })).toThrow();
  });
  it("caps the number of photos", () => {
    let r: JobRecord = emptyRecord("pk-1");
    for (let i = 0; i < 8; i++) r = addPhoto(r, { ...photo, id: `p${i}` });
    expect(() => addPhoto(r, { ...photo, id: "p9" })).toThrow(/at most 8/);
  });
});

describe("a saved record only restores under the packet it was made for", () => {
  it("restores its own packet", () => {
    const r = setStepPerformed(emptyRecord("pk-1"), 0, true, "a", T);
    expect(parseRecord(JSON.stringify(r), "pk-1")).toEqual(r);
  });
  it("drops another packet's record", () => {
    expect(parseRecord(JSON.stringify(emptyRecord("pk-2")), "pk-1")).toBeNull();
  });
  it("drops malformed text", () => {
    expect(parseRecord("{not json", "pk-1")).toBeNull();
    expect(parseRecord(JSON.stringify({ packetId: "pk-1" }), "pk-1")).toBeNull();
  });
});

describe("EGM F35 — a 'performed' tick is for the instruction as it read when ticked", () => {
  it("after the step's text is edited, the tick no longer counts and is shown as needing a new tick", () => {
    const r = setStepPerformed(emptyRecord("pk-1"), 0, true, "tech@x", T, "Remove valve plugs");
    expect(completionSummary(PACKET, r).performed).toBe(1);
    const edited = { ...PACKET, steps: [{ ...PACKET.steps[0], text: f("Remove valve plugs and caps", { label: "proposed" }) }, ...PACKET.steps.slice(1)] } as typeof PACKET;
    expect(stepPerformedHolds(r, edited, 0)).toBe(false);
    expect(completionSummary(edited, r).performed).toBe(0);
  });
  it("control: unchanged text keeps the tick", () => {
    const r = setStepPerformed(emptyRecord("pk-1"), 0, true, "tech@x", T, "Remove valve plugs");
    expect(stepPerformedHolds(r, PACKET, 0)).toBe(true);
  });
});
