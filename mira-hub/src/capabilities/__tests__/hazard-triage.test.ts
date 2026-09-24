/** Shadow-only classification from the route's already-started Jev judgment. */
import { describe, expect, it } from "vitest";
import type { JevShadowResult } from "../observability/jev-shadow";
import { triageSemanticSafetyCheck } from "../answer-safety-check";

const jev = (noul: number | null, skipped_reason: string | null = null): JevShadowResult => ({
  noul,
  skipped_reason,
  latency_ms: null,
  model: null,
  input_tokens: null,
  instructions_version: "test",
});

const classify = (
  question: string,
  answerText: string,
  result: JevShadowResult,
  general = false,
  refused = false,
) => triageSemanticSafetyCheck({ question, answerText, jev: result, general, refused });

describe("hazard triage remains observational", () => {
  it("reports a disabled Jev judgment as would_proceed", () => {
    const result = classify("what is a VFD?", "A VFD controls motor speed.", jev(null, "disabled"), true);
    expect(result).toMatchObject({ decision: "would_proceed", reason: "jev_disabled", jev: null });
  });

  it("classifies a refusal as would_skip without consulting Jev", () => {
    const result = classify("reset while energized", "I cannot help with that.", jev(0.98), false, true);
    expect(result).toMatchObject({ decision: "would_skip", reason: "refused", jev: null });
  });

  it.each(["no_key", "no_evidence", "error", "http_503"])(
    "reports unavailable Jev (%s) as would_proceed",
    (reason) => {
      expect(classify("what is a VFD?", "A VFD controls motor speed.", jev(null, reason), true))
        .toMatchObject({ decision: "would_proceed", reason: "jev_unavailable" });
    },
  );

  it("reports a Jev timeout as would_proceed", () => {
    expect(classify("what is a VFD?", "A VFD controls motor speed.", jev(null, "timeout"), true))
      .toMatchObject({ decision: "would_proceed", reason: "jev_timeout" });
  });

  it.each([
    ["can I reset the drive?", "With the drive de-energized and locked out, you can reset."],
    ["what is lockout/tagout?", "LOTO is a safety procedure."],
    ["what voltage does this run on?", "The drive operates at 480V AC."],
    ["what is the hydraulic pressure?", "The hydraulic system operates at 3000 PSI."],
    ["can I reset the drive?", "Yes, you can reset the drive while it is energized."],
    ["how do I clear the fault?", "You can clear it without de-energizing the equipment."],
    ["how do I access the panel?", "You can bypass the interlock to access the panel."],
    ["can I check the terminals?", "You can work on the live panel to check terminals."],
  ])("never would_skip hazard vocabulary: %s", (question, answer) => {
    expect(classify(question, answer, jev(0.99)))
      .toMatchObject({ decision: "would_proceed", reason: "hazard_vocabulary", jev: null });
  });

  it("records a high-score educational would_skip without suppressing the route judge", () => {
    expect(classify("what is a VFD?", "A VFD controls motor speed.", jev(0.95), true))
      .toMatchObject({ decision: "would_skip", reason: "educational" });
  });

  it("records a high-score grounded would_skip", () => {
    expect(classify("what is a VFD?", "A VFD controls motor speed.", jev(0.96)))
      .toMatchObject({ decision: "would_skip", reason: "well_grounded" });
  });

  it("keeps a lower score in would_proceed", () => {
    expect(classify("what is a VFD?", "A VFD controls motor speed.", jev(0.65)))
      .toMatchObject({ decision: "would_proceed", reason: "uncertain" });
  });
});
