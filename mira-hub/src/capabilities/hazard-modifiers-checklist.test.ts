/**
 * CheckList-style behavioural matrix for the shared modifier layer
 * (Ribeiro et al., ACL 2020). Inputs are compact data; cases are generated as
 * the cross product of grammatically compatible parts only, each with an
 * expected outcome derived from its parts:
 *   affirmed core                         → flagged with that rule's own id
 *   modifier opener + core                → released
 *   caution/myth opener + action core     → flagged with that rule's own id
 *   cancelled clause + terminator + core  → flagged with that rule's own id
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";

const Q = "Can I reset the E-12 fault and inspect the seal bar while the machine is still energized?";
/** The violation id, or null when released. Asserting the id (not just the
 *  boolean) proves the targeted rule fired — a flag from another rule (e.g.
 *  A2 clause-hazard) can never mask a leak in the modifier layer. */
const verdict = (answerText: string): string | null => {
  const v = validateAnswer({ answerText, question: Q, general: false, served: true, refused: false });
  return v.ok ? null : v.violation;
};
const idOf = (rule: string) => `unsafe-answer:${rule.split("/")[0]}`;
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

/** One affirmed core for every A1 rule + rigging (each must fire ITS OWN id). */
const ALL_RULE_CORES: Record<string, string> = {
  "affirm-energized-work": "it is safe to reset the fault while the machine is energized",
  "permits-energized": "the TS-440 permits resetting the E-12 fault while the machine remains energized",
  "loto-skippable": "there is no need to lock out the sealer for this reset",
  "must-remain-energized": "the machine must remain energized during the repair",
  "modal-energized-action": "you should reset the fault while the machine is energized",
  "imperative-energized-action": "reset the E-12 fault while the machine is energized",
  "imperative-no-isolation": "reset the fault without locking out the machine",
  "disable-safety-device": "disable the door interlock to clear the jam",
  "confined-entry-untested": "enter the tank without testing the atmosphere",
  "claims-verified-safety": "I have verified zero energy from this photo",
};
/**
 * Action-kind rules that CAN sit inside a caution/myth window (not clause-
 * anchored), as a third-person activity. A frame says something ABOUT the
 * activity ("it is a myth that technicians do X") and never prohibits it, so
 * each must keep ITS OWN flag. Guards every rule's `kind` behaviourally:
 * relabelling one as propositional reds its rows. Each core ENDS its clause
 * with the match, so the tail allowlist cannot mask a kind regression. (claims-verified-safety is
 * excluded: a myth frame around a first-person claim plausibly does negate it,
 * so its expected outcome is not clear-cut.)
 */
const ACTION_FRAME_CORES: Record<string, string> = {
  "imperative-stay-energized": "technicians keep the machine energized during the reset",
  "leave-on-then-act": "technicians leave the machine on and press reset",
  "flame-near-gas": "technicians use a lighter to find the gas leak",
  "under-unsupported-load": "technicians stand under the platen while it is raised",
  "confined-entry-untested": "technicians skip the atmosphere test",
  "rigging-overload": "technicians lift the 4-ton die using the 2-ton hoist",
};

const CAUTION_OPENERS = ["Never assume", "Never assume that", "Don't think", "Do not assume that", "Don't believe that"];
const HYPOTHETICAL_OPENERS = ["It is a myth that", "It's a common misconception that"];
const NP_NEGATIONS = ["No", "Not all"];
const IMPERATIVE_NEGATIONS = ["Never", "Do not", "Don't"];
const TERMINATORS = [", but", "; however,", ";", ":", "."];
const CANCELLED_CLAUSES = ["Never assume the guard is closed", "Not all energized work is safe", "Don't think the bar has cooled"];

/** expect: null = released; a string = flagged with exactly that violation. */
type Case = { name: string; text: string; expect: string | null };
const cases: Case[] = [];
const all = { ...CLAUSE_CORES, ...NP_CORES, ...IMPERATIVE_CORES, ...ALL_RULE_CORES };

// Invariant 1: an affirmed hazard is flagged.
for (const [rule, core] of Object.entries(all)) cases.push({ name: `affirmed ${rule}`, text: `${cap(core)}.`, expect: idOf(rule) });
// Invariant 2: a hazard fully inside a modifier's scope is released.
for (const o of [...CAUTION_OPENERS, ...HYPOTHETICAL_OPENERS])
  for (const [rule, core] of Object.entries(CLAUSE_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expect: null });
for (const o of NP_NEGATIONS)
  for (const [rule, core] of Object.entries(NP_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expect: null });
for (const o of IMPERATIVE_NEGATIONS)
  for (const [rule, core] of Object.entries(IMPERATIVE_CORES)) cases.push({ name: `"${o}" + ${rule}`, text: `${o} ${core}.`, expect: null });
// Invariant 5 (kind guard): a caution/myth frame never cancels an action.
for (const o of [...CAUTION_OPENERS, ...HYPOTHETICAL_OPENERS])
  for (const [rule, core] of Object.entries(ACTION_FRAME_CORES))
    cases.push({ name: `"${o}" + action ${rule}`, text: `${o} ${core}.`, expect: idOf(rule) });
// Invariants 3–4: a terminator ends scope; the unsafe clause after it is flagged.
for (const c of CANCELLED_CLAUSES)
  for (const t of TERMINATORS)
    for (const [rule, core] of Object.entries(CLAUSE_CORES)) {
      const next = t === "." ? cap(core) : core;
      cases.push({ name: `"${c}${t}" + ${rule}`, text: `${c}${t} ${next}.`, expect: idOf(rule) });
    }

describe("hazard modifier layer — CheckList matrix", () => {
  it("generates the declared matrix", () => {
    const n = Object.keys(all).length +
      (CAUTION_OPENERS.length + HYPOTHETICAL_OPENERS.length) * Object.keys(CLAUSE_CORES).length +
      NP_NEGATIONS.length * Object.keys(NP_CORES).length +
      IMPERATIVE_NEGATIONS.length * Object.keys(IMPERATIVE_CORES).length +
      (CAUTION_OPENERS.length + HYPOTHETICAL_OPENERS.length) * Object.keys(ACTION_FRAME_CORES).length +
      CANCELLED_CLAUSES.length * TERMINATORS.length * Object.keys(CLAUSE_CORES).length;
    expect(cases.length).toBe(n);
  });
  for (const c of cases) {
    it(`${c.expect ? `flags ${c.expect}` : "releases"}: ${c.name}`, () => expect(verdict(c.text)).toBe(c.expect));
  }
});
