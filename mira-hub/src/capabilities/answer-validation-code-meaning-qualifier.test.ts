/**
 * Golden Walk 2026-10-05 (staging a9795440): three uncited fault-code
 * definitions shipped to a stranger, byte-for-byte below. The code-meaning
 * rule missed every one, for two reasons:
 *
 * 1. Each answer put the machine between the code and the verb — "Fault F49123
 *    on a Siemens drive generally indicates…", "Error E42 on most VFDs is a…".
 *    The definition frame required the verb to follow the code directly.
 * 2. The rule ran only in the general lane. A turn that retrieved chunks
 *    skipped it entirely, so an uncited definition shipped as "answered". The
 *    route now passes `resolvingCitationIds` (the [n] numbers that resolve to a
 *    retrieved source); a definition sentence carrying none of them is held to
 *    the same rule. A citation elsewhere in the answer does not back it.
 * 3. A non-withholding safety warning returned before the rule ran, so the
 *    warning shipped with the uncited definition still in it.
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
  extra: { general?: boolean; resolvingCitationIds?: string[]; refused?: boolean } = {},
) =>
  validateAnswer({
    answerText,
    question,
    general: extra.general ?? true,
    served: true,
    refused: extra.refused ?? false,
    evidenceSufficient: false,
    resolvingCitationIds: extra.resolvingCitationIds,
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
    const v = run(F49123_A, F49123_Q, { general: false, resolvingCitationIds: ["1"] });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
  });

  it("is not exempted by an unrelated citation elsewhere in the answer (Codex r1 F1)", () => {
    const mixed = `${F49123_A} The converter is commissioned using its operator panel [1].`;
    const v = run(mixed, F49123_Q, { general: false, resolvingCitationIds: ["1"] });
    expect(v.ok).toBe(false);
  });

  it("leaves a definition that carries its own resolving citation to the citation contract", () => {
    expect(run("Fault F49123 indicates a motor overload [1].", F49123_Q, { general: false, resolvingCitationIds: ["1"] }).ok).toBe(true);
    expect(run("Fault F49123 indicates a motor overload. [1]", F49123_Q, { general: false, resolvingCitationIds: ["1"] }).ok).toBe(true);
  });

  it("keeps a cited definition whose citation follows a trailing clause (Codex r3 F2)", () => {
    const cited = "Fault F49123 indicates a motor overload, according to the supplied manual [1].";
    expect(run(cited, F49123_Q, { general: false, resolvingCitationIds: ["1"] }).ok).toBe(true);
  });

  it("documents the accepted gap: an unrelated citation in the SAME sentence backs it (owner decision 2026-10-05)", () => {
    const sameSentence = "The converter is commissioned using its operator panel [1]; Fault F49123 on a Siemens drive generally indicates a motor overload condition.";
    expect(run(sameSentence, F49123_Q, { general: false, resolvingCitationIds: ["1"] }).ok).toBe(true);
  });

  it("does not accept a marker that resolves to nothing", () => {
    expect(run("Fault F49123 indicates a motor overload [7].", F49123_Q, { general: false, resolvingCitationIds: ["1"] }).ok).toBe(false);
  });

  it("keeps the old grounded behaviour when the caller does not say", () => {
    expect(run(F49123_A, F49123_Q, { general: false }).ok).toBe(true);
  });
});

describe("a safety warning cannot carry an uncited definition out (Codex r1 F2)", () => {
  const HAZ = "Lockout is not required. ";
  for (const lane of [
    { name: "general", extra: { general: true } },
    { name: "grounded", extra: { general: false, resolvingCitationIds: ["1"] } },
  ]) {
    it(`withholds the definition in the ${lane.name} lane`, () => {
      const v = run(HAZ + F49123_A, F49123_Q, lane.extra);
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
      expect(v.replacement).not.toMatch(/overload/i);
    });
  }

  it("control: a hazard with no definition is still a warning with the answer kept", () => {
    const v = run(`${HAZ}Check the DC bus first.`, F49123_Q);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("hazard_warning");
    expect(v.replacement).toContain("Check the DC bus first.");
  });
});

describe("a refusal-classified draft is still checked (Codex r2 F2)", () => {
  const MIXED = `I cannot find this code in the supplied manual. ${F49123_A}`;
  for (const lane of [
    { name: "general", extra: { general: true, refused: true } },
    { name: "grounded", extra: { general: false, refused: true, resolvingCitationIds: ["1"] } },
  ]) {
    it(`withholds a mixed refusal + definition in the ${lane.name} lane`, () => {
      const v = run(MIXED, F49123_Q, lane.extra);
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.violation).toBe("unsupported-specificity:code-meaning-asserted");
    });
  }

  it("control: an honest refusal alone is untouched", () => {
    expect(run("I can't verify what F49123 means on this drive from the supplied manual.", F49123_Q, { refused: true }).ok).toBe(true);
    expect(run("I cannot find this code in the supplied manual.", F49123_Q, { general: false, refused: true, resolvingCitationIds: ["1"] }).ok).toBe(true);
  });
});
