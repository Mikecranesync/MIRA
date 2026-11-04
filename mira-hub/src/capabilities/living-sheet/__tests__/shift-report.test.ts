/**
 * Pure unit tests for shiftReport (S6). Builds StoredEvent fixtures, reduces
 * them with the real reduceSheet (dogfooding S1) to get a consistent view,
 * then feeds { notebookId, notebookName, jobId, view, events } into
 * shiftReport. Covers: ordering, every event listed (including the first
 * job_started — the earlier missing-first-report defect), the banned-words
 * rule, and the empty-shift message.
 */
import { describe, expect, it } from "vitest";
import { reduceSheet, type StoredEvent } from "../reduce";
import { shiftReport, type ShiftReportJobInput } from "../shift-report";
import type { JobSheetBody, SheetEvent } from "../types";

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
    steps: [
      { id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null },
      { id: "step-2", text: "Torque bolts", checkoff: "torque", torqueRef: null, source: null },
      { id: "step-3", text: "Reinstall guard", checkoff: "none", torqueRef: null, source: null },
    ],
    author: null,
    notes: null,
    ...over,
  };
}

let seqCounter = 0;
function ev(
  kind: SheetEvent["kind"],
  payload: SheetEvent["payload"],
  over: Partial<StoredEvent> = {},
): StoredEvent {
  seqCounter += 1;
  return {
    id: `event-${seqCounter}`,
    seq: seqCounter,
    actorLabel: "Tech One",
    actorUserId: "tech-1",
    occurredAt: "2026-11-03T20:00:00.000Z",
    recordedAt: "2026-11-03T20:00:00.000Z",
    workOrderId: null,
    kind,
    payload,
    ...over,
  } as StoredEvent;
}

function job(jobId: string, events: StoredEvent[], notebook: { id: string; name: string } = { id: "nb-1", name: "Pump Room" }): ShiftReportJobInput {
  return { notebookId: notebook.id, notebookName: notebook.name, jobId, view: reduceSheet(events, jobId), events };
}

const WINDOW_WIDE = { from: "2026-11-03T00:00:00.000Z", to: "2026-11-04T00:00:00.000Z" };

describe("shiftReport — ordering and completeness", () => {
  it("lists every event in the window, including the first job_started", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const marked = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const j = job("job-1", [started, marked]);

    const report = shiftReport([j], WINDOW_WIDE);
    const allTexts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(allTexts.some((t) => t.includes("started job"))).toBe(true);
    expect(allTexts.some((t) => t.includes("marked step 1 done"))).toBe(true);
    // Both events from the same job land under the same technician's bucket.
    const bucket = report.byTechnician.find((g) => g.technician === "Tech One");
    expect(bucket?.entries).toHaveLength(2);
  });

  it("entries within a technician's bucket are in time order", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const second = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 2, occurredAt: "2026-11-03T20:30:00.000Z" });
    const third = ev("step_marked", { stepId: "step-2", done: true, note: null }, { seq: 3, occurredAt: "2026-11-03T20:15:00.000Z" }, );
    const j = job("job-1", [started, second, third]);

    const report = shiftReport([j], WINDOW_WIDE);
    const bucket = report.byTechnician.find((g) => g.technician === "Tech One")!;
    const times = bucket.entries.map((e) => e.at);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  it("excludes events outside the window but keeps the job in needsAttention/counts", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-01T20:00:00.000Z" }, // before the window
    );
    const inWindow = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const j = job("job-1", [started, inWindow]);

    const report = shiftReport([j], WINDOW_WIDE);
    const allTexts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(allTexts.some((t) => t.includes("started job"))).toBe(false);
    expect(allTexts.some((t) => t.includes("marked step 1 done"))).toBe(true);
  });
});

describe("shiftReport — corrections in plain, local-time words", () => {
  it("formats a correction as '<who> corrected <what> <old> → <new> at <local time>'", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const recorded = ev(
      "reading_recorded",
      { readingId: "r1", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { seq: 2, occurredAt: "2026-11-03T21:00:00.000Z" },
    );
    const corrected = ev(
      "reading_corrected",
      { readingId: "r1", value: 4.8, unit: "A", reason: "misread" },
      { seq: 3, occurredAt: "2026-11-04T01:14:00.000Z" }, // 20:14 America/New_York (UTC-5 — DST ended 2026-11-01)
    );
    const j = job("job-1", [started, recorded, corrected]);

    const report = shiftReport([j], { from: "2026-11-03T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z" });
    const bucket = report.byTechnician.find((g) => g.technician === "Tech One")!;
    const correctionEntry = bucket.entries.find((e) => e.kind === "reading_corrected");
    expect(correctionEntry).toBeDefined();
    expect(correctionEntry!.by).toBe("Tech One");
    expect(correctionEntry!.text).toMatch(/corrected motor current 48 A → 4\.8 A at \d{2}:\d{2}/);
  });

  it("takes the time zone as a parameter, defaulting to America/New_York", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const recorded = ev(
      "reading_recorded",
      { readingId: "r1", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { seq: 2, occurredAt: "2026-11-03T21:00:00.000Z" },
    );
    const corrected = ev(
      "reading_corrected",
      { readingId: "r1", value: 4.8, unit: "A", reason: "misread" },
      { seq: 3, occurredAt: "2026-11-04T01:14:00.000Z" },
    );
    const j = job("job-1", [started, recorded, corrected]);
    const window = { from: "2026-11-03T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z" };

    const defaultTz = shiftReport([j], window);
    const utc = shiftReport([j], window, { timeZone: "UTC" });

    const defaultEntry = defaultTz.byTechnician[0]!.entries.find((e) => e.kind === "reading_corrected")!;
    const utcEntry = utc.byTechnician[0]!.entries.find((e) => e.kind === "reading_corrected")!;
    expect(defaultEntry.text).toContain("20:14");
    expect(utcEntry.text).toContain("01:14");
    expect(defaultEntry.text).not.toBe(utcEntry.text);
  });
});

describe("shiftReport — plain words for parts and questions", () => {
  it("a question is answered, never resolved", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const asked = ev("note_added", { noteId: "q1", text: "Original bearing?", noteKind: "question" }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const answered = ev("question_resolved", { noteId: "q1", resolution: "Yes, OEM part." }, { seq: 3, occurredAt: "2026-11-03T20:10:00.000Z" });
    const j = job("job-1", [started, asked, answered]);

    const report = shiftReport([j], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts.some((t) => t.includes("answered"))).toBe(true);
    expect(texts.some((t) => /\bresolved\b/i.test(t))).toBe(false);
  });

  it("parts: 'replaced: X (reported)' vs 'planned: X'", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const replaced = ev("part_logged", { partEntryId: "p1", item: "wheel bearing", action: "replaced", qty: 1 }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const planned = ev("part_logged", { partEntryId: "p2", item: "new bolts", action: "planned", qty: 4 }, { seq: 3, occurredAt: "2026-11-03T20:06:00.000Z" });
    const j = job("job-1", [started, replaced, planned]);

    const report = shiftReport([j], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts).toContain("replaced: wheel bearing (reported)");
    expect(texts).toContain("planned: new bolts");
  });
});

describe("shiftReport — needs attention + finished jobs + counts", () => {
  it("flags open steps and open questions, and names the machine and job", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const j = job("job-1", [started]);

    const report = shiftReport([j], WINDOW_WIDE);
    expect(report.needsAttention.some((a) => a.reason === "open_steps" && a.machineName === "Pump 07" && a.jobTitle === "PM — Pump 07")).toBe(true);
    expect(report.needsAttention.some((a) => a.reason === "not_finished")).toBe(true);
  });

  it("a finished job shows 'finished (reported by X)' and is not counted as open", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template({ steps: [] }) },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const finished = ev("job_finished", { summary: null, openItemsAcknowledged: true }, { seq: 2, occurredAt: "2026-11-03T21:00:00.000Z" });
    const j = job("job-1", [started, finished]);

    const report = shiftReport([j], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts.some((t) => t === "finished (reported by Tech One) — open items acknowledged")).toBe(true);
    expect(report.counts).toEqual({ jobsTouched: 1, jobsFinished: 1, jobsOpen: 0 });
  });

  it("counts jobsTouched/jobsFinished/jobsOpen across multiple jobs", () => {
    seqCounter = 0;
    const startedA = ev(
      "job_started",
      { title: "Job A", machine: { entityId: "cmms-a", name: "Machine A" }, templateRevisionId: null, template: template({ steps: [] }) },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const finishedA = ev("job_finished", { summary: null, openItemsAcknowledged: true }, { seq: 2, occurredAt: "2026-11-03T20:30:00.000Z" });
    const jobA = job("job-a", [startedA, finishedA]);

    const startedB = ev(
      "job_started",
      { title: "Job B", machine: { entityId: "cmms-b", name: "Machine B" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const jobB = job("job-b", [startedB]);

    const report = shiftReport([jobA, jobB], WINDOW_WIDE);
    expect(report.counts).toEqual({ jobsTouched: 2, jobsFinished: 1, jobsOpen: 1 });
  });
});

describe("shiftReport — F15: summary fields reflect state as of the window's end, not the live log", () => {
  it("a finish recorded AFTER 'to' does not count the job as finished, and still flags it not_finished", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template({ steps: [] }) },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const finishedAfterWindow = ev("job_finished", { summary: null, openItemsAcknowledged: true }, { seq: 2, occurredAt: "2026-11-03T22:00:00.000Z" });
    const j = job("job-1", [started, finishedAfterWindow]);

    const window = { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T21:00:00.000Z" }; // ends before the finish
    const report = shiftReport([j], window);

    expect(report.counts).toEqual({ jobsTouched: 1, jobsFinished: 0, jobsOpen: 1 });
    expect(report.needsAttention.some((a) => a.reason === "not_finished")).toBe(true);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts.some((t) => t.includes("finished"))).toBe(false);
  });

  it("a handover written AFTER 'to' does not appear in the report's handover section", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const handoverAfterWindow = ev("handover_written", { text: "Watch the belt next shift." }, { seq: 2, occurredAt: "2026-11-03T22:00:00.000Z" });
    const j = job("job-1", [started, handoverAfterWindow]);

    const window = { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T21:00:00.000Z" };
    const report = shiftReport([j], window);

    expect(report.handover).toHaveLength(0);
  });

  it("a wider window end that includes the finish correctly counts it finished, proving the fix is window-end-relative, not a blanket suppression", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template({ steps: [] }) },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const finished = ev("job_finished", { summary: null, openItemsAcknowledged: true }, { seq: 2, occurredAt: "2026-11-03T20:30:00.000Z" });
    const j = job("job-1", [started, finished]);

    const narrowWindow = { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T20:15:00.000Z" }; // before the finish
    const wideWindow = { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T21:00:00.000Z" }; // after the finish

    expect(shiftReport([j], narrowWindow).counts.jobsFinished).toBe(0);
    expect(shiftReport([j], wideWindow).counts.jobsFinished).toBe(1);
  });
});

describe("shiftReport — F20: per-job snapshot (short id + event seq as of the window's end)", () => {
  it("names each job's short id and its seq as of 'to', ignoring events after it", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const inWindow = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const afterWindow = ev("step_marked", { stepId: "step-2", done: true, note: null }, { seq: 3, occurredAt: "2026-11-03T22:00:00.000Z" });
    const j = job("11111111-2222-3333-4444-555555555555", [started, inWindow, afterWindow]);

    const window = { from: "2026-11-03T19:00:00.000Z", to: "2026-11-03T21:00:00.000Z" };
    const report = shiftReport([j], window);

    expect(report.jobSnapshots).toEqual([
      { jobId: "11111111-2222-3333-4444-555555555555", jobIdShort: "11111111", seq: 2 },
    ]);
  });
});

describe("shiftReport — empty shift", () => {
  it("returns a clear empty-shift message and zero counts when no jobs were touched", () => {
    const report = shiftReport([], WINDOW_WIDE);
    expect(report.emptyMessage).not.toBeNull();
    expect(report.emptyMessage).toMatch(/no (jobs|activity)/i);
    expect(report.counts).toEqual({ jobsTouched: 0, jobsFinished: 0, jobsOpen: 0 });
    expect(report.byTechnician).toEqual([]);
    expect(report.needsAttention).toEqual([]);
  });
});

describe("shiftReport — banned words (machine-facing text)", () => {
  const BANNED = ["fixed", "safe", "repaired successfully", "resolved"];

  function bannedWordRegex(phrase: string): RegExp {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped.replace(/ /g, "\\s+")}\\b`, "i");
  }

  it("never emits any banned word across a report exercising every event kind", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const marked = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const recorded = ev(
      "reading_recorded",
      { readingId: "r1", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { seq: 3, occurredAt: "2026-11-03T20:10:00.000Z" },
    );
    const corrected = ev("reading_corrected", { readingId: "r1", value: 4.8, unit: "A", reason: "misread" }, { seq: 4, occurredAt: "2026-11-03T20:15:00.000Z" });
    const noted = ev("note_added", { noteId: "n1", text: "Belt tension checked.", noteKind: "note" }, { seq: 5, occurredAt: "2026-11-03T20:20:00.000Z" });
    const asked = ev("note_added", { noteId: "q1", text: "Original bearing?", noteKind: "question" }, { seq: 6, occurredAt: "2026-11-03T20:25:00.000Z" });
    const answered = ev("question_resolved", { noteId: "q1", resolution: "Yes, OEM part." }, { seq: 7, occurredAt: "2026-11-03T20:30:00.000Z" });
    const part = ev("part_logged", { partEntryId: "p1", item: "wheel bearing", action: "replaced", qty: 1 }, { seq: 8, occurredAt: "2026-11-03T20:35:00.000Z" });
    const photo = ev("photo_attached", { photoId: "ph1", fileId: "file-1", caption: "before teardown", }, { seq: 9, occurredAt: "2026-11-03T20:40:00.000Z" });
    const handover = ev("handover_written", { text: "Bearing on order, ETA Thursday." }, { seq: 10, occurredAt: "2026-11-03T20:45:00.000Z" });
    const finished = ev("job_finished", { summary: null, openItemsAcknowledged: true }, { seq: 11, occurredAt: "2026-11-03T20:50:00.000Z" });
    const j = job("job-1", [started, marked, recorded, corrected, noted, asked, answered, part, photo, handover, finished]);

    const report = shiftReport([j], WINDOW_WIDE);
    for (const phrase of BANNED) {
      expect(report.plainText, `must not contain "${phrase}"`).not.toMatch(bannedWordRegex(phrase));
    }
  });

  it("control: the regex itself fires on the banned words", () => {
    expect("the pump is fixed").toMatch(bannedWordRegex("fixed"));
    expect("safe to operate").toMatch(bannedWordRegex("safe"));
    expect("question resolved").toMatch(bannedWordRegex("resolved"));
    expect("repaired successfully").toMatch(bannedWordRegex("repaired successfully"));
  });
});

describe("shiftReport — handover in the timeline is quoted, never paraphrased", () => {
  it("the technician's handover text appears in quotes, verbatim", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: "2026-11-03T20:00:00.000Z" },
    );
    const handover = ev("handover_written", { text: "Pump is fixed." }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const report = shiftReport([job("job-1", [started, handover])], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts).toContain("handover: “Pump is fixed.”");
  });
});
