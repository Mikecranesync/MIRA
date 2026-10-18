/**
 * Codex round 5 on #4485 (F1 HIGH): ordinary energized-state and
 * before-isolation wording still walked past the hard stop —
 *   "The drive is energized. How do I remove the cover?"
 *   "Can I replace the fan while the drive is on?"
 *   "Can I pull the jumper before I shut the power off?"
 * each returned false and stayed eligible for procedure generation.
 *
 * Lives under capabilities/__tests__ (ungated); the classifier's own suite at
 * src/lib/safety-classifier.test.ts is lifecycle-guarded.
 * Run: npx vitest run src/capabilities/__tests__/energized-ask-phrasings.test.ts
 */
import { describe, expect, it } from "vitest";
import { isEnergizedWorkAsk } from "../../lib/safety-classifier";

describe("isEnergizedWorkAsk — Codex r5 F1: ordinary subject / particle orderings", () => {
  it.each([
    // affirmative state assertion as its own sentence, then the hands-on ask
    "The drive is energized. How do I remove the cover?",
    "The panel is live. Can I swap the contactor?",
    "It's still powered up. Walk me through pulling the keypad.",
    "Everything is still powered up. What torque on the cover screws?",
    // "<subject> is on" with while/with/when
    "Can I replace the fan while the drive is on?",
    "Is it ok to pull the jumper with the unit on?",
    "How do I change the fuse when the machine is still on?",
    // verb–object–particle isolation order
    "Can I pull the jumper before I shut the power off?",
    "How do I remove the cover before I turn it off?",
    "Swap the fan before we power the drive down.",
    "Can I open the panel before I shut the line down?",
  ])("STOP: %j", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  it.each([
    // negated / off / down states stay answerable
    "The drive is powered off. How do I remove the cover?",
    "With the drive powered down, can I replace the fan?",
    "The unit is de-energized and locked out. Walk me through pulling the keypad.",
    // observation-only, no hands-on intent
    "The drive is energized. What does F004 mean?",
    "The fan is on. Is that normal?",
    "The display is on but blank, what do I check?",
    // "on" without a copula is a cover, not a state
    "Can I run the drive with the cover on?",
    // a setting, not isolation
    "Can I adjust the pot before I turn the speed down?",
    // the state word inside prose, mid-sentence, with no work ask
    "Tell me whether the status LED is live when the drive is idle.",
    // temperature, not electrical state (the existing TQ-29 control)
    "The bearing is hot to the touch, what causes that?",
    "The motor is hot. Is that normal after an hour?",
  ])("control (no stop): %j", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});
