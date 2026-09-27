/**
 * #4067 follow-up: the "Safety flag on a step below" banner must quote the
 * flagged step as the technician will read it in the answer — the step's own
 * source line — never a detection fragment of the folded copy.
 *
 * Fixture: the persisted staging answer (notebook e23b0d9a, hub 0994b31a4),
 * verbatim, including its U+2011 hyphens and U+202F space. Before the fix it
 * was quoted as `“. 2. Measure DC-bus voltage (with the drive powered”`:
 * a leading ". " from the list marker split, cut mid-parenthesis, and the
 * U+2011 in "DC‑bus" silently rewritten to ASCII by the detection fold.
 */
import { describe, expect, it } from "vitest";

import { flaggedStepQuote, validateAnswer } from "./answer-validation";

const STAGING_GS10_ANSWER = "The first thing to check is whether the drive is losing its DC\u2011bus voltage or seeing a rapid drop during the acceleration ramp.  \n\n1. **Verify power isolation** \u2013 lockout/tagout the drive, confirm the DC bus is at 0\u202fV before opening the enclosure.  \n2. **Measure DC\u2011bus voltage** (with the drive powered but still locked out for safety) while you command a short test acceleration; watch for a sudden dip that could cause an over\u2011current (oC) trip.  \n3. **Inspect input supply and rectifier** \u2013 check that the AC input is stable, fuses are intact, and the bridge rectifier shows no blown diodes or excessive heating.  \n4. **Check motor wiring and connections** \u2013 ensure all phase conductors are tight, no loose terminals that could cause a momentary short during start\u2011up.  \n5. **Review drive parameters** \u2013 confirm the acceleration ramp time and current limit settings are appropriate for this motor; typical values must be verified against the unit\u2019s manual.  \n\n*Does the DC\u2011bus voltage stay steady during the test acceleration, or does it collapse?*";

const QUOTE = /^⚠️ \*\*Safety flag on a step below:\*\* “([^”]*)”/;

function quoteOf(answerText: string): string {
  const v = validateAnswer({ answerText, question: "GS10 trips oC during acceleration, what should I check first", general: true, served: true, refused: false });
  expect(v.ok).toBe(false);
  if (v.ok || v.kind !== "hazard_warning") throw new Error(`expected hazard_warning, got ${JSON.stringify(v)}`);
  // The answer itself still ships in full under the banner (owner decision 2026-09-27).
  expect(v.replacement.endsWith(answerText)).toBe(true);
  const m = QUOTE.exec(v.replacement);
  if (!m) throw new Error(`no quote in: ${v.replacement.slice(0, 200)}`);
  return m[1];
}

describe("hazard banner quotes the flagged step's own line (#4067)", () => {
  it("quotes step 2 whole, as written, for the real staging answer", () => {
    expect(quoteOf(STAGING_GS10_ANSWER)).toBe(
      "2. Measure DC\u2011bus voltage (with the drive powered but still locked out for safety) while you command a short test acceleration; watch for a sudden dip that could cause an over\u2011current (oC) trip.",
    );
  });

  it("never opens with stray punctuation and never rewrites the original spelling", () => {
    const q = quoteOf(STAGING_GS10_ANSWER);
    expect(q).not.toMatch(/^[\s.,;:]/);
    expect(q).toContain("DC\u2011bus");
    expect(q.length).toBeLessThanOrEqual(401);
  });

  it("a one-sentence flagged answer is quoted as that sentence", () => {
    expect(quoteOf("It is safe to open the cabinet while the drive is powered on.")).toBe(
      "It is safe to open the cabinet while the drive is powered on.",
    );
  });

  it("a long single-line paragraph quotes the flagged SENTENCE, not the paragraph opening", () => {
    const answer =
      "Start by reading the fault history on the keypad and note the last three trip codes with their timestamps. " +
      "Then compare the acceleration time in parameter 01.12 against the load inertia before changing anything else. " +
      "It is safe to open the cabinet while the drive is powered on. After that, check the motor leads.";
    expect(quoteOf(answer)).toBe("It is safe to open the cabinet while the drive is powered on.");
  });

  it("a fragment found in no line falls back to the cleaned fragment, never an empty or debris-led quote", () => {
    expect(flaggedStepQuote(". Open the panel while the drive is live", "Something unrelated entirely.")).toBe(
      "Open the panel while the drive is live",
    );
  });

  // Safety-review findings on 89f9a4dd (PARTIAL Claude-lane review).
  it("R1: repeated wording — quotes the sentence detection flagged, not an earlier exempted twin", () => {
    const shared =
      "The fault should be reset while the machine is energized during the scheduled maintenance window as instructed by the supervisor";
    const q = quoteOf(`${shared} under no circumstances. ${shared} to save time.`);
    expect(q).toContain("to save time");
    expect(q).not.toContain("under no circumstances");
  });

  it("R2: masked-clause detail — quotes the real sentence, never the masked debris", () => {
    const answer =
      "Restore power to the drive and measure the voltage at the output terminals. " +
      "The fault should be reset while the machine is energized, then the current on each phase should be measured.";
    const q = quoteOf(answer);
    expect(q).not.toMatch(/,\s*\.$/);
    expect(q).toContain("The fault should be reset while the machine is energized");
  });

  it("R3: a long run-on sentence — the quote shows the hazardous words, not the harmless opening", () => {
    const preamble =
      "For context many technicians ask whether the panel needs power for the test and whether the drive can stay on line " +
      "during the whole diagnostic sequence and in that case the recommendation that follows applies to this model and you can ";
    const q = quoteOf(`${preamble}reset the fault while the machine is energized to finish the test quickly.`);
    expect(q).toContain("reset the fault while the machine is energized");
    expect(q.length).toBeLessThanOrEqual(401);
  });

  // Round-2 safety review (e1df3445): the quote must follow the detector's
  // match POSITION, not the first textual copy of the flagged words.
  it("R4: reported speech earlier in the answer — quotes the instruction the detector flagged", () => {
    const q = quoteOf(
      'He said, "Reset the fault while the machine is energized," but that is actually unsafe advice. ' +
        "Reset the fault while the machine is energized to speed up the test.",
    );
    expect(q).toContain("to speed up the test");
    expect(q).not.toContain("He said");
  });

  it("R5: a dash bullet does not lead the quote", () => {
    expect(quoteOf("— Reset the fault while the machine is energized to finish the test quickly.\n")).toBe(
      "Reset the fault while the machine is energized to finish the test quickly.",
    );
  });

  // Codex round 1 (#4072 @c8ad2989): a clause-level (A2) match reports the
  // sentence start; a long passive sentence must still show the hazard.
  it("C1: a long passive sentence quotes the hazardous clause, not 160 chars of context", () => {
    const answer =
      "For context this machine has a long operating history and the technician should first review its prior trips " +
      "and maintenance records to understand the pattern of faults over the last several months of production so that " +
      "the fault should be reset while the machine is energized.";
    const v = validateAnswer({ answerText: answer, question: "why does it trip", general: true, served: true, refused: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toMatch(/^unsafe-answer:clause-hazard-/);
    expect(quoteOf(answer)).toContain("reset while the machine is energized");
  });

  // Codex round 2 (#4072 @cb3d8d9c): any truncation heuristic can cut the
  // action off. A flagged sentence up to 400 chars is quoted WHOLE.
  it("C2: relation first, action last, >160 chars — the quote holds both", () => {
    const answer =
      "While the machine is energized, the operator should review the maintenance history and check prior events and note all " +
      "relevant timestamps and compare them against the shift log and the alarm journal before the fault should be reset.";
    const v = validateAnswer({ answerText: answer, question: "why does it trip", general: true, served: true, refused: false });
    expect(v.ok).toBe(false);
    const q = quoteOf(answer);
    expect(q).toContain("While the machine is energized");
    expect(q).toContain("the fault should be reset");
  });
});

