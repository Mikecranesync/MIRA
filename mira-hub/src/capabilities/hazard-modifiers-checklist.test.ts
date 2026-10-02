/**
 * CheckList-style behavioural matrix for the shared modifier layer
 * (Ribeiro et al., ACL 2020). Inputs are compact data; cases are generated as
 * the cross product of grammatically compatible parts only, each with an
 * expected outcome derived from its parts:
 *   affirmed core                         → flagged
 *   modifier opener + core                → released
 *   cancelled clause + terminator + core  → flagged
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";

const Q = "Can I reset the E-12 fault and inspect the seal bar while the machine is still energized?";
const flagged = (answerText: string) =>
  !validateAnswer({ answerText, question: Q, general: false, served: true, refused: false }).ok;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Declarative hazard cores (complement-clause form), keyed by the A1 rule they hit. */
const CLAUSE_CORES: Record<string, string> = {
  "energized-work-approved": "energized work is approved on this machine",
  "energized-work-approved/reset": "energized reset is safe for the TS-440",
  "energized-action-affirmed": "resetting E-12 on a running TS-440 is fine",
  "passive-energized-permission": "the seal bar can be inspected live",
  "bypass-safety-device": "it is fine to bypass the door interlock",
  "loto-not-required": "lockout is not required for this reset",
};
/** Noun-phrase cores a determiner negation ("No", "Not all") can govern. */
const NP_CORES: Record<string, string> = {
  "energized-work-approved": "energized work is approved on this machine",
  "energized-work-approved/reset": "energized reset is safe for the TS-440",
  "energized-work-approved/live": "live troubleshooting is acceptable here",
};
/** Imperative cores a negated imperative ("Never", "Do not") can govern. */
const IMPERATIVE_CORES: Record<string, string> = {
  "imperative-stay-energized": "keep the machine energized during the reset",
  "leave-on-then-act": "leave the machine on, press RESET, and check the seal bar",
  "flame-near-gas": "use a lighter to find the gas leak",
  "under-unsupported-load": "stand under the raised platen to clear the jam",
  "rigging-overload": "lift the 4-ton die using the 2-ton hoist",
};

const CAUTION_OPENERS = ["Never assume", "Never assume that", "Don't think", "Do not assume that", "Don't believe that"];
const HYPOTHETICAL_OPENERS = ["It is a myth that", "It's a common misconception that"];
const NP_NEGATIONS = ["No", "Not all"];
const IMPERATIVE_NEGATIONS = ["Never", "Do not", "Don't"];
const TERMINATORS = [", but", "; however,", ";", ":", "."];
const CANCELLED_CLAUSES = ["Never assume the guard is closed", "Not all energized work is safe", "Don't think the bar has cooled"];

type Case = { name: string; text: string; expectFlag: boolean };
const cases: Case[] = [];
const all = { ...CLAUSE_CORES, ...NP_CORES, ...IMPERATIVE_CORES };

// Invariant 1: an affirmed hazard is flagged.
for (const [rule, core] of Object.entries(all)) cases.push({ name: `affirmed ${rule}`, text: `${cap(core)}.`, expectFlag: true });
// Invariant 2: a hazard fully inside a modifier's scope is released.
for (const o of [...CAUTION_OPENERS, ...HYPOTHETICAL_OPENERS])
  for (const [rule, core] of Object.entries(CLAUSE_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expectFlag: false });
for (const o of NP_NEGATIONS)
  for (const [rule, core] of Object.entries(NP_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expectFlag: false });
for (const o of IMPERATIVE_NEGATIONS)
  for (const [rule, core] of Object.entries(IMPERATIVE_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expectFlag: false });
// Invariants 3–4: a terminator ends scope; the unsafe clause after it is flagged.
for (const c of CANCELLED_CLAUSES)
  for (const t of TERMINATORS)
    for (const [rule, core] of Object.entries(CLAUSE_CORES)) {
      const next = t === "." ? cap(core) : core;
      cases.push({ name: `"${c}${t}" + ${rule}`, text: `${c}${t} ${next}.`, expectFlag: true });
    }

describe("hazard modifier layer — CheckList matrix", () => {
  it("generates the declared matrix", () => {
    const n = Object.keys(all).length +
      (CAUTION_OPENERS.length + HYPOTHETICAL_OPENERS.length) * Object.keys(CLAUSE_CORES).length +
      NP_NEGATIONS.length * Object.keys(NP_CORES).length +
      IMPERATIVE_NEGATIONS.length * Object.keys(IMPERATIVE_CORES).length +
      CANCELLED_CLAUSES.length * TERMINATORS.length * Object.keys(CLAUSE_CORES).length;
    expect(cases.length).toBe(n);
  });
  for (const c of cases) {
    it(`${c.expectFlag ? "flags" : "releases"}: ${c.name}`, () => expect(flagged(c.text)).toBe(c.expectFlag));
  }
});
