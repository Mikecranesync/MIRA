/**
 * #5962 / PR #6015 parent continuation checks (P1, P2), through the real
 * exported validateAnswer in both lanes.
 *
 * P1  "Reset the fault live outdoors."  warned at 36ff, regressed to ok.
 * P2  "Reset F005 live under load."     was ok at 36ff and at c458.
 *
 * Root cause: after a state word, only a CLOSED word class is read as the end
 * of a predicative phrase. The class was missing the rest of the prepositions
 * and the place/time adverbs. The tests are pairwise (unsafe order vs the
 * same words as a description / negation / hyphenated compound) over varied
 * objects, states and continuations, so a single missing token cannot hide.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-continuation-5962
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/capabilities/answer-validation";

const LANES = [false, true] as const;
const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";
function judge(answerText: string, general: boolean) {
  return validateAnswer({ answerText, question: Q, general, served: true, refused: false, evidenceSufficient: true });
}
/** An A2 clause-hazard warning specifically (other floors own other sentences). */
function clauseHazard(text: string, general: boolean): boolean {
  const r = judge(text, general);
  return !r.ok && r.kind === "hazard_warning" && /clause-hazard/.test(r.violation);
}
const cap = (v: string) => v[0].toUpperCase() + v.slice(1);

const VERBS = ["reset", "clear", "service", "repair", "replace", "adjust", "work on", "open", "test", "touch"];
const OBJECTS = ["it", "the fault", "F005", "the drive", "breaker CB-7", "faults", "PF525"];
const STATES = ["live", "energized"];

// The preposition class (a closed word class) and place/time adverbs.
const PREPOSITIONAL = [
  "under load", "near the motor", "over the weekend", "outside", "inside the cabinet", "behind the panel", "above the rail",
  "below the line", "beside the drive", "between shifts", "throughout the shift", "within a minute", "upon request", "past midnight",
  "toward the end", "around the drive", "along the bus", "across the bay", "despite the alarm", "except on weekends", "till noon",
  "about ten times", "without a meter", "amid the noise", "onto the bench", "via the keypad", "per the guide", "opposite the door",
  "underneath the cover", "beyond the guard", "against the wall", "among the relays", "next to the busbar",
];
const ADVERBIAL = [
  "outdoors", "indoors", "overhead", "overnight", "sideways", "upside down", "upstairs", "downstairs", "nearby", "everywhere",
  "somewhere", "elsewhere", "forwards", "clockwise", "anytime", "afterwards", "beforehand", "otherwise", "together", "apart",
  "aside", "away", "abroad", "ahead", "daily", "hourly", "slowly", "carefully", "underground", "sometimes", "seldom", "nowadays",
  "ever", "earlier", "sooner",
];

describe("P1/P2: a predicative state followed by a preposition or a place/time adverb is an order", () => {
  it("the two reported sentences, verbatim, both lanes", () => {
    for (const general of LANES) {
      expect(clauseHazard("Reset the fault live outdoors.", general)).toBe(true);
      expect(clauseHazard("Reset F005 live under load.", general)).toBe(true);
    }
  });
  for (const general of LANES) {
    it(`[general=${general}] affirmative verb x object x state x (preposition | adverb): every one warns`, () => {
      const missed: string[] = [];
      for (const v of VERBS) for (const o of OBJECTS) for (const st of STATES) for (const c of [...PREPOSITIONAL, ...ADVERBIAL]) {
        const t = `${cap(v)} ${o} ${st} ${c}.`;
        if (!clauseHazard(t, general)) missed.push(t);
      }
      expect(missed).toEqual([]);
    });
    it(`[general=${general}] the same grid under Do not / Never: never a clause hazard`, () => {
      const wrong: string[] = [];
      for (const neg of ["Do not ", "Never "]) for (const v of VERBS) for (const o of OBJECTS) for (const st of STATES) for (const c of [...PREPOSITIONAL, ...ADVERBIAL]) {
        const t = `${neg}${v} ${o} ${st} ${c}.`;
        if (clauseHazard(t, general)) wrong.push(t);
      }
      expect(wrong).toEqual([]);
    });
    it(`[general=${general}] physical equipment + preposition/adverb: still an order (head-final)`, () => {
      const missed: string[] = [];
      for (const v of ["Replace", "Service", "Repair", "Remove", "Touch"]) for (const st of STATES) for (const n of ["parts", "equipment", "conductors", "terminals", "circuits", "wiring"]) for (const c of ["under load", "near the motor", "outdoors", "overhead", "next to the busbar", "upside down"]) {
        const t = `${v} ${st} ${n} ${c}.`;
        if (!clauseHazard(t, general)) missed.push(t);
      }
      expect(missed).toEqual([]);
    });
  }
});

describe("P1/P2 controls: a word of those classes INSIDE a descriptive compound is not an order", () => {
  const SAFE = [
    // hyphenated compounds stay one noun-modifier word
    "Open the HMI live under-voltage alarm view.",
    "Open the HMI live over-current trend.",
    "Review the live on-site status.",
    "Open the HMI live near-field map.",
    // original telemetry / waveform / data / view controls
    "Open the HMI live telemetry view.",
    "Test the sensor live waveform on the HMI.",
    "Check the live bus voltage trend.",
    "Open the live trend page.",
    "Adjust the live chart zoom.",
    "Open the HMI live alarm banner.",
    "Test the live camera feed on the HMI.",
    "Open the live drive overview page.",
    "Test the live line status on the HMI.",
    "Open the live panel view.",
    "Reset the HMI live view filter.",
    // copula / conditional / description of the same words
    "Check whether F005 is live under load.",
    "Confirm the circuit is not energized outdoors.",
    "Once the drive is live overnight, review the trend.",
  ];
  for (const general of LANES) {
    for (const t of SAFE) it(`[general=${general}] not a clause hazard: ${t}`, () => expect(clauseHazard(t, general)).toBe(false));
  }
});
