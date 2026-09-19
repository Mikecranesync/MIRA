import { describe, expect, it } from "vitest";
import { matchSafetyStop } from "../safety-classifier";
// Import the REAL production helper — do not re-implement it here. A local copy
// would make these tests validate the copy, not the shipped code (the exact
// "passing test that proves nothing" failure `.claude/rules/prove-the-test-fails.md`
// exists to stop). Mutating ../util/look-message-split must be able to turn a
// test in this file red.
import { splitLookMessage } from "../util/look-message-split";

describe("splitLookMessage", () => {
  it("parses the standard LOOK format correctly", () => {
    const fullMessage =
      "Visual observation (14:32:10, phone photo): No visible damage, burn marks, or corrosion\n\nwhat should I check first?";
    const result = splitLookMessage(fullMessage);
    expect(result.observation).toBe("No visible damage, burn marks, or corrosion");
    expect(result.question).toBe("what should I check first?");
  });

  it("returns null observation for non-matching format", () => {
    const fullMessage = "burn mark on the contactor";
    const result = splitLookMessage(fullMessage);
    expect(result.observation).toBeNull();
    expect(result.question).toBe("burn mark on the contactor");
  });

  it("handles empty observation", () => {
    const fullMessage = "Visual observation (14:32:10, phone photo): \n\nwhat should I do?";
    const result = splitLookMessage(fullMessage);
    // The prefix pattern /^Visual observation \(\d{2}:\d{2}:\d{2}, phone photo\):\s*/ consumes
    // the colon and the trailing space(s), so rest starts right at the \n\n.
    // But actually the input has " \n\n", so rest is " \n\n..." and the
    // first separator check finds "\n\n" at index 1. So observation is " ".trim() = "".
    expect(result.observation).toBe(""); // After trim(), a single space becomes empty
    expect(result.question).toBe("what should I do?");
  });

  it("fails SAFE on a prefix with no separator — classifies the whole remainder", () => {
    // Malformed/spoofed: the LOOK prefix is present but there is no "\n\n"
    // separator (real lookQuestion always emits one). We must NOT exempt the
    // remainder from safety classification — question carries the whole rest so
    // matchSafetyStop still sees it. The old branch returned {question: ""},
    // which fails OPEN (matchSafetyStop("") === null exempts everything).
    const fullMessage = "Visual observation (14:32:10, phone photo): exposed live wire and burn marks";
    const result = splitLookMessage(fullMessage);
    expect(result.observation).toBeNull();
    expect(result.question).toBe("exposed live wire and burn marks");
    // The safety hazard in a malformed message is still caught (fails safe).
    expect(matchSafetyStop(result.question)).not.toBeNull();
  });
});

describe("matchSafetyStop with false-positive LOOK strings", () => {
  /**
   * These four healthy-machine LOOK observations contain "burn mark" in a
   * negated context. The bug is: the full composed message (observation +
   * question) is classified, and "burn mark" substring match triggers a
   * SAFETY_STOP even though the observation is reporting NO hazard.
   *
   * The fix splits the message and classifies only the question part.
   * After the fix, the question alone (without the observation negation)
   * should NOT trip a safety stop for a healthy machine.
   */

  const healthyObservations = [
    {
      observation: "No visible damage, burn marks, or corrosion",
      question: "What should I check first?",
      label: "no-damage-no-burn-marks",
    },
    {
      observation: "No visible signs of wear, burn marks, or damage on the contacts",
      question: "Is this normal?",
      label: "no-signs-no-burn-marks",
    },
    {
      observation: "Everything looks clean, no burn marks detected",
      question: "Should I flag this as resolved?",
      label: "clean-no-burn-marks",
    },
    {
      observation: "Inspection shows no burn marks or hot spots",
      question: "What does that tell me?",
      label: "no-burn-marks-or-hot-spots",
    },
  ];

  healthyObservations.forEach(({ observation, question, label }) => {
    it(`BEFORE FIX: full message classifies as safety on "${label}"`, () => {
      const fullMessage = `Visual observation (14:32:10, phone photo): ${observation}\n\n${question}`;
      // This test expects RED on the unfixed code: matchSafetyStop(fullMessage) returns 'burn mark'
      // The bug is that the negation "No visible... burn marks" is ignored.
      // After the fix lands, this assertion should flip to expect null.
      const trigger = matchSafetyStop(fullMessage);
      expect(trigger).toBe("burn mark"); // RED: the bug — negation is not honored
    });

    it(`AFTER FIX: split question classifies as null on "${label}"`, () => {
      const { question: splitQuestion } = splitLookMessage(
        `Visual observation (14:32:10, phone photo): ${observation}\n\n${question}`
      );
      // After the fix, only the question is classified, not the observation.
      // The question alone should NOT be a safety phrase.
      const trigger = matchSafetyStop(splitQuestion);
      expect(trigger).toBeNull(); // GREEN: the fix — question alone is not a hazard
    });
  });
});

describe("matchSafetyStop with mixed cases (observation negated, question has real hazard)", () => {
  it("split question correctly identifies hazard when observation is negated", () => {
    const observation = "No smoke, no visible damage";
    const question = "But there is a live wire exposed — is that normal?";
    const fullMessage = `Visual observation (14:32:10, phone photo): ${observation}\n\n${question}`;

    const { question: splitQuestion } = splitLookMessage(fullMessage);

    // After the fix, only the question is classified.
    // The question contains "live wire" or "exposed wire", both of which ARE safety phrases.
    const trigger = matchSafetyStop(splitQuestion);
    expect(trigger).toBe("live wire"); // GREEN: real hazard in question is caught
  });
});
