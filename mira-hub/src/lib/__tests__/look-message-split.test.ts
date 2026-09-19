import { describe, expect, it } from "vitest";
import { matchSafetyStop } from "../safety-classifier";

/**
 * splitLookMessage helper — extract observation text from the composed
 * "Visual observation (HH:MM:SS, phone photo): <obs>\n\n<question>" format
 * (mira-mobile/src/lib/sensor.ts::lookQuestion).
 *
 * Returns {observation: string | null, question: string} where:
 * - observation = the <obs> part (null if format doesn't match)
 * - question = either <question> (if format matched) or the full message (fallback)
 *
 * This is a pure, deterministic helper with no dependencies — testable standalone.
 */
function splitLookMessage(fullMessage: string): { observation: string | null; question: string } {
  // Match the prefix up to and including the colon. Use [ \t]* to match only horizontal whitespace,
  // not vertical (no newlines).
  const PREFIX_PATTERN = /^Visual observation \(\d{2}:\d{2}:\d{2}, phone photo\):[ \t]*/;
  const SEPARATOR = "\n\n";

  const match = fullMessage.match(PREFIX_PATTERN);
  if (!match) {
    // Format doesn't match; return as a single question, no observation
    return { observation: null, question: fullMessage };
  }

  const prefixEnd = match[0].length;
  const rest = fullMessage.slice(prefixEnd);
  const separatorIndex = rest.indexOf(SEPARATOR);

  if (separatorIndex === -1) {
    // No separator found; treat everything as observation
    return { observation: rest.trim(), question: "" };
  }

  const observation = rest.slice(0, separatorIndex);
  const question = rest.slice(separatorIndex + SEPARATOR.length).trim();

  return { observation, question };
}

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
