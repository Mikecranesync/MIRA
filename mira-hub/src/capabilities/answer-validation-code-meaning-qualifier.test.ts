/**
 * Golden Walk 2026-10-05 (staging a9795440): three uncited fault-code
 * definitions shipped to a stranger, byte-for-byte below. The code-meaning
 * rule missed every one, for two reasons:
 *
 * 1. Each answer put the machine between the code and the verb — "Fault F49123
 *    on a Siemens drive generally indicates…", "Error E42 on most VFDs is a…".
 *    The definition frame required the verb to follow the code directly.
 * 2. A non-withholding safety warning returned before the rule ran, so the
 *    warning shipped with the uncited definition still in it.
 * 3. A refusal-classified draft skipped the rule entirely.
 *
 * Scope (owner decision 2026-10-05): the GENERAL lane, where all three live
 * failures happened. The grounded lane keeps the citation contract.
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

const run = (
  answerText: string,
  question: string,
  extra: { general?: boolean; refused?: boolean } = {},
) =>
  validateAnswer({
    answerText,
    question,
    general: extra.general ?? true,
    served: true,
    refused: extra.refused ?? false,
    evidenceSufficient: false,
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

describe("the grounded lane is unchanged (owner decision 2026-10-05)", () => {
  it("does not apply the code-meaning rule to a grounded draft", () => {
    expect(run(F49123_A, F49123_Q, { general: false }).ok).toBe(true);
  });
});

describe("a safety warning cannot carry an uncited definition out (Codex r1 F2)", () => {
  const HAZ = "Lockout is not required. ";
  it("withholds the definition", () => {
    const v = run(HAZ + F49123_A, F49123_Q);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
    expect(v.replacement).not.toMatch(/overload/i);
  });

  it("control: a hazard with no definition is still a warning with the answer kept", () => {
    const v = run(`${HAZ}Check the DC bus first.`, F49123_Q);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("hazard_warning");
    expect(v.replacement).toContain("Check the DC bus first.");
  });
});

describe("a refusal-classified draft is still checked (Codex r2 F2)", () => {
  it("withholds a mixed refusal + definition", () => {
    const v = run(`I cannot find this code in the supplied manual. ${F49123_A}`, F49123_Q, { refused: true });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
  });

  it("control: an honest refusal alone is untouched", () => {
    expect(run("I can't verify what F49123 means on this drive from the supplied manual.", F49123_Q, { refused: true }).ok).toBe(true);
    expect(run("I cannot find this code in the supplied manual.", F49123_Q, { refused: true }).ok).toBe(true);
  });
});
