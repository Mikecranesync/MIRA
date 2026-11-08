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

// R2-09 (F11 round 2) — PROPERTY: a number token comes from a strict,
// full-token grammar (optional sign, digits with optional thousands
// commas, optional single decimal point) and must be BOUNDED — nothing
// adjacent that would mean it's really a fragment of a larger non-numeric
// construct ("/", "e"/exponent, another digit, a "-" range, or a letter
// that isn't the start of a real unit). The round-1 fix only tested two
// repaired cases (".8", "1,200"); round 2 found the underlying grammar was
// never actually enforced — a raw regex scan finds digit substrings
// anywhere, fraction/exponent/range/malformed-group fragments included.
describe("Number grammar (R2-09)", () => {
  const UNBOUNDED_CASES: [label: string, text: string][] = [
    ["fraction", "leak test 1/2 A"],
    ["exponent, positive", "leak test 1e3 A"],
    ["exponent, negative", "leak test 1e-3 A"],
    ["range", "leak test 4-5 A"],
    ["double decimal point", "leak test 4..8 A"],
    ["malformed thousands grouping (2 digits after comma)", "leak test 1,20 A"],
    ["digit glued to a non-unit letter prefix", "leak test v2 A"],
    ["digit glued to a non-unit letter suffix", "leak test 48xyz A"],
    ["two numbers glued with no separator", "leak test 48,,2 A"],
    ["bare exponent marker with no sign", "leak test 2e5 A"],
    ["fraction with decimal", "leak test 1.5/2 A"],
    ["range with decimals", "leak test 4.5-5.5 A"],
  ];

  it.each(UNBOUNDED_CASES)("%s: %j -> no reading_recorded at all (the malformed token is the clause's only number)", (_label, text) => {
    const proposals = proposeSheetUpdates(text, emptyView());
    const readings = proposals.filter((p) => p.event.kind === "reading_recorded");
    expect(readings, text).toHaveLength(0);
  });

  // The reviewer's exact counterexamples, asserted precisely.
  it("'1/2 A' never yields a reading of 2 A", () => {
    const proposals = proposeSheetUpdates("leak test 1/2 A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeUndefined();
  });

  it("'1e3 A' never yields a reading of 3 A", () => {
    const proposals = proposeSheetUpdates("leak test 1e3 A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeUndefined();
  });

  it("'1e-3 A' never yields a reading of -3 A", () => {
    const proposals = proposeSheetUpdates("leak test 1e-3 A", emptyView());
    const reading = proposals.find((p) => p.event.kind === "reading_recorded");
    expect(reading).toBeUndefined();
  });

  it("'4-5 A' (a range) never yields a reading of 4 A or -5 A", () => {
    const proposals = proposeSheetUpdates("leak test 4-5 A", emptyView());
    const readings = proposals.filter((p) => p.event.kind === "reading_recorded");
    for (const r of readings) {
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(4);
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(-5);
    }
  });

  it("'4..8 A' (double decimal point) never yields a reading of 4 A or 0.8 A", () => {
    const proposals = proposeSheetUpdates("leak test 4..8 A", emptyView());
    const readings = proposals.filter((p) => p.event.kind === "reading_recorded");
    for (const r of readings) {
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(4);
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(0.8);
    }
  });

  it("'1,20 A' (malformed thousands grouping) never yields a reading of 1 A or 20 A", () => {
    const proposals = proposeSheetUpdates("leak test 1,20 A", emptyView());
    const readings = proposals.filter((p) => p.event.kind === "reading_recorded");
    for (const r of readings) {
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(1);
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(20);
    }
  });

  it("'v2 3 A' never reads the '2' in 'v2' as a value, but the clean '3 A' is still a valid bounded reading", () => {
    const proposals = proposeSheetUpdates("v2 3 A", emptyView());
    const readings = proposals.filter((p) => p.event.kind === "reading_recorded");
    for (const r of readings) {
      expect((r.event.payload as ReadingRecordedPayload).value).not.toBe(2);
    }
    // the clean, well-separated "3 A" is a legitimate bounded number and
    // must still be read -- a malformed neighbor must not suppress it.
    expect(readings.some((r) => (r.event.payload as ReadingRecordedPayload).value === 3)).toBe(true);
  });

  // Regression guards: existing valid grammar must still work.
  it("regression: '.8 A' / '1,200 A' / '0.8A' still read correctly", () => {
    expect(
      (proposeSheetUpdates("leak test .8 A", emptyView())[0]!.event.payload as ReadingRecordedPayload).value,
    ).toBe(0.8);
    expect(
      (proposeSheetUpdates("inrush current 1,200 A", emptyView())[0]!.event.payload as ReadingRecordedPayload).value,
    ).toBe(1200);
    expect(
      (proposeSheetUpdates("leak test 0.8A", emptyView())[0]!.event.payload as ReadingRecordedPayload).value,
    ).toBe(0.8);
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

// R2-10 (F10 round 2) — PROPERTY: a correction targets a reading ONLY via
// (a) an EXACT, full quantity label match (every qualifier word — "fan
// current" is a different label than "motor current", not a fuzzy near
// match) or (b) a stated old value that uniquely matches. When a name IS
// given and it does NOT match any reading's full label, the correction is
// dropped entirely — it must NEVER fall back to the sole unit-compatible
// reading, even when that fallback would (by coincidence) be unambiguous.
// Round 1's fix used word-overlap SCORING, which the round-2 reviewer broke
// by naming a *different* quantity that merely shares one word ("current").
describe("Correction targets the exact named quantity, never a shared word (R2-10)", () => {
  function viewWithOneReading() {
    return reduceSheet(
      [
        started(),
        ev(
          "reading_recorded",
          { readingId: "22222222-2222-4222-8222-222222222222", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
          { occurredAt: T1, recordedAt: T1 },
        ),
      ],
      JOB_ID,
    );
  }

  function viewWithTwoNamedReadings() {
    const base = started();
    const motor = ev(
      "reading_recorded",
      { readingId: "22222222-2222-4222-8222-222222222222", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T0, recordedAt: T0 },
    );
    const brake = ev(
      "reading_recorded",
      { readingId: "33333333-3333-4333-8333-333333333333", what: "brake current", value: 30, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T1, recordedAt: T1 },
    );
    return reduceSheet([base, motor, brake], JOB_ID);
  }

  // The reviewer's exact counterexample: a name that shares one word with
  // the ONLY stored reading, but is not the same full label.
  it("'I meant fan current 4.8 A' with only 'motor current' stored -> no correction (shared word 'current' is not enough)", () => {
    const view = viewWithOneReading();
    expect(proposeSheetUpdates("I meant fan current 4.8 A", view)).toHaveLength(0);
  });

  it("'I meant fan current 4.8 A' with 'motor current' + 'brake current' stored -> no correction (matches neither)", () => {
    const view = viewWithTwoNamedReadings();
    expect(proposeSheetUpdates("I meant fan current 4.8 A", view)).toHaveLength(0);
  });

  it("'correction fan current 4.8 A' (the other trigger word) -> no correction either", () => {
    const view = viewWithOneReading();
    expect(proposeSheetUpdates("correction fan current 4.8 A", view)).toHaveLength(0);
  });

  it("a PARTIAL label (missing a qualifier word) does not match -- 'brake' alone is not 'brake current'", () => {
    const view = viewWithTwoNamedReadings();
    expect(proposeSheetUpdates("I meant brake 4.8 A", view)).toHaveLength(0);
  });

  it("an EXTRA qualifier word (more than the stored label) does not match either", () => {
    const view = viewWithOneReading();
    expect(proposeSheetUpdates("I meant motor current reading 4.8 A", view)).toHaveLength(0);
  });

  it("the exact full label still matches, case- and whitespace-insensitively", () => {
    const view = viewWithOneReading();
    const proposals = proposeSheetUpdates("I meant   Motor   CURRENT 4.8 A", view);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("reading_corrected");
    const payload = proposals[0]!.event.payload as { readingId: string; value: number };
    expect(payload.readingId).toBe("22222222-2222-4222-8222-222222222222");
    expect(payload.value).toBe(4.8);
  });

  it("exact label match still wins even when it is also the sole unit-compatible reading (not a coincidence we reject)", () => {
    const view = viewWithOneReading();
    const proposals = proposeSheetUpdates("I meant motor current 4.8 A", view);
    expect(proposals).toHaveLength(1);
    expect((proposals[0]!.event.payload as { value: number }).value).toBe(4.8);
  });

  it("a stated old value (no name given) still disambiguates among two readings of the same unit", () => {
    const view = viewWithTwoNamedReadings();
    const proposals = proposeSheetUpdates("not 30, 4.8", view);
    expect(proposals).toHaveLength(1);
    expect((proposals[0]!.event.payload as { readingId: string }).readingId).toBe("33333333-3333-4333-8333-333333333333"); // brake current
  });

  it("an old value that matches BOTH readings (ambiguous) -> propose nothing, never guess", () => {
    const base = started();
    const a = ev(
      "reading_recorded",
      { readingId: "22222222-2222-4222-8222-222222222222", what: "motor current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T0, recordedAt: T0 },
    );
    const b = ev(
      "reading_recorded",
      { readingId: "33333333-3333-4333-8333-333333333333", what: "brake current", value: 48, unit: "A", source: { kind: "tech", ref: null } },
      { occurredAt: T1, recordedAt: T1 },
    );
    const view = reduceSheet([base, a, b], JOB_ID);
    expect(proposeSheetUpdates("not 48, 4.8", view)).toHaveLength(0);
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

// R2-08 (F09 round 2) — PROPERTY: any clause that is a question
// (interrogative opener, or contains "?") or contains a negation (not,
// never, no, none, n't, without, nothing) produces ZERO work proposals of
// any kind — step_marked, reading_recorded, reading_corrected, part_logged,
// or a fact-asserting note (the synthetic completion note, or the generic
// fallback note). A plain question about status may still become an open
// question (note_added, noteKind "question") — that's the one allowed
// non-work response; a bare negation with no other trigger gets NOTHING,
// not even a fallback note, per "when in doubt, propose nothing."
describe("Questions and negations never become work proposals (R2-08)", () => {
  type Case = [label: string, text: string, view?: () => ReturnType<typeof emptyView>];

  // The round-1 fix only covered "?" and a hand-picked negation list; round
  // 2 found it missed bare interrogative openers (no "?") and most of the
  // real negation vocabulary. This table is the PROPERTY, not one example.
  const QUESTION_CASES: Case[] = [
    ["interrogative opener, no '?'", "Is step 1 done"],
    ["interrogative opener + aux, no '?'", "Have we replaced the seal"],
    ["interrogative opener, present-tense verb, no '?'", "did we replace the bearing"],
    ["wh-opener", "What is wrong with step 2"],
    ["modal opener + subject", "Should we torque the cover bolts"],
    ["literal '?'", "Is step 1 done?"],
    ["literal '?' on parts", "Have we replaced the seal?"],
    ["negative-step question", "Isn't step 2 done"],
    ["negative-step question, literal '?'", "step 2 isn't done yet, is it?"],
  ];

  const NEGATION_CASES: Case[] = [
    ["negation 'never' + part verb", "We never replaced the seal"],
    ["negation 'not' inside completion phrase", "Not all done"],
    ["negation via contraction, statement", "step 2 isn't done"],
    ["negation via contraction, no step/part trigger", "didn't torque it"],
    ["negation 'no', no number", "no reading yet"],
    ["negation 'none'", "none of the bolts were torqued"],
    ["negation 'without'", "finished without torquing the cover bolts"],
    ["negation 'nothing'", "nothing was replaced"],
    ["negation via 'haven't'", "I haven't done step 1"],
    ["negation via 'wouldn't'", "it wouldn't start"],
  ];

  it.each(QUESTION_CASES)("question: %s — %j -> no step_marked/part_logged/reading_* and no fact note", (_label, text) => {
    const proposals = proposeSheetUpdates(text, emptyView());
    for (const p of proposals) {
      expect(p.event.kind, text).not.toBe("step_marked");
      expect(p.event.kind, text).not.toBe("part_logged");
      expect(p.event.kind, text).not.toBe("reading_recorded");
      expect(p.event.kind, text).not.toBe("reading_corrected");
      if (p.event.kind === "note_added") {
        // the ONE allowed response to a question: an open question, never a
        // note asserting a fact.
        expect((p.event.payload as { noteKind: string }).noteKind, text).toBe("question");
      }
    }
  });

  it.each(NEGATION_CASES)("negation: %s — %j -> zero proposals of any kind", (_label, text) => {
    const proposals = proposeSheetUpdates(text, emptyView());
    expect(proposals, text).toHaveLength(0);
  });

  // The exact reviewer counterexamples, asserted precisely (not just via the
  // table's generic property check) so a future regression names the exact
  // broken behavior, not just "some case in the table failed."
  it("'Is step 1 done' (no '?') -> becomes an open question, not a state change", () => {
    const proposals = proposeSheetUpdates("Is step 1 done", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("question");
  });

  it("'Have we replaced the seal' (no '?') -> becomes an open question, not part_logged", () => {
    const proposals = proposeSheetUpdates("Have we replaced the seal", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { noteKind: string }).noteKind).toBe("question");
  });

  it("'We never replaced the seal' -> no part_logged (not just 'not'/'haven't'/'didn't'/'no')", () => {
    const proposals = proposeSheetUpdates("We never replaced the seal", emptyView());
    expect(proposals).toHaveLength(0);
  });

  it("'Not all done' -> never becomes 'You said the job is done'", () => {
    const proposals = proposeSheetUpdates("Not all done", emptyView());
    expect(proposals).toHaveLength(0);
  });

  it("a negative-step question ('Isn't step 2 done') never becomes a state change", () => {
    const proposals = proposeSheetUpdates("Isn't step 2 done", emptyView());
    for (const p of proposals) expect(p.event.kind).not.toBe("step_marked");
  });

  it("'step 3 not done' (a plain statement, no interrogative opener) still marks done=false", () => {
    // Regression guard: "not" is ALSO the Step-rule's own grammar. The R2-08
    // gate must not swallow this legitimate, already-shipped case.
    const proposals = proposeSheetUpdates("step 3 not done", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("step_marked");
    expect((proposals[0]!.event.payload as { done: boolean }).done).toBe(false);
  });

  it("'not 48, 4.8' (a plain statement, no interrogative opener) still corrects via the comma form", () => {
    // Regression guard: "not" is ALSO the Correction-rule's own grammar.
    const proposals = proposeSheetUpdates("not 48, 4.8", viewWithReading());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("reading_corrected");
  });

  it("'will replace the seal' (modal opener, elliptical intent, no subject) is not a question, but is no longer a part either (R2-08-followup)", () => {
    // Regression guard: "will"/"would" are interrogative openers in general,
    // but shop shorthand drops the subject ("[I] will replace the seal").
    // It was never a question. As of R2-08-followup it is also not a
    // part_logged — "will replace" is intent, not a completed fact — so it
    // falls through to a verbatim note instead.
    const proposals = proposeSheetUpdates("will replace the seal", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("note_added");
    expect((proposals[0]!.event.payload as { text: string }).text).toBe("will replace the seal");
  });
});

describe("Parts", () => {
  it("R2-08-followup: planned/intent phrasing no longer logs a part — it falls through to a verbatim note", () => {
    // Previously these four phrases special-cased to part_logged{action:"planned"}.
    // The coordinator's probe of c5c2578e8 flagged this as the same class of
    // bug as R2-08 via a different door: a plan is not a completed fact.
    // INTENT_MARKER_RE now catches all four before PART_RE is ever tried, so
    // action:"planned" is retired — see the hazard ledger in the task report.
    for (const text of ["will replace the seal", "going to replace the seal", "need to replace the seal", "need a new seal"]) {
      const proposals = proposeSheetUpdates(text, emptyView());
      expect(proposals, text).toHaveLength(1);
      expect(proposals[0]!.event.kind, text).toBe("note_added");
      expect((proposals[0]!.event.payload as { text: string }).text, text).toBe(text);
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

describe("Modal/future/intent markers never become a work proposal (R2-08-followup)", () => {
  // Coordinator probe of c5c2578e8: the same class of bug as R2-08, found via
  // a different door. A clause with a modal or future/intent marker anywhere
  // in it (will, would, should, could, can, may, might, must, shall,
  // need(s) to, have/has to, going to, gonna, plan(s) to, want(s) to, about
  // to, tomorrow, later, next shift, to-do) is not a completed past fact, so
  // it must never produce part_logged, reading_recorded, a done=true
  // step_marked, or a job-finished note. ONLY a verbatim note_added (text
  // === the tech's own words, not a generated/canned string — a fabricated
  // "What unit is 2?" or "You said the job is done..." is just as much a
  // fact-asserting proposal as the four forbidden kinds) or the existing
  // handover_written path is allowed.
  function assertNoWorkProposal(text: string) {
    const proposals = proposeSheetUpdates(text, emptyView());
    for (const p of proposals) {
      if (p.event.kind === "handover_written") continue;
      if (p.event.kind === "note_added") {
        expect((p.event.payload as { text: string }).text, text).toBe(text);
        continue;
      }
      if (p.event.kind === "step_marked") {
        expect((p.event.payload as { done: boolean }).done, text).not.toBe(true);
        continue;
      }
      throw new Error(
        `${text} -> unexpected kind "${p.event.kind}" (only handover_written, a VERBATIM note_added, or step_marked(done:false) are allowed on an intent/future/modal clause)`,
      );
    }
  }

  it.each([
    // The 3 bugs named verbatim in the coordinator's probe.
    ["Will replace the bearing tomorrow", "future marker (tomorrow) + will"],
    ["Need to replace the seal", "need-to intent"],
    ["Can torque it to 40 Nm", "can (capability, not a measurement)"],
    // The 4 "acceptable" cases from the probe — confirms they stay note_added.
    ["Should replace the seal", "should intent"],
    ["Could change the filter", "could intent"],
    ["Did replace the seal", "past-tense 'did' + bare verb 'replace' (no PART_RE match either way)"],
    ["Is step 1 done", "interrogative opener, not a state change"],
    // The 6 additional cases required by the coordinator's table.
    ["gonna swap the filter", "gonna intent"],
    ["plan to torque to 40 Nm", "plan-to intent, suppresses the reading"],
    ["need 2 new bearings", "need + digit object intent"],
    ["should read 4.8 A", "should intent, suppresses the reading"],
    ["will mark step 2 done", "will intent, suppresses the step_marked(done=true)"],
    ["next shift: replace seal", "next-shift marker — handover_written is allowed, part_logged is not"],
    // A few more modal/future markers not explicitly named, same property.
    ["would replace the bearing", "would intent"],
    ["must torque it to 40 Nm", "must intent, suppresses the reading"],
    ["about to start the pump", "about-to intent"],
    ["will mark the job done", "will intent, suppresses the canned 'You said the job is done' completion note"],
  ] as const)("%s -> no part_logged/reading_recorded/done-step/canned-completion (%s)", (text, _why) => {
    assertNoWorkProposal(text);
  });

  // Keep: these three must still work exactly as before — the property only
  // blocks clauses that ARE intent/future/modal, not completed-fact ones.
  it("'Replaced the seal' still logs a part (completed fact, no intent marker)", () => {
    const proposals = proposeSheetUpdates("Replaced the seal", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("part_logged");
    expect((proposals[0]!.event.payload as { action: string }).action).toBe("replaced");
  });

  it("'Have replaced the seal' still logs a part (perfect tense is completed, not an intent marker)", () => {
    const proposals = proposeSheetUpdates("Have replaced the seal", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("part_logged");
    expect((proposals[0]!.event.payload as { action: string }).action).toBe("replaced");
  });

  it("'Motor current 4.8 A' still records a reading (no intent marker)", () => {
    const proposals = proposeSheetUpdates("Motor current 4.8 A", emptyView());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.event.kind).toBe("reading_recorded");
    const payload = proposals[0]!.event.payload as { value: number; unit: string };
    expect(payload.value).toBe(4.8);
    expect(payload.unit).toBe("A");
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

describe("Correction values must be complete number tokens (Codex #5207 r2 F9)", () => {
  // A prefix of a fraction, exponent, range, doubled dot or bad comma group
  // is not the value the technician said. Propose nothing rather than write
  // a wrong number into the record.
  const fragments = ["1/2", "1e3", "4..8", "4-5", "1,20"];
  const corrected = (text: string) =>
    proposeSheetUpdates(text, viewWithReading()).filter((p) => p.event.kind === "reading_corrected");

  for (const frag of fragments) {
    it(`'I meant ${frag} A' proposes no correction`, () => {
      expect(corrected(`I meant ${frag} A`)).toHaveLength(0);
    });
    it(`'correction ${frag} A' proposes no correction`, () => {
      expect(corrected(`correction ${frag} A`)).toHaveLength(0);
    });
    it(`'not 48, ${frag}' proposes no correction`, () => {
      expect(corrected(`not 48, ${frag}`)).toHaveLength(0);
    });
  }

  it("the old value of 'not X, Y' must be complete too: 'not 4,5 A' (decimal comma) and 'not 1,20 A, 4.8' propose nothing", () => {
    expect(corrected("not 4,5 A")).toHaveLength(0);
    expect(corrected("not 1,20 A, 4.8")).toHaveLength(0);
  });

  it("controls: well-formed values in every trigger still correct", () => {
    for (const text of ["I meant 4.8 A", "correction 4.8 A", "not 48, 4.8", "I meant .8 A", "correction 1,200 A"]) {
      const out = corrected(text);
      expect(out, text).toHaveLength(1);
    }
  });
});
