/**
 * Unit coverage for `jobFinishedNote` (TASK-S7) — pure function, no I/O.
 * Banned words, open items, and the "corrected from" reading note are the
 * three behaviors the spec names explicitly.
 */
import { describe, expect, it } from "vitest";
import { jobFinishedNote } from "../finish-outbox";
import type { SheetReadingView, SheetStepView, SheetView } from "../reduce";

function step(over: Partial<SheetStepView> = {}): SheetStepView {
  return {
    id: "step-1",
    text: "Check seal",
    checkoff: "none",
    torqueRef: null,
    source: null,
    done: false,
    doneBy: null,
    doneAt: null,
    note: null,
    history: [],
    ...over,
  };
}

function reading(over: Partial<SheetReadingView> = {}): SheetReadingView {
  return {
    id: "r-1",
    what: "motor current",
    current: { value: 4.8, unit: "A", by: "tech-1", at: "2026-11-03T00:00:00.000Z", eventId: "e-2" },
    history: [
      { value: 48, unit: "A", by: "tech-1", at: "2026-11-03T00:00:00.000Z", eventId: "e-1", superseded: true },
      { value: 4.8, unit: "A", by: "tech-1", at: "2026-11-03T00:00:00.000Z", eventId: "e-2", superseded: false },
    ],
    source: null,
    ...over,
  };
}

function baseView(over: Partial<SheetView> = {}): SheetView {
  return {
    jobId: "job-1",
    seq: 2,
    title: "Light wheel bearing",
    machine: { entityId: "ent-1", name: "Pump 07" },
    templateRevisionId: null,
    templateStatus: null,
    template: {
      title: "Light wheel bearing",
      machineLabel: null,
      component: null,
      jobType: null,
      estHours: null,
      crewSize: null,
      isolationPoints: null,
      cautions: null,
      returnToService: [],
      items: [],
      torques: [],
      steps: [],
      author: null,
      notes: null,
    },
    steps: [],
    readings: [],
    parts: [],
    notes: [],
    questions: [],
    photos: [],
    handover: { current: null, history: [] },
    finished: { by: "Mike", at: "2026-11-03T00:00:00.000Z", summary: null },
    openSteps: 0,
    openQuestions: 0,
    warnings: [],
    ...over,
  };
}

const BANNED = ["fixed", "safe", "repaired", "resolved"];

describe("jobFinishedNote", () => {
  it("MIRA's own wording never uses the banned words; the technician's words are quoted verbatim, never rewritten", () => {
    const techText = "Make sure the area is safe; the repaired bolt is resolved and fixed";
    const v = baseView({
      steps: [step({ id: "s1", text: techText, done: false })],
      openSteps: 1,
    });
    const text = jobFinishedNote(v);
    // Verbatim, inside quotes: a record must never misquote the technician.
    expect(text).toContain(`"${techText}"`);
    // Everything outside quoted technician text is MIRA's framing.
    const framing = text.replace(/"[^"]*"/g, "");
    for (const banned of BANNED) {
      expect(framing.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    expect(text).toContain("still open");
  });

  it("reports open steps by 1-based position and text, and the title", () => {
    const steps = [
      step({ id: "s1", done: true }),
      step({ id: "s2", done: true }),
      step({ id: "s3", done: true }),
      step({ id: "s4", text: "Torque bolts", done: false }),
    ];
    const v = baseView({ steps, openSteps: 1 });
    const text = jobFinishedNote(v);
    expect(text).toContain("Light wheel bearing");
    expect(text).toContain("Steps done 3 of 4");
    expect(text).toContain('step 4 "Torque bolts"');
    expect(text).toContain("still open");
  });

  it("reports open questions when present, omits the clause when zero", () => {
    const withQ = jobFinishedNote(baseView({ openQuestions: 1 }));
    expect(withQ).toContain("Open questions: 1");
    const withoutQ = jobFinishedNote(baseView({ openQuestions: 0 }));
    expect(withoutQ).not.toContain("Open questions");
  });

  it("shows a corrected reading as the current value with the prior value noted", () => {
    const v = baseView({ readings: [reading()] });
    const text = jobFinishedNote(v);
    expect(text).toContain("motor current 4.8 A");
    expect(text).toContain("corrected from 48 A");
  });

  it("omits the readings clause when no reading was ever corrected", () => {
    const v = baseView({
      readings: [
        reading({
          history: [{ value: 4.8, unit: "A", by: "tech-1", at: "2026-11-03T00:00:00.000Z", eventId: "e-1", superseded: false }],
        }),
      ],
    });
    expect(jobFinishedNote(v)).not.toContain("Readings:");
  });

  it("stays under 1000 chars even with many open steps and long step text", () => {
    const steps = Array.from({ length: 50 }, (_, i) =>
      step({ id: `s${i}`, text: `Step number ${i} with a reasonably long description of the required work`, done: false }),
    );
    const v = baseView({ steps, openSteps: steps.length });
    expect(jobFinishedNote(v).length).toBeLessThan(1000);
  });

  it("omits the reported-by clause when there is no resolvable actor", () => {
    const v = baseView({ finished: { by: null, at: "2026-11-03T00:00:00.000Z", summary: null } });
    const text = jobFinishedNote(v);
    expect(text).toContain('Job sheet finished: "Light wheel bearing"');
    expect(text).not.toContain("reported by");
  });

  it("includes the reported-by actor when present", () => {
    const text = jobFinishedNote(baseView({ finished: { by: "Mike", at: "2026-11-03T00:00:00.000Z", summary: null } }));
    expect(text).toContain("reported by Mike");
  });
});
