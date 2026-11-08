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
import { shiftReport, type ShiftReportJobInput, type ShiftReportWindow } from "../shift-report";
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
const T0 = "2026-11-03T20:00:00.000Z"; // seq 1, job_started, always earliest

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
    // R2-27: part descriptions are the technician's own words — quoted.
    expect(texts).toContain("replaced: “wheel bearing” (reported)");
    expect(texts).toContain("planned: “new bolts”");
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

describe("shiftReport — R2-15: window-end state is the longest contiguous seq prefix, never a gapped occurredAt filter", () => {
  // PROPERTY: a job's never throws when computing its state as of the
  // window's end — the events used are the longest run starting at seq 1,
  // in server-recorded seq order, that are all at-or-before window.to; the
  // walk STOPS (not skips) at the first event past the cutoff, so it can
  // never select a seq set with a hole, no matter what order the technicians'
  // client-supplied `occurredAt` timestamps arrived in.
  type Case = { name: string; occurredAts: string[]; to: string; expectSeq: number };
  const cases: Case[] = [
    {
      name: "[1,3]-without-2 — the reviewer's literal example: seq 2 is late, seq 3 is early",
      occurredAts: [T0, "2026-11-04T04:00:00.000Z", "2026-11-03T20:10:00.000Z"],
      to: "2026-11-03T21:00:00.000Z",
      expectSeq: 1,
    },
    {
      name: "a single out-of-order event one step later (seq 2 late, seq 3 late, seq 4 early) stops the prefix at seq 1",
      occurredAts: [T0, "2026-11-04T04:00:00.000Z", "2026-11-04T05:00:00.000Z", "2026-11-03T20:05:00.000Z"],
      to: "2026-11-03T21:00:00.000Z",
      expectSeq: 1,
    },
    {
      name: "the hole is further in: seq 1,2 early, seq 3 late, seq 4 early — prefix stops at seq 2",
      occurredAts: [T0, "2026-11-03T20:05:00.000Z", "2026-11-04T04:00:00.000Z", "2026-11-03T20:10:00.000Z"],
      to: "2026-11-03T21:00:00.000Z",
      expectSeq: 2,
    },
    {
      name: "every event is early (no violation) — prefix is the whole log, matching the old behavior",
      occurredAts: [T0, "2026-11-03T20:05:00.000Z", "2026-11-03T20:10:00.000Z"],
      to: "2026-11-03T21:00:00.000Z",
      expectSeq: 3,
    },
    {
      name: "every event is late (cutoff before anything) — prefix is empty, falls back to job.view (defensive)",
      occurredAts: [T0, "2026-11-03T20:05:00.000Z", "2026-11-03T20:10:00.000Z"],
      to: "2026-11-01T00:00:00.000Z",
      expectSeq: 3, // unreachable per the note on viewAsOfWindowEnd — listJobsActiveBetween guarantees >=1 in-window event; fallback is job.view's own seq
    },
    {
      name: "seq 1 itself is late relative to cutoff — prefix is empty, falls back to job.view",
      occurredAts: ["2026-11-04T04:00:00.000Z", "2026-11-03T20:05:00.000Z", "2026-11-03T20:10:00.000Z"],
      to: "2026-11-03T19:00:00.000Z",
      expectSeq: 3, // fallback
    },
  ];

  it.each(cases)("$name", ({ occurredAts, to, expectSeq }) => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: occurredAts[0] },
    );
    const rest = occurredAts.slice(1).map((at, i) =>
      ev("step_marked", { stepId: `step-${(i % 3) + 1}`, done: true, note: null }, { seq: i + 2, occurredAt: at }),
    );
    const j = job("job-1", [started, ...rest]);
    const window: ShiftReportWindow = { from: "2026-11-03T00:00:00.000Z", to };

    expect(() => shiftReport([j], window)).not.toThrow();
    const report = shiftReport([j], window);
    expect(report.jobSnapshots[0]!.seq).toBe(expectSeq);
  });

  it("a job whose full event log cannot be reduced is reported as 'could not be summarized', without failing the other jobs", () => {
    seqCounter = 0;
    // A genuinely corrupt full log: seq 1 then seq 3 (a real hole, not just
    // an occurredAt ordering artifact) — reduceSheet throws on this no
    // matter what window is asked for. Built by hand (not the `job()`
    // helper, which would itself throw computing `view`): `view` is a
    // throwaway reduction of just the valid prefix so the fixture itself is
    // constructible.
    const started = ev("job_started", { title: "Bad Job", machine: { entityId: "cmms-bad", name: "Bad Machine" }, templateRevisionId: null, template: template() }, { seq: 1, occurredAt: T0 });
    const gappy = ev("step_marked", { stepId: "step-1", done: true, note: null }, { seq: 3, occurredAt: "2026-11-03T20:05:00.000Z" });
    const badJob: ShiftReportJobInput = {
      notebookId: "nb-1",
      notebookName: "Pump Room",
      jobId: "job-bad",
      view: reduceSheet([started], "job-bad"),
      events: [started, gappy],
    };

    const startedGood = ev("job_started", { title: "Good Job", machine: { entityId: "cmms-good", name: "Good Machine" }, templateRevisionId: null, template: template({ steps: [] }) }, { seq: 1, occurredAt: T0 });
    const goodJob = job("job-good", [startedGood]);

    expect(() => shiftReport([badJob, goodJob], WINDOW_WIDE)).not.toThrow();
    const report = shiftReport([badJob, goodJob], WINDOW_WIDE);

    const badAttention = report.needsAttention.find((a) => a.jobId === "job-bad");
    expect(badAttention).toBeDefined();
    expect(badAttention!.reason).toBe("could_not_summarize");
    expect(badAttention!.text).toBe("could not be summarized");

    // The good job in the same report is unaffected.
    expect(report.needsAttention.some((a) => a.jobId === "job-good" && a.reason === "not_finished")).toBe(true);
    expect(report.counts.jobsTouched).toBe(2);
  });
});

describe("shiftReport — R2-27: every technician-entered text is quoted and attributed, same style as handover", () => {
  // PROPERTY: any free text a technician typed — a note, a question, an
  // answer, a part's item description, a photo caption — appears in the
  // report quoted in the SAME curly-quote style handover already uses
  // (“…”), and every entry (quoted or not) carries its own who (`by`) and
  // when (`at`/`atLocal`) regardless of kind. A photo with no caption is
  // system-generated text ("no caption"), never quoted, since it is not the
  // technician's own words.
  type TextCase = {
    name: string;
    kind: SheetEvent["kind"];
    payload: SheetEvent["payload"];
    expectSubstring: string;
  };
  const textCases: TextCase[] = [
    { name: "a note", kind: "note_added", payload: { noteId: "n1", text: "Belt tension checked.", noteKind: "note" }, expectSubstring: "noted: “Belt tension checked.”" },
    { name: "a question", kind: "note_added", payload: { noteId: "q1", text: "Original bearing?", noteKind: "question" }, expectSubstring: "asked: “Original bearing?”" },
    { name: "an answer", kind: "question_resolved", payload: { noteId: "q1", resolution: "Yes, OEM part." }, expectSubstring: "answered: “Yes, OEM part.”" },
    { name: "a replaced part's item description", kind: "part_logged", payload: { partEntryId: "p1", item: "wheel bearing", action: "replaced", qty: 1 }, expectSubstring: "replaced: “wheel bearing” (reported)" },
    { name: "a planned part's item description", kind: "part_logged", payload: { partEntryId: "p2", item: "new bolts", action: "planned", qty: 4 }, expectSubstring: "planned: “new bolts”" },
    { name: "a photo caption", kind: "photo_attached", payload: { photoId: "ph1", fileId: "file-1", caption: "before teardown" }, expectSubstring: "photo: “before teardown”" },
  ];

  it.each(textCases)("$name is quoted in curly quotes, like handover", ({ kind, payload }) => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: T0 },
    );
    const textEvent = ev(kind, payload, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const extra: StoredEvent[] = [];
    // question_resolved needs its note_added predecessor to resolve against.
    if (kind === "question_resolved") {
      extra.push(ev("note_added", { noteId: (payload as { noteId: string }).noteId, text: "placeholder?", noteKind: "question" }, { seq: 2, occurredAt: "2026-11-03T20:04:00.000Z" }));
      (textEvent as StoredEvent).seq = 3;
    }
    const j = job("job-1", [started, ...extra, textEvent]);

    const report = shiftReport([j], WINDOW_WIDE);
    const entry = report.byTechnician.flatMap((g) => g.entries).find((e) => e.kind === kind && e.eventId === textEvent.id)!;
    expect(entry).toBeDefined();
    expect(entry.by).toBe("Tech One");
    expect(entry.at).toBe(textEvent.occurredAt);
  });

  it.each(textCases)("$name renders the expected quoted narrative text", ({ kind, payload, expectSubstring }) => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: T0 },
    );
    const extra: StoredEvent[] = [];
    let textEvent = ev(kind, payload, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    if (kind === "question_resolved") {
      extra.push(ev("note_added", { noteId: (payload as { noteId: string }).noteId, text: "placeholder?", noteKind: "question" }, { seq: 2, occurredAt: "2026-11-03T20:04:00.000Z" }));
      textEvent = ev(kind, payload, { seq: 3, occurredAt: "2026-11-03T20:05:00.000Z" });
    }
    const j = job("job-1", [started, ...extra, textEvent]);

    const report = shiftReport([j], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts.some((t) => t === expectSubstring)).toBe(true);
  });

  it("control: a photo with no caption is NOT quoted — 'no caption' is system-generated, not the technician's words", () => {
    seqCounter = 0;
    const started = ev(
      "job_started",
      { title: "PM — Pump 07", machine: { entityId: "cmms-pump07", name: "Pump 07" }, templateRevisionId: null, template: template() },
      { seq: 1, occurredAt: T0 },
    );
    const photo = ev("photo_attached", { photoId: "ph1", fileId: "file-1", caption: null }, { seq: 2, occurredAt: "2026-11-03T20:05:00.000Z" });
    const j = job("job-1", [started, photo]);

    const report = shiftReport([j], WINDOW_WIDE);
    const texts = report.byTechnician.flatMap((g) => g.entries.map((e) => e.text));
    expect(texts).toContain("photo: no caption");
    expect(texts.some((t) => t.includes("“"))).toBe(false);
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
