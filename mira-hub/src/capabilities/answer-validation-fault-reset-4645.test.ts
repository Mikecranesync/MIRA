/**
 * #4645 defect 3 — a factory-restore / OS-wipe procedure must never be
 * served as the answer to a fault-clear / acknowledge question.
 *
 * Reuses the #3975 pre-display floor: `validateAnswer` constrains the
 * complete candidate before any stream byte. Opposite-direction controls:
 * a true factory-reset question may describe factory restore; a fault-reset
 * answer that warns against factory reset and points at ACK must pass.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-fault-reset-4645
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";
import { FACTORY_RESET_AS_FAULT_REPLACEMENT } from "./fault-reset-safety";

const FAULT_Q = "The machine faulted and stopped. How do I reset the fault and get it running again?";
const FACTORY_Q = "how do I factory reset the panel?";

const FACTORY_RESET_STEPS =
  "Reset the HMI to factory settings to get it running again.\n" +
  "Updating the operating system deletes all data on the HMI device. " +
  "A reset to the factory settings also deletes the license keys.";

const ACKNOWLEDGE_STEPS =
  "Press the acknowledge key. It acknowledges the currently displayed fault " +
  "or all alarms of an alarm group as group acknowledgment. A lit LED indicates unacknowledged faults. " +
  "Find and correct the cause before restarting.";

const WARN_THEN_ACK =
  "Never factory reset to clear a fault. A reset to the factory settings also deletes the license keys. " +
  "Press the acknowledge key to acknowledge the displayed fault or an alarm group.";

function judge(answerText: string, question = FAULT_Q, general = false) {
  return validateAnswer({
    answerText,
    question,
    general,
    served: true,
    refused: false,
    evidenceSufficient: true,
  });
}

describe("#4645 factory-reset must not be served as a fault-clear", () => {
  it("rejects factory-reset steps for a fault-reset question (grounded lane)", () => {
    const v = judge(FACTORY_RESET_STEPS);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("unsupported_specificity");
    expect(v.violation).toBe("unsupported-specificity:factory-reset-as-fault-clear");
    expect(v.replacement).toBe(FACTORY_RESET_AS_FAULT_REPLACEMENT);
    expect(v.replacement).toMatch(/deletes project data and license keys/i);
    expect(v.replacement).toMatch(/acknowledge/i);
  });

  it("rejects the same leak in the general lane", () => {
    const v = judge(FACTORY_RESET_STEPS, FAULT_Q, true);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("unsupported_specificity");
  });

  it("rejects a modal factory-reset instruction", () => {
    expect(judge("You should factory reset the panel to clear the fault.").ok).toBe(false);
  });
});

describe("#4645 opposite-direction — useful answers must survive", () => {
  it("accepts the acknowledge procedure for a fault-reset question", () => {
    expect(judge(ACKNOWLEDGE_STEPS).ok).toBe(true);
  });

  it("accepts a warning that factory reset is not the fault-clear", () => {
    expect(judge(WARN_THEN_ACK).ok).toBe(true);
  });

  it("accepts factory-restore steps when the technician asked for a factory reset", () => {
    expect(judge(FACTORY_RESET_STEPS, FACTORY_Q).ok).toBe(true);
  });

  it("does not replace an honest refusal that only names factory-reset excerpts", () => {
    const refusal =
      "The retrieved excerpts do not describe a fault-clear procedure. " +
      "They only describe HMI network assignment and factory-reset functions.";
    expect(judge(refusal).ok).toBe(true);
  });
});
