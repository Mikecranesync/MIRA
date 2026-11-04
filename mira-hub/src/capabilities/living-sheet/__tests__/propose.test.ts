/**
 * TASK-S2 — proposeSheetUpdates. Pure unit tests, one per rule from the
 * spec (docs: .planning/2026-11-04-living-sheet/TASK-S2-proposer-receipt.md),
 * plus determinism, mixed-message ordering and the 8-proposal cap.
 *
 * Fixture views are built with reduceSheet (S1) over hand-built events, so
 * these tests exercise the proposer against the SAME shape the real route
 * hands it — not an ad-hoc object literal that could drift from SheetView.
 */
import { describe, expect, it } from "vitest";
import { proposeSheetUpdates } from "../propose";
import { reduceSheet, type StoredEvent } from "../reduce";
import type { JobSheetBody, JobStartedPayload, ReadingRecordedPayload, SheetEvent } from "../types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-11-03T12:00:00.000Z";
const T1 = "2026-11-03T12:05:00.000Z";

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
    torques: [{ id: "t1", what: "cover bolts", value: 25, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: "manual p4" }],
    steps: [
      { id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null },
      { id: "step-2", text: "Torque cover bolts", checkoff: "torque", torqueRef: "t1", source: null },
      { id: "step-3", text: "Record motor current", checkoff: "measurement", torqueRef: null, source: null },
    ],
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

function started(over: Partial<JobStartedPayload> = {}): StoredEvent {
  seqCounter = 0;
  const payload: JobStartedPayload = {
    title: "PM — Pump 07",
    machine: { entityId: "cmms-pump07", name: "Pump 07" },
    templateRevisionId: null,
    template: template(),
    ...over,
  };
  return ev("job_started", payload, { seq: 1 });
}

function emptyView() {
  return reduceSheet([started()], JOB_ID);
}

function viewWithReading(reading: Partial<ReadingRecordedPayload> = {}) {
  const base = started();
  const r = ev(
    "reading_recorded",
    { readingId: "22222222-2222-4222-8222-222222222222", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null }, ...reading },
    { occurredAt: T1, recordedAt: T1 },
  );
  return reduceSheet([base, r], JOB_ID);
}

describe("Reading", () => {
  it("'motor current 48 A' -> reading_recorded, what='motor current', value 48, unit A, needs_tap", () => {
    const proposals = proposeSheetUpdates("motor current 48 A", emptyView());
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.event.kind).toBe("reading_recorded");
    const payload = p.event.payload as ReadingRecordedPayload;
    expect(payload.what).toBe("motor current");
    expect(payload.value).toBe(48);
    expect(payload.unit).toBe("A");
    expect(p.risk).toBe("needs_tap");
  });

  it("normalizes unit spellings (volts, degrees F, ft lbs, Nm, ohms)", () => {
    const cases: [string, string, number][] = [
      ["temp 90 degrees F", "°F", 90],
      ["supply 220 volts", "V", 220],
      ["torqued to 25 ft lbs", "ft-lb", 25],
      ["torque 12 Nm", "N·m", 12],
      ["resistance 4 ohms", "Ω", 4],
    ];
    for (const [text, unit, value] of cases) {
      const proposals = proposeSheetUpdates(text, emptyView());
      const reading = proposals.find((p) => p.event.kind === "reading_recorded");
      expect(reading, `expected a reading for "${text}"`).toBeDefined();
      const payload = reading!.event.payload as ReadingRecordedPayload;
      expect(payload.unit).toBe(unit);
      expect(payload.value).toBe(value);
    }
  });

  // F11 — numeric parsing never truncates a number.
  it("'.8 A' -> 0.8 A, not 8 A (leading-dot decimal is never dropped)", () => {
    const proposals = proposeSheetUpdates("leak test .8 A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeDefined();
    expect((reading!.event.payload as ReadingRecordedPayload).value).toBe(0.8);
    expect((reading!.event.payload as ReadingRecordedPayload).unit).toBe("A");
  });

  it("'1,200 A' -> 1200 A, not the truncated fragment 200 A", () => {
    const proposals = proposeSheetUpdates("inrush current 1,200 A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeDefined();
    expect((reading!.event.payload as ReadingRecordedPayload).value).toBe(1200);
    expect((reading!.event.payload as ReadingRecordedPayload).unit).toBe("A");
  });

  it("'0.8A' (no space) still works", () => {
    const proposals = proposeSheetUpdates("leak test 0.8A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeDefined();
    expect((reading!.event.payload as ReadingRecordedPayload).value).toBe(0.8);
    expect((reading!.event.payload as ReadingRecordedPayload).unit).toBe("A");
  });
});

describe("No unit", () => {
  it("'it read 48' -> note_added question, needs_tap, no reading", () => {
    const proposals = proposeSheetUpdates("it read 48", emptyView());
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.event.kind).toBe("note_added");
    expect((p.event.payload as { noteKind: string }).noteKind).toBe("question");
    expect((p.event.payload as { text: string }).text).toContain("48");
    expect(p.risk).toBe("needs_tap");
  });
});

describe("Correction", () => {
  it("'I meant 4.8' corrects the only reading whose value differs (no quantity/old-value needed when unambiguous)", () => {
    const view = viewWithReading();
    const proposals = proposeSheetUpdates("I meant 4.8", view);
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.event.kind).toBe("reading_corrected");
    const payload = p.event.payload as { readingId: string; value: number; unit: string };
    expect(payload.value).toBe(4.8);
    expect(payload.unit).toBe("A"); // inherited from target
    expect(p.risk).toBe("needs_tap");
    expect(p.reason).toContain("48 A");
    expect(p.reason).toContain("4.8 A");
  });

  it("'correction 4.8 A' matches the reading by explicit unit", () => {
    const view = viewWithReading();
    const proposals = proposeSheetUpdates("correction 4.8 A", view);
    expect(proposals[0]!.event.kind).toBe("reading_corrected");
    expect((proposals[0]!.event.payload as { unit: string }).unit).toBe("A");
  });

  it("'not 48, 4.8' takes the value after the comma as the new value", () => {
    const view = viewWithReading();
    const proposals = proposeSheetUpdates("not 48, 4.8", view);
    expect(proposals[0]!.event.kind).toBe("reading_corrected");
    expect((proposals[0]!.event.payload as { value: number }).value).toBe(4.8);
  });

  it("no readings -> no correction proposal", () => {
    const proposals = proposeSheetUpdates("I meant 4.8", emptyView());
    expect(proposals).toHaveLength(0);
  });

  // F10 — "should be X" / "spec is X" / "rated X" states a specification,
  // not a measurement: no reading, no correction, for the whole clause.
  it("'should be 4.8 A' is a specification -> no reading, no correction", () => {
    const view = viewWithReading();
    expect(proposeSheetUpdates("should be 4.8 A", view)).toHaveLength(0);
  });

  it("'spec is 5 A' / 'rated 5 A' are specifications -> no proposal", () => {
    const view = viewWithReading();
    for (const text of ["spec is 5 A", "rated 5 A"]) {
      expect(proposeSheetUpdates(text, view), text).toHaveLength(0);
    }
  });

  // F10 — targets the reading whose NAMED QUANTITY matches, not just the
  // most-recently-updated reading sharing a unit.
  function viewWithTwoAmpReadings() {
    const base = started();
    const motor = ev(
      "reading_recorded",
      { readingId: "22222222-2222-4222-8222-222222222222", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T0, recordedAt: T0 },
    );
    const brake = ev(
      "reading_recorded",
      { readingId: "33333333-3333-4333-8333-333333333333", what: "brake current", value: 30, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T1, recordedAt: T1 }, // brake is the MORE RECENT of the two -- the old "most recent" heuristic would wrongly pick it
    );
    return reduceSheet([base, motor, brake], JOB_ID);
  }

  it("'I meant motor current 4.8 A' corrects motor current only, not the more-recently-updated brake current", () => {
    const view = viewWithTwoAmpReadings();
    const proposals = proposeSheetUpdates("I meant motor current 4.8 A", view);
    expect(proposals).toHaveLength(1);
    const payload = proposals[0]!.event.payload as { readingId: string; value: number };
    expect(payload.readingId).toBe("22222222-2222-4222-8222-222222222222"); // motor current
    expect(payload.value).toBe(4.8);
  });

  it("ambiguous target (same unit, no named quantity, no stated old value) -> propose nothing, never guess", () => {
    const view = viewWithTwoAmpReadings();
    expect(proposeSheetUpdates("I meant 4.8 A", view)).toHaveLength(0);
  });

  it("a stated old value disambiguates even without naming the quantity", () => {
    const view = viewWithTwoAmpReadings();
    const proposals = proposeSheetUpdates("not 48, 4.8", view);
    expect(proposals).toHaveLength(1);
    const payload = proposals[0]!.event.payload as { readingId: string; value: number };
    expect(payload.readingId).toBe("22222222-2222-4222-8222-222222222222"); // the reading whose OLD value was 48
    expect(payload.value).toBe(4.8);
  });
});

describe("Step done", () => {
  it("'done step 3' / 'step 3 done' / 'finished step 3' all mark step index 2 (measurement) done, needs_tap", () => {
    for (const text of ["done step 3", "step 3 done", "finished step 3"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      const p = proposals[0]!;
      expect(p.event.kind).toBe("step_marked");
      const payload = p.event.payload as { stepId: string; done: boolean };
      expect(payload.stepId).toBe("step-3");
      expect(payload.done).toBe(true);
      expect(p.risk).toBe("needs_tap"); // checkoff === "measurement"
    }
  });

  it("a plain step (checkoff none) done is low risk", () => {
    const proposals = proposeSheetUpdates("done step 1", emptyView());
    expect(proposals[0]!.risk).toBe("low");
  });

  it("'step 3 not done' / 'undo step 3' mark done=false, needs_tap", () => {
    for (const text of ["step 3 not done", "undo step 3"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      const payload = proposals[0]!.event.payload as { done: boolean };
      expect(payload.done).toBe(false);
      expect(proposals[0]!.risk).toBe("needs_tap");
    }
  });
});

// F09 — questions and negations about completion/replacement must never
// become an affirmative work proposal (step_marked done=true, or
// part_logged replaced). A plain question may still become an open
// question (the proposer already does that for "?"); a negation with no
// other trigger just falls through to the generic fallback note.
describe("Questions and negations never become work proposals", () => {
  it("'Is step 1 done?' -> no step_marked; becomes an open question", () => {
    const proposals = proposeSheetUpdates("Is step 1 done?", emptyView());
    for (const p of proposals) expect(p.event.kind).not.toBe("step_marked");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("question");
  });

  it("'I have not done step 1' -> no step_marked at all (not even done=false)", () => {
    const proposals = proposeSheetUpdates("I have not done step 1", emptyView());
    for (const p of proposals) expect(p.event.kind).not.toBe("step_marked");
  });

  it("'Have we replaced the seal?' -> no part_logged; becomes an open question", () => {
    const proposals = proposeSheetUpdates("Have we replaced the seal?", emptyView());
    for (const p of proposals) expect(p.event.kind).not.toBe("part_logged");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("question");
  });

  it("'did we replace the bearing' -> no part_logged (no work proposal)", () => {
    const proposals = proposeSheetUpdates("did we replace the bearing", emptyView());
    for (const p of proposals) {
      expect(p.event.kind).not.toBe("part_logged");
      expect(p.event.kind).not.toBe("step_marked");
    }
  });
});

describe("Parts", () => {
  it("planned phrasing -> part_logged planned, low", () => {
    for (const text of ["will replace the seal", "going to replace the seal", "need to replace the seal", "need a new seal"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      const payload = proposals[0]!.event.payload as { action: string; item: string };
      expect(payload.action).toBe("planned");
      expect(payload.item).toContain("seal");
      expect(proposals[0]!.risk).toBe("low");
    }
  });

  it("reported-action phrasing -> part_logged replaced, needs_tap", () => {
    for (const text of ["replaced the seal", "swapped the seal", "changed out the seal", "put in a new seal"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      const payload = proposals[0]!.event.payload as { action: string };
      expect(payload.action).toBe("replaced");
      expect(proposals[0]!.risk).toBe("needs_tap");
    }
  });
});

describe("Question", () => {
  it("a '?' -> note_added question, low", () => {
    const proposals = proposeSheetUpdates("is this normal?", emptyView());
    expect(proposals).toHaveLength(1);
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("question");
    expect(proposals[0]!.risk).toBe("low");
  });

  it("'not sure' / 'need to check' / 'don't know' -> question, low", () => {
    for (const text of ["not sure about this one", "need to check the manual", "don't know what this is"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect((proposals[0]!.event.payload as { noteKind: string }).noteKind, text).toBe("question");
    }
  });
});

describe("Handover", () => {
  it("'handover:' prefix -> handover_written, needs_tap", () => {
    const proposals = proposeSheetUpdates("handover: bearing is still noisy", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("handover_written");
    expect(proposals[0]!.risk).toBe("needs_tap");
  });

  it("'for next shift' / 'next shift' -> handover_written", () => {
    for (const text of ["leave this for next shift", "next shift should recheck the belt"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals[0]!.event.kind, text).toBe("handover_written");
    }
  });
});

describe("Completion", () => {
  it("never emits job_finished — emits a needs_tap note instead", () => {
    for (const text of ["job done", "all done", "finished the job", "job complete", "it's fixed"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      expect(proposals[0]!.event.kind).not.toBe("job_finished");
      expect(proposals[0]!.event.kind).toBe("note_added");
      expect(proposals[0]!.risk).toBe("needs_tap");
      expect((proposals[0]!.event.payload as { text: string }).text).toContain("Finish it from the sheet");
    }
  });
});

describe("LOTO / safety", () => {
  it("never marks a step done, never touches isolation — one needs_tap note verbatim", () => {
    const text = "performing lockout tagout, done step 2";
    const proposals = proposeSheetUpdates(text, emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { text: string }).text).toBe(text);
    expect(proposals[0]!.reason).toContain("isolation follows your site procedure");
    expect(proposals[0]!.risk).toBe("needs_tap");
  });

  it("matches lockout/tagout/isolate/zero energy/de-energized variants", () => {
    for (const text of ["performing lockout tagout now", "isolating the breaker first", "zero energy verified", "de-energized the line"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      expect(proposals[0]!.event.kind).toBe("note_added");
      expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("note");
    }
  });
});

describe("Fallback", () => {
  it(">=3 words with no other match -> note_added note, low", () => {
    const proposals = proposeSheetUpdates("pump sounds different today", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("note");
    expect(proposals[0]!.risk).toBe("low");
  });

  it("< 3 words with no other match -> nothing", () => {
    expect(proposeSheetUpdates("ok fine", emptyView())).toHaveLength(0);
    expect(proposeSheetUpdates("yep", emptyView())).toHaveLength(0);
  });
});

describe("Mixed messages", () => {
  it("one message yields several proposals, in text order", () => {
    const text = "done step 1. motor current 48 A. replaced the seal.";
    const proposals = proposeSheetUpdates(text, emptyView());
    expect(proposals.map((p) => p.event.kind)).toEqual(["step_marked", "reading_recorded", "part_logged"]);
  });

  it("caps at 8 proposals", () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `reading ${i} ${10 + i} A`).join(". ");
    const proposals = proposeSheetUpdates(sentences, emptyView());
    expect(proposals.length).toBeLessThanOrEqual(8);
  });
});

describe("Determinism", () => {
  it("same text + same view -> same proposals (including ids)", () => {
    const view = emptyView();
    const a = proposeSheetUpdates("motor current 48 A. replaced the seal.", view);
    const b = proposeSheetUpdates("motor current 48 A. replaced the seal.", view);
    expect(a).toEqual(b);
  });

  it("proposalIds vary by index within one call", () => {
    const proposals = proposeSheetUpdates("done step 1. replaced the seal.", emptyView());
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals[0]!.proposalId).not.toBe(proposals[1]!.proposalId);
  });

  // F08 — proposal (and payload sub-) ids include the turn identity, so the
  // SAME words in two SEPARATE turns produce two DISTINCT proposals, while
  // replaying the SAME turn stays idempotent.
  it("same text + same view + same turnId -> same proposal AND payload ids (idempotent replay)", () => {
    const view = viewWithReading();
    const a = proposeSheetUpdates("motor current 48 A", view, "turn-1");
    const b = proposeSheetUpdates("motor current 48 A", view, "turn-1");
    expect(a).toEqual(b);
  });

  it("same text + same view, DIFFERENT turnId -> distinct proposal AND readingId", () => {
    const view = viewWithReading();
    const a = proposeSheetUpdates("motor current 48 A", view, "turn-1");
    const b = proposeSheetUpdates("motor current 48 A", view, "turn-2");
    expect(a[0]!.proposalId).not.toBe(b[0]!.proposalId);
    const aPayload = a[0]!.event.payload as ReadingRecordedPayload;
    const bPayload = b[0]!.event.payload as ReadingRecordedPayload;
    expect(aPayload.readingId).not.toBe(bPayload.readingId);
  });
});

describe("Frame contract", () => {
  it("quote is drawn from the tech's own text", () => {
    const proposals = proposeSheetUpdates("motor current 48 A", emptyView());
    expect(proposals[0]!.quote).toContain("48");
  });
});
