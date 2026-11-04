/**
 * Pure unit tests for reduceSheet — no I/O, no mocks. Covers: the 48->4.8
 * supersede rule, template steps starting not-done even on a reused
 * template, unknown-target events warning instead of throwing, snapshot
 * determinism (reducing a prefix equals re-reducing from scratch), and the
 * two genuine corruption throws (seq gap/duplicate, missing job_started).
 */
import { describe, expect, it } from "vitest";
import { reduceSheet, type StoredEvent } from "../reduce";
import type {
  JobSheetBody,
  JobStartedPayload,
  NoteAddedPayload,
  PartLoggedPayload,
  PhotoAttachedPayload,
  QuestionResolvedPayload,
  ReadingCorrectedPayload,
  ReadingRecordedPayload,
  SheetEvent,
  StepMarkedPayload,
  HandoverWrittenPayload,
  JobFinishedPayload,
} from "../types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-11-03T12:00:00.000Z";

function template(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "PM — Pump 07",
    machineLabel: "Pump 07",
    component: null,
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [{ id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }],
    author: null,
    notes: null,
    ...over,
  };
}

let seqCounter = 0;
function ev(kind: SheetEvent["kind"], payload: SheetEvent["payload"], over: Partial<StoredEvent> = {}): StoredEvent {
  seqCounter += 1;
  return {
    id: `event-${seqCounter}`,
    seq: seqCounter,
    actorLabel: "tech-1",
    actorUserId: "user-1",
    occurredAt: T0,
    recordedAt: T0,
    workOrderId: null,
    kind,
    payload,
    ...over,
  } as StoredEvent;
}

function started(over: Partial<JobStartedPayload> = {}, overEvent: Partial<StoredEvent> = {}): StoredEvent {
  seqCounter = 0;
  const payload: JobStartedPayload = {
    title: "PM — Pump 07",
    machine: { entityId: "cmms-pump07", name: "Pump 07" },
    templateRevisionId: null,
    template: template(),
    ...over,
  };
  return ev("job_started", payload, { seq: 1, ...overEvent });
}

describe("reduceSheet — the corruption throws", () => {
  it("throws on an empty event log", () => {
    expect(() => reduceSheet([], JOB_ID)).toThrow(/cannot be empty/);
  });

  it("throws when the first event is not job_started", () => {
    seqCounter = 0;
    const marked = ev("step_marked", { stepId: "step-1", done: true, note: null } as StepMarkedPayload, { seq: 1 });
    expect(() => reduceSheet([marked], JOB_ID)).toThrow(/must be job_started/);
  });

  it("throws on a seq gap or duplicate", () => {
    const a = started();
    const b = ev("step_marked", { stepId: "step-1", done: true, note: null } as StepMarkedPayload, { seq: 3 });
    expect(() => reduceSheet([a, b], JOB_ID)).toThrow(/seq gap or duplicate/);
  });
});

describe("reduceSheet — basic view from job_started alone", () => {
  it("starts every template step not-done, even though the template carries no done field", () => {
    const a = started();
    const view = reduceSheet([a], JOB_ID);
    expect(view.jobId).toBe(JOB_ID);
    expect(view.seq).toBe(1);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toMatchObject({ id: "step-1", done: false, doneBy: null, doneAt: null, history: [] });
    expect(view.openSteps).toBe(1);
    expect(view.warnings).toEqual([]);
  });

  it("a job started from a REUSED template still starts not-done (no done flag ever lives on the template)", () => {
    const reusable = template({ steps: [{ id: "shared-step", text: "Torque bolts", checkoff: "torque", torqueRef: null, source: null }] });
    const a = started({ template: reusable });
    const view = reduceSheet([a], JOB_ID);
    expect(view.steps[0]!.done).toBe(false);
  });
});

describe("reduceSheet — step_marked", () => {
  it("marks a known step done and records history", () => {
    const a = started();
    const b = ev("step_marked", { stepId: "step-1", done: true, note: "torqued to spec" } as StepMarkedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.steps[0]).toMatchObject({ done: true, doneBy: "tech-1", note: "torqued to spec" });
    expect(view.steps[0]!.history).toHaveLength(1);
    expect(view.openSteps).toBe(0);
  });

  it("an unknown stepId warns and never throws", () => {
    const a = started();
    const b = ev("step_marked", { stepId: "does-not-exist", done: true, note: null } as StepMarkedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.warnings).toEqual([{ eventId: b.id, seq: 2, kind: "step_marked", reason: "unknown_step:does-not-exist" }]);
    expect(view.steps[0]!.done).toBe(false);
  });
});

describe("reduceSheet — reading supersede (48 -> 4.8)", () => {
  it("keeps both values in history; only the last is current, and only it is not superseded", () => {
    const a = started();
    const readingId = "22222222-2222-4222-8222-222222222222";
    const b = ev("reading_recorded", {
      readingId,
      what: "Discharge pressure",
      value: 48,
      unit: "psi",
      source: { kind: "tech", ref: null },
    } as ReadingRecordedPayload);
    const c = ev("reading_corrected", { readingId, value: 4.8, unit: "psi", reason: "misread the gauge" } as ReadingCorrectedPayload);
    const view = reduceSheet([a, b, c], JOB_ID);

    expect(view.readings).toHaveLength(1);
    const reading = view.readings[0]!;
    expect(reading.current).toMatchObject({ value: 4.8, unit: "psi" });
    expect(reading.history).toHaveLength(2);
    expect(reading.history[0]).toMatchObject({ value: 48, superseded: true });
    expect(reading.history[1]).toMatchObject({ value: 4.8, superseded: false });
  });

  it("correcting an unknown readingId warns and never throws", () => {
    const a = started();
    const b = ev("reading_corrected", { readingId: "no-such-reading", value: 1, unit: "psi", reason: null } as ReadingCorrectedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.warnings).toEqual([{ eventId: b.id, seq: 2, kind: "reading_corrected", reason: "unknown_reading:no-such-reading" }]);
    expect(view.readings).toEqual([]);
  });
});

describe("reduceSheet — R2-14: a correction carries its OWN source, never the superseded value's", () => {
  const readingId = "22222222-2222-4222-8222-222222222222";

  it("a manual-sourced 48 A corrected with NO stated source becomes technician-reported, not manual", () => {
    const a = started();
    const b = ev("reading_recorded", {
      readingId,
      what: "motor current",
      value: 48,
      unit: "A",
      source: { kind: "manual", ref: "p.12" },
    } as ReadingRecordedPayload);
    const c = ev("reading_corrected", { readingId, value: 4.8, unit: "A", reason: "misread" } as ReadingCorrectedPayload);
    const view = reduceSheet([a, b, c], JOB_ID);

    const reading = view.readings[0]!;
    expect(reading.current).toMatchObject({ value: 4.8 });
    // The TOP-LEVEL (current) source is technician-reported, never the
    // manual citation the superseded 48 A carried.
    expect(reading.source).toEqual({ kind: "tech", ref: null });
    // History preserves BOTH: 48 A still shows its real manual citation;
    // 4.8 A shows its own (defaulted) technician-reported source. Neither
    // entry's own source was rewritten by the other.
    expect(reading.history[0]).toMatchObject({ value: 48, source: { kind: "manual", ref: "p.12" } });
    expect(reading.history[1]).toMatchObject({ value: 4.8, source: { kind: "tech", ref: null } });
  });

  it("a correction that DOES state its own source uses that source, not technician-reported", () => {
    const a = started();
    const b = ev("reading_recorded", {
      readingId,
      what: "motor current",
      value: 48,
      unit: "A",
      source: { kind: "manual", ref: "p.12" },
    } as ReadingRecordedPayload);
    const c = ev("reading_corrected", {
      readingId,
      value: 50,
      unit: "A",
      reason: "re-checked against the nameplate",
      source: { kind: "manual", ref: "p.13" },
    } as ReadingCorrectedPayload);
    const view = reduceSheet([a, b, c], JOB_ID);

    const reading = view.readings[0]!;
    expect(reading.source).toEqual({ kind: "manual", ref: "p.13" });
    expect(reading.history[1]).toMatchObject({ value: 50, source: { kind: "manual", ref: "p.13" } });
  });

  it("a SECOND correction's source becomes current; the first correction's own source is preserved in history, not overwritten", () => {
    const a = started();
    const b = ev("reading_recorded", {
      readingId,
      what: "motor current",
      value: 48,
      unit: "A",
      source: { kind: "manual", ref: "p.12" },
    } as ReadingRecordedPayload);
    const c = ev("reading_corrected", { readingId, value: 4.8, unit: "A", reason: "misread" } as ReadingCorrectedPayload);
    const d = ev("reading_corrected", {
      readingId,
      value: 4.9,
      unit: "A",
      reason: "re-measured",
      source: { kind: "tech", ref: "clamp meter" },
    } as ReadingCorrectedPayload);
    const view = reduceSheet([a, b, c, d], JOB_ID);

    const reading = view.readings[0]!;
    expect(reading.current).toMatchObject({ value: 4.9 });
    expect(reading.source).toEqual({ kind: "tech", ref: "clamp meter" });
    expect(reading.history.map((h) => ({ value: h.value, source: h.source, superseded: h.superseded }))).toEqual([
      { value: 48, source: { kind: "manual", ref: "p.12" }, superseded: true },
      { value: 4.8, source: { kind: "tech", ref: null }, superseded: true },
      { value: 4.9, source: { kind: "tech", ref: "clamp meter" }, superseded: false },
    ]);
  });

  it("control: an uncorrected reading's source is just what it was recorded with", () => {
    const a = started();
    const b = ev("reading_recorded", {
      readingId,
      what: "motor current",
      value: 48,
      unit: "A",
      source: { kind: "tech", ref: null },
    } as ReadingRecordedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.readings[0]!.source).toEqual({ kind: "tech", ref: null });
  });
});

describe("reduceSheet — notes, questions, parts, photos, handover, finish", () => {
  it("note_added with noteKind=note goes to notes; noteKind=question goes to questions and can be resolved", () => {
    const a = started();
    const b = ev("note_added", { noteId: "n1", text: "torque wrench was out of cal", noteKind: "note" } as NoteAddedPayload);
    const c = ev("note_added", { noteId: "q1", text: "is this the right seal kit?", noteKind: "question" } as NoteAddedPayload);
    const d = ev("question_resolved", { noteId: "q1", resolution: "yes, confirmed with supplier" } as QuestionResolvedPayload);
    const view = reduceSheet([a, b, c, d], JOB_ID);

    expect(view.notes).toHaveLength(1);
    expect(view.notes[0]).toMatchObject({ id: "n1", text: "torque wrench was out of cal" });
    expect(view.questions).toHaveLength(1);
    expect(view.questions[0]).toMatchObject({ id: "q1", resolved: true, resolution: "yes, confirmed with supplier" });
    expect(view.openQuestions).toBe(0);
  });

  it("resolving an unknown noteId warns and never throws", () => {
    const a = started();
    const b = ev("question_resolved", { noteId: "no-such-note", resolution: "n/a" } as QuestionResolvedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.warnings).toEqual([{ eventId: b.id, seq: 2, kind: "question_resolved", reason: "unknown_note:no-such-note" }]);
  });

  it("part_logged and photo_attached append in order", () => {
    const a = started();
    const b = ev("part_logged", { partEntryId: "p1", item: "Seal kit", action: "used", qty: 1 } as PartLoggedPayload);
    const c = ev("photo_attached", { photoId: "ph1", fileId: "file-1", caption: "before" } as PhotoAttachedPayload);
    const view = reduceSheet([a, b, c], JOB_ID);
    expect(view.parts).toEqual([expect.objectContaining({ id: "p1", item: "Seal kit", action: "used" })]);
    expect(view.photos).toEqual([expect.objectContaining({ id: "ph1", fileId: "file-1", caption: "before" })]);
  });

  it("handover_written: current is the latest entry; history keeps every one", () => {
    const a = started();
    const b = ev("handover_written", { text: "first shift note" } as HandoverWrittenPayload);
    const c = ev("handover_written", { text: "second shift note" } as HandoverWrittenPayload);
    const view = reduceSheet([a, b, c], JOB_ID);
    expect(view.handover.current).toMatchObject({ text: "second shift note" });
    expect(view.handover.history).toHaveLength(2);
  });

  it("job_finished records who/when/summary", () => {
    const a = started();
    const b = ev("job_finished", { summary: "all good", openItemsAcknowledged: true } as JobFinishedPayload);
    const view = reduceSheet([a, b], JOB_ID);
    expect(view.finished).toMatchObject({ by: "tech-1", summary: "all good" });
  });
});

describe("reduceSheet — determinism / snapshot", () => {
  it("reducing a log twice yields the same view", () => {
    const a = started();
    const b = ev("step_marked", { stepId: "step-1", done: true, note: null } as StepMarkedPayload);
    const events = [a, b];
    expect(reduceSheet(events, JOB_ID)).toEqual(reduceSheet(events, JOB_ID));
  });

  it("reducing events[0..N] equals the ?atSeq=N snapshot semantics", () => {
    const a = started();
    const readingId = "33333333-3333-4333-8333-333333333333";
    const b = ev("reading_recorded", {
      readingId,
      what: "Temp",
      value: 180,
      unit: "F",
      source: { kind: "tech", ref: null },
    } as ReadingRecordedPayload);
    const c = ev("step_marked", { stepId: "step-1", done: true, note: null } as StepMarkedPayload);
    const all = [a, b, c];

    const atSeq2 = reduceSheet(all.filter((e) => e.seq <= 2), JOB_ID);
    expect(atSeq2.seq).toBe(2);
    expect(atSeq2.steps[0]!.done).toBe(false); // step_marked (seq 3) not yet applied
    expect(atSeq2.readings[0]!.current.value).toBe(180);

    const atSeq3 = reduceSheet(all, JOB_ID);
    expect(atSeq3.seq).toBe(3);
    expect(atSeq3.steps[0]!.done).toBe(true);
  });
});
