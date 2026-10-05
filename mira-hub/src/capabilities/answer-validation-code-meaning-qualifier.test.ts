/**
 * Golden Walk 2026-10-05 (staging a9795440): three uncited fault-code
 * definitions shipped to a stranger, byte-for-byte below. The code-meaning
 * rule missed every one, for two reasons:
 *
 * 1. Each answer put the machine between the code and the verb — "Fault F49123
 *    on a Siemens drive generally indicates…", "Error E42 on most VFDs is a…".
 *    The definition frame required the verb to follow the code directly.
 * 2. The rule ran only in the general lane. A turn that retrieved chunks but
 *    cited none of them skipped it entirely, so an uncited definition shipped
 *    as "answered". `citedSources: false` closes that: with nothing cited, the
 *    citation contract backs nothing, so the general-lane rule applies.
 */
import { describe, it, expect } from "vitest";
import { validateAnswer } from "./answer-validation";

const E42_Q = "What does error E42 mean on this drive";
const E42_A =
  "Error E42 on most variable‑frequency drives is a generic “motor over‑temperature” fault. The drive’s internal sensor has detected that the motor winding temperature has exceeded its safe limit, so it shuts down to protect the motor.";
const F49123_Q = "What does fault F49123 mean on this drive";
const F49123_A =
  "Fault F49123 on a Siemens drive generally indicates a **motor overload or over‑current condition** detected by the drive’s internal protection.";
const F30002_Q = "What does fault F30002 mean on this drive";
const F30002_A =
  "Fault **F30002** on a Siemens SINAMICS G120C indicates a **“DC‑bus over‑voltage”** condition. The drive has detected that the voltage on the DC link is too high.";

const run = (answerText: string, question: string, extra: { general?: boolean; citedSources?: boolean } = {}) =>
  validateAnswer({
    answerText,
    question,
    general: extra.general ?? true,
    served: true,
    refused: false,
    evidenceSufficient: false,
    citedSources: extra.citedSources,
  });

describe("code meaning with a qualifier between the code and the verb", () => {
  for (const [label, q, a, code] of [
    ["E42 (fictitious machine)", E42_Q, E42_A, "E42"],
    ["F49123 (real maker, fake model)", F49123_Q, F49123_A, "F49123"],
    ["F30002 (Siemens G120C, no manual found)", F30002_Q, F30002_A, "F30002"],
  ] as const) {
    it(`withholds the live staging answer for ${label}`, () => {
      const v = run(a, q);
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
      expect(v.replacement).toContain(code);
      expect(v.replacement).not.toContain("over-temperature");
    });
  }

  it("still lets an honest non-verification through", () => {
    expect(run("I can't verify what F49123 on a Siemens drive indicates without its manual.", F49123_Q).ok).toBe(true);
  });

  it("does not treat a location sentence as a definition when no code is asked", () => {
    expect(run("The drive on this line is a PowerFlex 525 mounted in the MCC.", "Where is the drive").ok).toBe(true);
  });
});

describe("a retrieved-but-uncited turn is held to the code-meaning rule", () => {
  it("withholds an uncited definition when chunks were retrieved but none are cited", () => {
    const v = run(F49123_A, F49123_Q, { general: false, citedSources: false });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
  });

  it("leaves a cited definition to the citation contract", () => {
    expect(run(`${F49123_A} [1]`, F49123_Q, { general: false, citedSources: true }).ok).toBe(true);
  });

  it("keeps the old grounded behaviour when the caller does not say", () => {
    expect(run(F49123_A, F49123_Q, { general: false }).ok).toBe(true);
  });
});
