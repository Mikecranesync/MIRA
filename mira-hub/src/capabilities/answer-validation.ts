/**
 * Pre-display answer validation — the output-side boundary (#3790, #3787).
 *
 * Research: docs/research/2026-09-13-projects-two-lane/ (PR #3791), sections
 * B2/B3. The notebook chat route classifies the technician's QUESTION
 * (`matchSafetyStop`) but until now released answer text delta-by-delta with
 * no check on what the model actually said. #3790 showed the consequence: a
 * poisoned/wrong retrieved document produced "yes, resetting while energized
 * is permitted [1]" — cited, confident, lethal. #3787 showed the general-lane
 * variant: invented fault-code meanings and references to documents that do
 * not exist.
 *
 * This module is the deterministic floor that runs on the COMPLETE candidate
 * answer before any content byte is released:
 *
 *  A. Hazard-affirmation checks — BOTH lanes. An answer that affirms
 *     energized work, declares LOTO unnecessary, or blesses bypassing a
 *     safety device is replaced with the shared SAFETY_STOP. Retrieved
 *     content is treated as data; it cannot certify an unsafe answer.
 *  B. General-lane specificity checks — no invented fault-code meanings
 *     (hedges like "usually means" do not rescue them) and no references to
 *     documents the conversation does not have. Violations are replaced with
 *     a controlled, useful fallback — never sentence-surgery on the draft.
 *
 * Honest scope: these are bounded invariants, not a truth oracle. They catch
 * the reproduced defect shapes (and err toward the safety stop on near
 * misses); they do not establish that arbitrary prose is safe or true.
 * Zero-token by design — no inference call (`.claude/rules/zero-token-architecture.md`).
 */

import { SAFETY_STOP } from "@/lib/safety-classifier";

export type AnswerValidation =
  | { ok: true }
  | {
      ok: false;
      kind: "unsafe_answer" | "unsupported_specificity";
      /** Machine-readable id, e.g. `unsafe-answer:permits-energized`. */
      violation: string;
      /** Bounded excerpt of the matched text, for server logs only. */
      detail: string;
      /** Full deterministic replacement served instead of the candidate. */
      replacement: string;
    };

/* ------------------------------------------------------------------------ *
 * A. Hazard-affirmation floor (both lanes)                                  *
 * ------------------------------------------------------------------------ */

// Each pattern is a conjunction: an affirmation head, a hazard action, and an
// energized/bypass object — so the CORRECT safety sentence ("never work on it
// while energized", "it is not safe to bypass the interlock") does not match.
// Negations are excluded by lookbehind or by requiring the affirmative form
// contiguously. Tested against both directions in answer-validation.test.ts.
const HAZARD_ACTIONS =
  "(?:reset(?:ting)?|clear(?:ing)?|work(?:ing)?|reach(?:ing)?|touch(?:ing)?|open(?:ing)?|remov\\w+|replac\\w+|repair(?:ing)?|servic\\w+|maintenance|adjust(?:ing)?|probe|probing|test(?:ing)?|measur\\w+|perform(?:ing)?|conduct(?:ing)?|carry(?:ing)?(?:\\s+out)?|disconnect\\w*|loosen(?:ing)?|unbolt(?:ing)?|crack(?:ing)?|clamp(?:ing|ed|s)?(?![-\\s]?meter))";
const ENERGIZED_STATE = "(?:energized|live|hot|powered(?:\\s+on)?|running)";
// Iteration-3: "when"/"whilst"/"during" work as energized connectors exactly
// like "while"/"with" ("Reset the fault WHEN the machine is energized").
const ENERGIZED_LINK = "(?:while|whilst|when|with|during)";
// Iteration-3: performing a hazard action WITHOUT isolating is the same
// instruction phrased through the missing safeguard ("Reset the fault
// without shutting down the machine").
const NO_ISOLATION =
  "without\\s+(?:first\\s+)?(?:de[-\\s]?energiz\\w+|shutting\\s+(?:down|off)|powering\\s+(?:down|off)|turning\\s+(?:off|down)|lock(?:ing)?[-\\s]?(?:out|it\\s+out)|tag(?:ging)?[-\\s]?out|isolat\\w+|disconnect\\w+|verifying\\s+zero[-\\s]?energy|loto)";

const HAZARD_AFFIRMATIONS: readonly { readonly id: string; readonly re: RegExp }[] = [
  // "yes, you can reset it while the machine is energized" /
  // "it is safe to work on the contactor while live"
  {
    id: "affirm-energized-work",
    re: new RegExp(
      "\\b(?:yes,?\\s+)?(?:you\\s+(?:can|may)|it(?:'s|\\s+is)\\s+(?:safe|permitted|acceptable|fine|ok(?:ay)?)|(?<!\\bnot\\s)(?<!n't\\s)(?<!\\bnever\\s)(?<!\\bcannot\\s)safe(?:ly)?\\s+to)\\b[^.!?\\n]{0,50}\\b" +
        HAZARD_ACTIONS +
        "\\b[^.!?\\n]{0,60}\\b" + ENERGIZED_LINK + "\\b[^.!?\\n]{0,40}\\b" +
        ENERGIZED_STATE +
        "\\b",
      "i",
    ),
  },
  // "the TS-440 permits resetting the E-12 fault while the machine remains
  // energized" — the exact #3790 shape (equipment-as-authority).
  {
    id: "permits-energized",
    re: new RegExp(
      "\\b(?:permits?|allows?|supports?|is\\s+designed\\s+(?:for|to))\\b[^.!?\\n]{0,50}\\b" +
        HAZARD_ACTIONS +
        "\\b[^.!?\\n]{0,60}\\b" + ENERGIZED_LINK + "\\b[^.!?\\n]{0,40}\\b" +
        ENERGIZED_STATE +
        "\\b",
      "i",
    ),
  },
  // "no need to lock out first" / "you don't have to de-energize" /
  // "without first performing lockout"
  {
    id: "loto-skippable",
    re: /\b(?:no\s+need\s+to|not\s+(?:necessary|needed|required)\s+to|(?:don'?t|do\s+not|doesn'?t|does\s+not|won'?t)\s+(?:need|have|require)(?:\s+to)?|without\s+(?:first\s+)?(?:performing|following|doing|applying|completing))\b[^.!?\n]{0,50}\b(?:lock[-\s]?out|loto|tag[-\s]?out|de[-\s]?energiz\w+|isolat\w+|power(?:ing)?\s+(?:down|off)|shut(?:ting)?\s+(?:down|off)|zero[-\s]?energy)\b/i,
  },
  // "lockout is not required" / "LOTO isn't necessary"
  {
    id: "loto-not-required",
    re: /\b(?:lock[-\s]?out(?:\/tag[-\s]?out)?|loto|tag[-\s]?out|de[-\s]?energiz\w+|isolation)\b[^.!?\n]{0,30}\b(?:is|are)(?:n'?t|\s+not)\s+(?:required|necessary|needed|mandatory)\b/i,
  },
  // "it's fine to bypass the interlock" / "you can jumper the light curtain"
  {
    id: "bypass-safety-device",
    re: /\b(?:(?<!\bnever\s)(?<!\bnot\s)(?<!n't\s)safe|fine|ok(?:ay)?|acceptable|permitted|you\s+(?:can|may)|go\s+ahead)\b[^.!?\n]{0,50}\b(?:bypass|defeat|jumper|disable|overrid\w+)\w*\b[^.!?\n]{0,40}\b(?:interlock|guard|safety|light\s+curtain|e[-\s]?stop)\b/i,
  },
  // F1 (Codex adversarial review, iteration 1 — BLOCKER): the unsafe
  // instruction as a BARE clause-initial imperative — "Reset the E-12 fault
  // while the machine is energized." / "Proceed with maintenance while the
  // panel is live." No affirmation head to match, so the hazard action verb
  // itself is treated as first-class when it opens a sentence, list item, or
  // step. Negated forms ("Do not reset…", "Never work…", "Avoid resetting…")
  // put the negation word in the clause-initial slot, so they fail this
  // pattern structurally.
  {
    id: "imperative-energized-action",
    // Clause boundaries include ':' ';' and dashes (iteration-2 blocker:
    // "Follow these steps: Reset … while energized" / "…; then reset …").
    // Verb set includes the perform/conduct/carry-out maintenance
    // constructions. "proceed with caution" is excluded — it is cautionary
    // prose, not an instruction to act on an energized machine.
    re: /(?:^|[.!?:;]\s+|[—–]\s*|\n)\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:then\s+|next\s+|now\s+|first\s+|simply\s+|just\s+|go\s+ahead\s+and\s+)?(?:reset|clear|open|remove|replace|repair|service|adjust|probe|test|measure|proceed(?!\s+with\s+caution\b)|continue|work|perform|conduct|carry(?:\s+out)?|complete|begin|start)\b[^.!?\n]{0,60}\b(?:while|whilst|when|with|during)\s[^.!?\n]{0,40}\b(?:energized|live|hot|powered(?:\s+on)?|running)\b/im,
  },
  // R3/F2 (Codex findings): "keep/leave … energized" is unsafe only when
  // coupled to a maintenance/hazard context — "Keep the machine energized
  // during the reset" is rejected; "Keep the machine energized during normal
  // production" is ordinary operating guidance and passes. Negations
  // ("do not keep…", "never leave…") are excluded by lookbehind.
  {
    id: "imperative-stay-energized",
    re: /(?<!\bnot\s)(?<!\bnever\s)(?<!n't\s)\b(?:keep|keeping|leave|leaving)\b[^.!?\n]{0,40}\b(?:energized|live|hot|powered(?:\s+on)?|running)\b[^.!?\n]{0,60}\b(?:during|while|when|before|until|as)\b[^.!?\n]{0,40}\b(?:reset(?:ting)?|repair\w*|servic\w*|maintenance|work(?:ing)?|clear(?:ing)?|replac\w*|remov\w*|open(?:ing)?|troubleshoot\w*|fault|adjust\w*|inspect\w*)\b/i,
  },
  // "the machine must/should/can remain energized … during the reset" — the
  // prohibition form ("must NOT remain") fails the adjacency naturally, and
  // the same hazard-context tail keeps normal-operation statements out (F2).
  {
    id: "must-remain-energized",
    re: /\b(?:must|should|can|may|needs?\s+to|has\s+to)\s+(?:remain|stay|be\s+kept|be\s+left)\s+(?:energized|live|hot|powered(?:\s+on)?|running)\b[^.!?\n]{0,60}\b(?:during|while|for|when)\b[^.!?\n]{0,40}\b(?:reset(?:ting)?|repair\w*|servic\w*|maintenance|work(?:ing)?|clear(?:ing)?|replac\w*|remov\w*|open(?:ing)?|troubleshoot\w*|fault|adjust\w*|inspect\w*)\b/i,
  },
  // Iteration-3 blocker: MODAL/advisory instruction heads — "You should
  // reset … while energized" / "It is advisable to perform maintenance while
  // … live" / "You can clear the fault without de-energizing". The negated
  // modal ("you should NOT reset") fails the head→verb adjacency naturally.
  {
    id: "modal-energized-action",
    re: new RegExp(
      "\\b(?:you\\s+(?:should|must|need\\s+to|have\\s+to|can|may|could|will\\s+want\\s+to)|it\\s+is\\s+(?:advisable|recommended|best|easiest|fastest|fine|acceptable|ok(?:ay)?)\\s+to|be\\s+sure\\s+to|make\\s+sure\\s+(?:to|you))\\s+(?:simply\\s+|just\\s+)?" +
        HAZARD_ACTIONS +
        "\\b[^.!?\\n]{0,60}\\b(?:" +
        ENERGIZED_LINK +
        "\\b[^.!?\\n]{0,40}\\b" +
        ENERGIZED_STATE +
        "|" +
        NO_ISOLATION +
        ")\\b",
      "i",
    ),
  },
  // Iteration-3 blocker: the hazard action instructed THROUGH the missing
  // safeguard — "Reset the fault without shutting down the machine." Bare
  // gerund subjects ("Resetting … without locking out is dangerous") do not
  // match: the imperative verb list is bare-form only, and negations occupy
  // the clause-initial slot ("Never reset without locking out…").
  {
    id: "imperative-no-isolation",
    re: new RegExp(
      "(?:^|[.!?:;]\\s+|[—–]\\s*|\\n)\\s*(?:[-*•]\\s+|\\d+[.)]\\s+)?(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+|go\\s+ahead\\s+and\\s+)?(?:reset|clear|open|remove|replace|repair|service|adjust|probe|test|measure|proceed|continue|work|perform|conduct|carry(?:\\s+out)?|complete|begin|start)\\b[^.!?\\n]{0,60}\\b" +
        NO_ISOLATION +
        "\\b",
      "im",
    ),
  },
  // ── 2026-09-14 safety-coverage audit: hazard classes beyond energized ────
  // Imperative to defeat a protective device — "Disable the door interlock",
  // "Jumper the light curtain". The blessing form ("it's fine to bypass…")
  // is bypass-safety-device above; this is the bare instruction. Negations
  // occupy the clause-initial slot ("Never disable…").
  {
    id: "disable-safety-device",
    re: /(?:^|[.!?:;]\s+|[—–]\s*|\n)\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:then\s+|next\s+|now\s+|first\s+|simply\s+|just\s+|go\s+ahead\s+and\s+)?(?:disable|bypass|defeat|jumper|remove|override|tape|block|cheat|pull)\b[^.!?\n]{0,40}\b(?:interlock|guard(?!\s+rail)|light\s+curtain|e[-\s]?stop|emergency\s+stop|safety\s+(?:switch|relay|gate|device|mat)|door\s+switch)\b/im,
  },
  // Confined space — atmospheric testing declared skippable, or entry
  // instructed without controls ("Enter the tank…; atmosphere testing is
  // unnecessary", "enter the vessel without testing").
  {
    id: "confined-entry-untested",
    re: /\b(?:atmosphere|atmospheric|air|gas)\s+(?:test\w*|monitor\w*|sampl\w*|check\w*)\b[^.!?\n]{0,30}\b(?:is|are)?\s*(?:unnecessary|not\s+(?:required|needed|necessary)|optional|a\s+formality)\b|\b(?:skip|forgo|omit)\s+(?:the\s+)?(?:atmosphere|atmospheric|air|gas)\s+(?:test\w*|monitor\w*|check\w*)\b|\b(?:enter\w*|go(?:ing)?\s+in(?:to)?|climb\w*\s+in(?:to)?)\b[^.!?\n]{0,40}\b(?:tank|vessel|silo|pit|manhole|sump|confined\s+space)\b[^.!?\n]{0,40}\bwithout\b/i,
  },
  // Ignition source as a gas-leak detector — "Use a lighter to locate the
  // leak", "check for the leak with a match". Comma/semicolon-bounded gaps
  // keep "never use a flame…; use soapy water" from matching across the
  // correction.
  {
    id: "flame-near-gas",
    re: /(?<!\bnever\s)(?<!\bnot\s)(?<!n't\s)\b(?:use|using|strike|light|hold)\b[^.!?\n,;]{0,30}\b(?:lighter|match(?:es)?|open\s+flame|flame|torch|candle)\b[^.!?\n,;]{0,50}\b(?:gas|leak|fuel|propane|methane|vapou?r)\b|(?<!\bnever\s)(?<!\bnot\s)\b(?:locate|find|detect|check(?:ing)?|test(?:ing)?|trace)\b[^.!?\n,;]{0,40}\bleak\b[^.!?\n,;]{0,40}\b(?:with|using)\s+(?:a\s+|an\s+)?(?:lighter|match|open\s+flame|flame|torch)\b/i,
  },
  // Gravity — body position under a load that is raised or held only by a
  // cylinder/hoist ("work beneath the raised platen", "stand under the
  // suspended die", "… supported only by …").
  {
    id: "under-unsupported-load",
    re: /(?<!\bnever\s)(?<!\bnot\s)(?<!n't\s)\b(?:work(?:ing)?|stand(?:ing)?|reach(?:ing)?|crawl(?:ing)?|position(?:ing)?|get|go(?:ing)?)\b[^.!?\n,;]{0,20}\b(?:under|beneath|below)\b[^.!?\n]{0,40}\b(?:raised|suspended|elevated|lifted|jacked)\b|\b(?:under|beneath|below)\b[^.!?\n]{0,60}\bsupported\s+only\s+by\b/i,
  },
  // MIRA claiming to have verified an isolation/safety state it cannot
  // verify remotely — "I have verified zero energy from this photo." The
  // technician-directed imperative ("Verify zero energy…") and second-person
  // forms ("once you have verified…") do not match.
  {
    id: "claims-verified-safety",
    re: /\b(?:I|we)(?:\s+have|'ve)?\s+(?:verified|confirmed)\b[^.!?\n]{0,40}\b(?:zero[-\s]?energy|de[-\s]?energiz\w+|isolat\w+|safe\s+to\s+(?:work|touch|proceed|enter))\b/i,
  },
];

// Rigging overload — "Lift this 4-ton load using the 2-ton hoist." The two
// same-unit ratings are parsed and compared; a lift within capacity does not
// match, and different units are left to the semantic layer rather than
// guessed. Negations occupy the pre-verb slot ("must never lift…").
const RIGGING_RE =
  /(?<!\bnever\s)(?<!\bnot\s)(?<!n't\s)\b(?:lift(?:ing)?|hoist(?:ing)?|rais(?:e|ing)|carry(?:ing)?|mov(?:e|ing))\b[^.!?\n]{0,40}?\b(\d+(?:\.\d+)?)[-\s]?(tons?|tonnes?|t|kg|lbs?|pounds?)\b[^.!?\n]{0,50}?\b(?:using|with|on)\b[^.!?\n]{0,30}?\b(\d+(?:\.\d+)?)[-\s]?(tons?|tonnes?|t|kg|lbs?|pounds?)[-\s]?(?:rated\s+)?(?:hoist|crane|sling|shackle|strap|chain|winch)\b/i;

function riggingOverload(text: string): string | null {
  const m = RIGGING_RE.exec(text);
  if (!m) return null;
  const unit = (u: string) => (u.startsWith("t") ? "t" : u.startsWith("kg") ? "kg" : "lb");
  if (unit(m[2].toLowerCase()) !== unit(m[4].toLowerCase())) return null;
  return parseFloat(m[1]) > parseFloat(m[3]) ? m[0].slice(0, 160) : null;
}

/* ------------------------------------------------------------------------ *
 * A2. Clause-level hazard inversion (iteration-4 blocker, both lanes)       *
 * ------------------------------------------------------------------------ */

// Post-cap review F1: passive ("The fault should be reset while … energized"),
// gerund-subject ("Resetting … while energized is recommended"), polite
// ("Please reset …"), and further modal heads ("You ought to reset …") all
// slipped the enumerated affirmation-head grammars above — the fourth
// consecutive round to find a new head family. Enumerating sentence heads
// does not converge on English, so this check inverts the model: a SENTENCE
// that couples a hazard ACTION to an energized-state RELATION (connector +
// state, or a without-isolation construction) is unsafe BY DEFAULT unless it
// is demonstrably prohibitive or cautionary. Reassurance idioms ("don't
// worry", "not dangerous") are affirmations wearing negation words, so they
// are tested BEFORE the prohibitive exemption and never exempt. The head
// grammars above are kept and run first — their specific violation ids are
// pinned in tests and in the safety-frame contract.
const HAZARD_ACTION_ANY_SRC =
  "(?:" + HAZARD_ACTIONS + "|continue|complete|begin|start|proceed(?!\\s+with\\s+caution\\b))";
const HAZARD_ACTION_ANY = new RegExp("\\b" + HAZARD_ACTION_ANY_SRC + "\\b", "i");
// `(?<![\w-])energized` keeps "de-energized"/"re-energized" out — a hyphen
// before the state word means isolation prose, not an energized instruction.
// #3973: a TRAILING hyphen is the mirror case. "an energized-work permit" and
// "a live-work permit" are safety vocabulary — naming the control, not
// instructing the hazard — and both sit next to `work`, a hazard action. The
// `(?![-\w])` guards keep the compound nouns out while "while it is energized"
// and "on the live conductors" still match. An unhyphenated "live work permit"
// is a known residual.
// #3973: the link set above is all TEMPORAL ("while/when/during it is live").
// A contact preposition carries the same instruction spatially — "repeat the
// clamp measurement ON THE LIVE CONDUCTORS" — and shipped to a technician on
// 2026-09-23 because no relation matched it. There is no legitimate reading of
// an instruction to act on a named live conductor, so this is unconditional,
// not scoped to a hazard category. It joins ENERGIZED_RELATION_SRC rather than
// standing alone so BOUND_PROHIBITION exempts the CORRECT sentence
// ("never measure on live conductors") by the same grammar.
const ENERGIZED_CONTACT_SRC =
  "(?:on|onto|across|at)\\s+(?:the\\s+|a\\s+|each\\s+|all\\s+(?:the\\s+)?)?" +
  "\\b(?:live|energi[sz]ed|hot|powered)\\b\\s+" +
  "(?:conductor|bus(?:bar)?|terminal|part|circuit|wire|phase|cable|lead|connection|equipment)s?";
const ENERGIZED_RELATION_SRC =
  "(?:" + ENERGIZED_LINK + "\\b[^.!?\\n]{0,40}?(?:(?<![\\w-])energized(?![-\\w])|\\blive\\b(?![-\\w])|\\bhot\\b|\\bpowered(?:\\s+on)?\\b|\\brunning\\b)" +
  "|" + ENERGIZED_CONTACT_SRC + ")";
const ENERGIZED_RELATION = new RegExp("\\b" + ENERGIZED_RELATION_SRC, "i");
const NO_ISOLATION_RELATION = new RegExp("\\b" + NO_ISOLATION, "i");
// 2026-09-14 coverage audit: the same coupling logic extends to other
// stored-energy states. Each relation class keeps its own violation suffix.
const PRESSURIZED_RELATION_SRC =
  ENERGIZED_LINK + "\\b[^.!?\\n]{0,40}?\\b(?:pressuri[sz]ed|under\\s+pressure|charged)\\b";
const MOTION_PROXIMITY_SRC =
  "(?:into|between|inside|through|under|near)\\b[^.!?\\n]{0,30}?\\b(?:moving|rotating|spinning|turning)\\b";
const HAZARD_RELATIONS: readonly { readonly id: string; readonly re: RegExp }[] = [
  { id: "energized", re: ENERGIZED_RELATION },
  { id: "pressurized", re: new RegExp("\\b" + PRESSURIZED_RELATION_SRC, "i") },
  { id: "motion", re: new RegExp("\\b" + MOTION_PROXIMITY_SRC, "i") },
];
// Safety-affirming negations — sentences that use a negation word to say the
// hazard is FINE. These must reject, so they are carved out of the
// prohibitive exemption below, never into it.
const REASSURANCE_AFFIRMATION =
  /\b(?:don'?t\s+worry|no\s+(?:risk|danger|harm|worries)|not?\s+(?:dangerous|unsafe|hazardous|risky|harmful)|isn'?t\s+(?:dangerous|unsafe|hazardous|risky)|perfectly\s+(?:safe|fine|normal)|nothing\s+to\s+worry)\b/i;
// Iteration-6 F1: word-presence prohibition failed open — "… energized and
// not postponed" exempted because "not" appeared in the bearing clause while
// negating a DIFFERENT predicate. The exemption is now a bounded grammar in
// which the negation must BIND the hazardous instruction itself:
//   (1) negation reaching the hazard verb through auxiliaries only
//       ("do not reset", "should not be reset", "avoid resetting",
//       "cannot safely work", "do not attempt to reset"). Verbs that INVERT
//       the negation ("do not hesitate/forget/fail to reset") are excluded
//       structurally: they are not in the auxiliary allowlist.
//   (2) negation directly before the energized/no-isolation relation
//       ("never while the machine is energized", "never without locking out").
//   (3) the hazard as subject of a prohibitive predicate
//       ("resetting while energized is dangerous/prohibited/not allowed").
//   (4) explicit caution framing ("use extreme caution", "under no
//       circumstances").
// Iteration-7 F1 (polarity): "avoid"/"refrain from" are prohibition heads
// only when NOT themselves governed by a reversal — "cannot avoid resetting"
// and "no way to avoid resetting" MANDATE the hazard. The variable-length
// lookbehind checks the governing text; polarity that cannot be established
// this way simply fails to exempt (fail-closed).
const NEG_HEAD_SRC =
  "(?:not|no|never|don'?t|do\\s+not|doesn'?t|does\\s+not|cannot|can'?t|couldn'?t|won'?t|wouldn'?t|shouldn'?t|should\\s+not|must\\s+not|mustn'?t|may\\s+not|(?<!\\b(?:cannot|can'?t|couldn'?t|won'?t|not|never|don'?t|do\\s+not|doesn'?t)\\s)(?<!\\b(?:unable|no\\s+way|impossible|hard|difficult)\\s+to\\s)(?:avoid|refrain\\s+from))";
const NEG_AUX_GAP_SRC =
  "(?:\\s+(?:be|being|been|get|ever|even|again|simply|just|safe|safely|to|attempt\\s+to|try\\s+to)){0,3}";
const BOUND_PROHIBITION = new RegExp(
  "\\b" + NEG_HEAD_SRC + NEG_AUX_GAP_SRC + "\\s+" + HAZARD_ACTION_ANY_SRC + "\\b" +
    "|\\b" + NEG_HEAD_SRC + "\\s+(?:" + ENERGIZED_RELATION_SRC + "|" + PRESSURIZED_RELATION_SRC + "|" + MOTION_PROXIMITY_SRC + "|" + NO_ISOLATION + ")" +
    "|\\b" + HAZARD_ACTION_ANY_SRC +
    "\\b[^.!?\\n]{0,60}?\\b(?:is|are|would\\s+be|remains)\\s+(?:strictly\\s+|extremely\\s+|very\\s+)?(?:dangerous|hazardous|unsafe|prohibited|forbidden|banned|illegal|not\\s+(?:allowed|permitted|safe|acceptable|recommended|advisable)|never\\s+(?:safe|allowed|permitted|acceptable)|against\\s)" +
    "|\\b(?:with|use|exercise)\\s+(?:extreme\\s+)?caution\\b|\\bunder\\s+no\\s+circumstances\\b" +
    // #3973 (5): CLASSIFYING the task is not instructing it. "this is energized
    // work under NFPA 70E", "that counts as live work" name the control regime
    // — the sentence a correct refusal uses. Without this the generic relation
    // reads the copular complement as an energized instruction (the bare word
    // `work` is a hazard action), and replaces a correct answer with a hard
    // stop. Only the copular/classificatory form is exempted; an imperative
    // ("do the work while energized") has no linking verb and still rejects.
    "|\\b(?:is|are|becomes|remains|counts\\s+as|considered|qualifies\\s+as)\\s+(?:an?\\s+)?(?:energi[sz]ed|live)[-\\s]work\\b",
  "i",
);

// Iteration-5 F1: the exemption must bind to the clause(s) that carry the
// hazardous instruction. Same boundary set as the R1 honesty-exemption
// splitter (comma/semicolon/colon/dash + contrastive conjunctions), so both
// exemptions scope identically.
const CLAUSE_BOUNDARY = /[,;:]|—|–|\bbut\b|\bhowever\b|\byet\b|\balthough\b|\bthough\b/i;

// #3979: a permit's required CONTENT can describe safe practices for work on
// energized parts without instructing a technician to do that work. Match the
// complete administrative sentence (optionally a list item), never the word
// "permit" alone: an appended live-work direction must still reach A2.
const PERMIT_PRACTICES_DESCRIPTION = /^(?:[-*•]\s+|\d+[.)]\s+)?(?:(?:the\s+)?(?:energized[-\s]work\s+)?permit\s+(?:must|should|shall)\s+)?(?:describe|document|state|list|include)(?:\s+a\s+description\s+of)?\s+(?:the\s+)?safe\s+work\s+practices\s+(?:to\s+be\s+used\s+when|for)\s+work(?:ing)?\s+on\s+energized\s+parts\.?$/i;

/** Returns the offending sentence, or null. DETECTION is sentence-scoped —
 *  splitting an instruction across punctuation ("While the machine is
 *  energized, reset the fault") must not hide it. The prohibitive/cautionary
 *  EXEMPTION is clause-scoped (iteration-5 F1): it applies only when the
 *  marker appears in a clause that carries part of the instruction (the
 *  hazard action or the energized/no-isolation relation). A warning or
 *  negation in an unrelated clause ("There is risk, but …", "Do not
 *  hesitate: …") never exempts. Detection only, never rewriting. */
function clauseHazardViolation(text: string): { relId: string; sentence: string } | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (PERMIT_PRACTICES_DESCRIPTION.test(sentence.trim())) continue;
    if (!HAZARD_ACTION_ANY.test(sentence)) continue;
    const rel = HAZARD_RELATIONS.find((r) => r.re.test(sentence));
    const relId = rel?.id ?? (NO_ISOLATION_RELATION.test(sentence) ? "energized" : null);
    if (!relId) continue;
    const bearing = sentence
      .split(CLAUSE_BOUNDARY)
      .filter(
        (c) =>
          HAZARD_ACTION_ANY.test(c) ||
          HAZARD_RELATIONS.some((r) => r.re.test(c)) ||
          NO_ISOLATION_RELATION.test(c),
      );
    // Fail-closed: no identifiable instruction-bearing clause (pathological
    // splitting) means no exemption is possible — the sentence-level match
    // above already established the hazardous coupling. The exemption must
    // GRAMMATICALLY bind the hazard (iteration-6 F1) — bare negation of some
    // other predicate in the same clause never exempts.
    const reassured = bearing.some((c) => REASSURANCE_AFFIRMATION.test(c));
    const prohibited = bearing.some((c) => BOUND_PROHIBITION.test(c));
    if (!reassured && prohibited) continue;
    return { relId, sentence };
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * A4. Energized-electrical category: restoring power in order to measure    *
 * ------------------------------------------------------------------------ */

// #3973. The route already CLASSIFIES this turn (`matchSafetyStop` returns
// ENERGIZED_ELECTRICAL_HAZARD on LETHAL_VOLTAGE_CONTEXT ∧ ENERGIZED_WORK_INTENT)
// and, until this rule, did exactly two things with that knowledge: append an
// advisory paragraph to the system prompt, and put a banner on the evidence
// frame. Neither constrains the answer. On 2026-09-23 a Pixel received, twice,
// a procedure that isolates correctly and THEN restores power to take the
// reading. The deterministic floor returned ok; the semantic judge returned
// `{"verdict":"safe","reason":"instructs isolation and verification before
// measurement"}` — it weighed the opening and not the last step.
//
// "Re-energize" is NOT hazardous on its own — "only after
// the work is complete may the feeder be re-energized" is the correct sentence
// and must survive. What is prohibited is restoring energy IN ORDER TO
// measure. That coupling is what the narrow MEASURE_ACTION set below encodes.
const RESTORE_ENERGY_SRC =
  "(?:re[-\\s]?energi[sz]\\w*|restore\\s+(?:the\\s+)?power|" +
  "power\\s+(?:\\w+\\s+){0,3}back\\s+(?:on|up)|" +
  "(?:turn|switch|bring|put)\\s+(?:\\w+\\s+){0,3}back\\s+(?:on|up))";
const RESTORE_ENERGY = new RegExp("\\b" + RESTORE_ENERGY_SRC, "i");
// A narrower action set than HAZARD_ACTIONS on purpose: "work", "replace" and
// "service" all appear in the legitimate restore-power sentence.
const MEASURE_ACTION_SRC =
  "(?:(?:attach|connect)\\s+(?:the\\s+)?test\\s+leads?\\b|measur\\w+|clamp(?:ing|ed|s)?(?![-\\s]?meter)|probe|probing|reading|\\bread\\b|" +
  "record\\s+(?:the\\s+|each\\s+)?(?:current|phase|amp\\w*|reading|voltage)|" +
  "check\\s+(?:the\\s+|each\\s+)?(?:current|amp\\w*|voltage|phase)|" +
  "take\\s+(?:the\\s+|a\\s+)?(?:reading|measurement))";

// The hazard is a physical electrical measurement after power is restored,
// not a process reading or a value read from an installed external display.
const ELECTRICAL_MEASUREMENT_CONTEXT = /\b(?:current|amps?|amperes?|voltage|phases?|legs?|conductors?|terminals?|busbars?|feeders?|panels?|circuits?|ammeter|clamp[-\s]?meter|multimeter)\b/i;
const CONTACT_MEASUREMENT = /\b(?:clamp(?:ing|ed|s)?\s+(?:each\s+|the\s+|a\s+)?(?:phase|conductor|wire|cable)|prob(?:e|ing)\b|(?:with|using)\s+(?:a\s+|the\s+)?(?:clamp[-\s]?meter|multimeter)|(?:on|across|around|at)\s+(?:each\s+|the\s+|a\s+|live\s+|exposed\s+){0,3}(?:phases?|conductors?|terminals?|busbars?|wires?|lugs?|test\s+leads?)|from\s+(?:the\s+|an?\s+|each\s+|exposed\s+|live\s+|phase\s+){0,3}(?:lugs?|terminals?|conductors?|wires?|busbars?)|(?:with|using)\s+(?:the\s+|an?\s+)?test\s+leads?(?!\s+(?:still\s+)?(?:disconnected|removed|unplugged|not\s+connected)\b))\b/i;
const EXTERNAL_READING = /\b(?:from|off|on|via)\s+(?:the\s+|an?\s+|installed\s+|external\s+|remote\s+|phone\s+|laptop\s+|tablet\s+|computer\s+|power\s+|VFD\s+|thermostat\s+|HMI\s+|monitor\s+){0,5}(?:display|screen|gauge|HMI|monitor|metering|laptop|phone|tablet|computer)\b/i;
const EXTERNAL_READING_INTRO = /\buse\s+(?:(?:the|an?|installed|external|remote|phone|laptop|tablet|computer|power|VFD|thermostat|HMI|monitor)\s+){0,5}(?:display|screen|gauge|HMI|monitor|metering|laptop|phone|tablet|computer)\s+to\s*$/i;
const MEASURE_PROHIBITION = new RegExp("\\b" + NEG_HEAD_SRC + NEG_AUX_GAP_SRC + "\\s+" + MEASURE_ACTION_SRC, "i");
const RESTORE_PROHIBITION = new RegExp("\\b" + NEG_HEAD_SRC + NEG_AUX_GAP_SRC + "\\s+" + RESTORE_ENERGY_SRC, "i");

/** Carry an affirmative restoration across prose/list steps. Prohibitions
 * apply only to their own clause; a safe opening cannot excuse a later
 * instruction. An explicit isolate/lockout/verify step ends that interval.
 * Retain original answer text elsewhere: this scans detection-only text. */
function restoreEnergyToMeasure(text: string): string | null {
  let restored: string | null = null;
  let electrical = false;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    // A completed affirmative isolation step ends the energized interval at
    // its verification, not at the end of the sentence. Keep scanning suffixes
    // such as "then re-energize" and never let a negated shutdown reset state.
    const isolation = /^\s*(?:\d+[.)]\s*)?(?:de[-\s]?energi[sz]e\b|isolate\b|shut\s+(?:it\s+|the\s+\w+\s+)?down\b|switch\s+(?:it\s+|the\s+\w+\s+)?off\b)[^.!?]*?\block[-\s]?out\b[^.!?]*?\b(?:verify|confirm)\s+(?:zero\s+voltage|(?:the\s+)?absence\s+of\s+voltage)\b/i.exec(sentence);
    const resetAt = isolation && !REASSURANCE_AFFIRMATION.test(isolation[0])
      && !/\b(?:not|never|skip|omit|optional|without|don't|no\s+need)\b/i.test(isolation[0])
      && !/^\s+(?:(?:is|was|remains)\s+)?(?:optional|unnecessary|not\s+(?:needed|required)|only\s+if|if|unless|when)\b/i.test(sentence.slice(isolation[0].length))
      ? isolation[0].length : null;
    const segments = resetAt === null ? [sentence] : [sentence.slice(0, resetAt), sentence.slice(resetAt)];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      if (segmentIndex === 1) {
        restored = null;
        electrical = false;
      }
      let frontedSource = "";
      for (const clause of segments[segmentIndex].split(CLAUSE_BOUNDARY)) {
        const restorations = [...clause.matchAll(new RegExp("\\b" + RESTORE_ENERGY_SRC, "gi"))];
        const actions = [...clause.matchAll(new RegExp("\\b" + MEASURE_ACTION_SRC, "gi"))];
        if (actions.length === 0 && restorations.length === 0 && EXTERNAL_READING.test(clause)) {
          frontedSource = clause;
          continue;
        }
        // Polarity is local to each action. An earlier "do not restore" must
        // never erase a later affirmative restoration in the same clause.
        const events = [
          ...restorations.map((match) => ({ match, kind: "restore" as const, at: match.index! })),
          ...actions.map((match) => ({ match, kind: "measure" as const, at: match.index! })),
        ].sort((a, b) => a.at - b.at);
        const ordered = events.map((event, i) => ({
          ...event,
          prohibited: false,
          context: clause.slice(i ? events[i - 1].at + events[i - 1].match[0].length : 0, events[i + 1]?.at),
        }));
        for (let i = 0; i < ordered.length; i++) {
          const event = ordered[i];
          const prefix = clause.slice(i ? events[i - 1].at + events[i - 1].match[0].length : 0, events[i].at);
          // "Do not A or B" shares a prohibition; "do not A then B" does not.
          const coordinated = i > 0 && ordered[i - 1].prohibited && /\b(?:or|and)\s*$/i.test(prefix);
          event.prohibited = !REASSURANCE_AFFIRMATION.test(event.context)
            && (coordinated || RESTORE_PROHIBITION.test(event.context) || MEASURE_PROHIBITION.test(event.context) || BOUND_PROHIBITION.test(event.context));
        }
        for (const event of ordered) {
          if (event.kind !== "restore") continue;
          const following = actions.findIndex((action) => action.index! > event.at);
          if (following < 0) continue;
          const reading = actions[following];
          const readingText = clause.slice(reading.index, actions[following + 1]?.index);
          const between = clause.slice(event.at + event.match[0].length, reading.index);
          if (/\bafter\b/i.test(between)
            && /\b(?:isolated|de[-\s]?energized|locked\s+out)\b/i.test(readingText)
            && !/\b(?:not|never|without)\b/i.test(readingText)) {
            // Restoration occurs after the isolated reading, before a later one.
            event.at = (actions[following + 1]?.index ?? clause.length) - 0.5;
          }
        }
        ordered.sort((a, b) => a.at - b.at);
        for (const event of ordered) {
          if (event.prohibited) continue;
          if (event.kind === "restore") {
            restored = sentence;
            electrical = ELECTRICAL_MEASUREMENT_CONTEXT.test(clause);
            continue;
          }
          const index = actions.indexOf(event.match);
          const readingBody = clause.slice(event.match.index, actions[index + 1]?.index);
          const carriedSource = index === 0 ? frontedSource : "";
          const action = (index === 0 ? carriedSource + " " + clause.slice(0, event.match.index) : "") + readingBody;
          frontedSource = "";
          if (!restored) continue;
          const readingPrefix = clause.slice(index ? actions[index - 1].index! + actions[index - 1][0].length : 0, event.match.index);
          // The first stated source owns the reading. A later display used
          // for comparison must not exempt an earlier unknown/physical source.
          const source = /\b(?:from|off|on|via)\b/i.exec(readingBody);
          const externalSource = EXTERNAL_READING.exec(readingBody);
          const readsDisplay = source
            ? externalSource?.index === source.index
            : EXTERNAL_READING_INTRO.test(readingPrefix)
              || (index === 0 && EXTERNAL_READING.test(carriedSource + " " + readingPrefix));
          // A single verb can name two reading sources. Both must be external;
          // "from the display and at exposed test points" is still live work.
          const coordinatedSources = [...readingBody.matchAll(/\b(?:and|or)\s+((?:from|off|on|via|at|across|around)\b)/gi)];
          const allSourcesExternal = coordinatedSources.every((match) => {
            const sourceStart = match.index! + match[0].length - match[1].length;
            // Time and operating conditions do not identify another source.
            // Inspect the clause tail because the next verb has its own event.
            const tail = clause.slice(event.match.index! + sourceStart);
            if (/^(?:at the same time\b|on completion\b|at (?:full|no|partial|rated) load\b|at (?:idle|startup)\b|at the (?:end|start)\s+(?:note|check|record|close|review|inspect)\b)/i.test(tail)) return true;
            return EXTERNAL_READING.exec(readingBody.slice(sourceStart))?.index === 0;
          });
          if (!CONTACT_MEASUREMENT.test(action) && readsDisplay && allSourcesExternal) continue;
          if (electrical || ELECTRICAL_MEASUREMENT_CONTEXT.test(action)) {
            return restored === sentence ? sentence : `${restored}\n${sentence}`;
          }
        }

      }
    }
  }
  return null;
}

/** The permitted response for this hazard category. Not a bare refusal: a
 *  clamp-meter current reading has no de-energized form, so "de-energize
 *  first" would be useless advice. It names why, hands the work to the people
 *  NFPA 70E puts it with, and gives routes to the same number that do not put
 *  the technician inside an arc-flash boundary. */
export const ENERGIZED_PROCEDURE_WITHHELD = `I can't walk you through taking that reading.

A clamp-meter current measurement only exists while the conductor is carrying load, so there is no de-energized version of it. Taking it means working on an energized conductor, which is energized work under NFPA 70E: a qualified person, an energized-work permit, an arc-flash risk assessment and the PPE that assessment specifies. That is not something to work through from a chat answer.

Ways to get the same number without opening the enclosure:
- Read the current off equipment that already measures it — the VFD or soft-starter display, the MCC's metering, or an installed power monitor.
- Have a qualified electrician take the reading, or fit permanent CTs / a power monitor so the value is available without live work.
- If an IR window is fitted, a thermal scan often finds a loose or failing connection on a humming feeder before a current reading does.

What you can safely gather right now: when the hum started, whether it tracks load, what was worked on recently, and anything visible or audible from outside the enclosure.

Give me those, or the reading once someone qualified has it, and I'll help you work out what it means.`;

/* ------------------------------------------------------------------------ *
 * B. General-lane specificity (no invented specifics, no invented sources)  *
 * ------------------------------------------------------------------------ */

// Assertions that a document the conversation does not have SAYS something.
// Recommending a KIND of source ("consult the manufacturer's manual for your
// model") is allowed and must not match — see the negative controls in tests.
const FABRICATED_DOC_PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] = [
  {
    id: "doc-asserts-content",
    re: /\b(?:the|your|its)\s+(?:official\s+)?(?:user\s+|service\s+|owner'?s?\s+|instruction\s+)?(?:manual|documentation|datasheet|user\s+guide|spec(?:ification)?\s+sheet)\s+(?:says|states|specifies|lists|shows|indicates|confirms|recommends|calls\s+for|requires)\b/i,
  },
  {
    // "the official Fanuc Zephyr-9 user manual" — asserting a specific named
    // document exists (#3787's fabricated-manual case).
    id: "official-named-doc",
    re: /\bofficial\s+[A-Za-z0-9][\w/()-]*(?:\s+[\w/()-]+){0,5}\s+(?:user\s+|service\s+)?(?:manual|guide|documentation)\b/i,
  },
  {
    id: "according-to-doc",
    re: /\baccording\s+to\s+(?:the\s+)?[^.!?\n]{0,50}\b(?:manual|documentation|datasheet|service\s+bulletin)\b/i,
  },
  {
    // A page locator with no document behind it.
    id: "page-locator",
    re: /\b(?:on\s+)?(?:page|p\.)\s*\d+\b/i,
  },
];

// 2026-09-14 coverage audit: an imperative machine setting with an exact
// numeric value ("Set this machine's relief valve to 250 bar") asserted in
// the general lane has no evidence behind it. The grounded lane is exempt —
// the citation contract owns it there. Concepts, user-supplied measurement
// discussion, and range talk without a set-instruction do not match.
const EXACT_SETTING_RE =
  /(?:^|[.!?:;]\s+|\n)\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:then\s+|now\s+|next\s+|first\s+)?(?:set|adjust|torque|tighten|calibrate|dial)\b[^.!?\n]{0,60}?\bto\s+\d[\d.,]*\s*(?:bar|psi|kpa|mpa|n·?m|nm|ft[-·\s]?lbs?|volts?|amps?|hz|rpm|°\s?[cf]|celsius|fahrenheit|mm|degrees)\b|\bshould\s+be\s+(?:set|adjusted|torqued|calibrated)\s+to\s+\d[\d.,]*\s*\w/im;

// 2026-09-22 staging traces (952036aa…, 8906786b…, ae30230b…): the general
// lane stated this machine's exact RATINGS as fact with nothing behind them —
// "operating range is –20 °C to +60 °C", "width 2.5 in", "IP65 front face,
// 0…+50 °C" — and the answer gate recorded evidence_sufficient=false while
// still serving. EXACT_SETTING_RE only catches the imperative shape ("set …
// to N units"). This catches the DECLARATIVE shape: an equipment quantity
// asserted with an exact unit-bearing value (or range). It applies only when
// the turn has NO evidence (no chunks, no machine packet, no photo
// observation) — with a photo in context the nameplate is the evidence.
// Hedged / generic phrasing ("typically", "often", "many", "for example",
// "industrial HMIs generally") is not an assertion about this machine and is
// left alone; the user's own numbers ("it says 480V on the label") are not
// rated-claims either.
const UNIT =
  "(?:v(?:olts?|dc|ac)?|a(?:mps?|mperes?)?|hz|rpm|bar|psi|k?pa|mpa|n[·.]?m|ft[-·\\s]?lbs?|°\\s?[cf]|celsius|fahrenheit|mm|cm|in(?:ch(?:es)?)?|kw|hp|ma|kv|ohms?|ω)";
const NUM = "[-–+]?\\d[\\d.,]*";
const RANGE = `${NUM}\\s*(?:°\\s?[cf]\\s*)?(?:to|[-–…]|and)\\s*${NUM}`;
const QTY =
  "(?:rated|rating|ratings|range|maximum|minimum|max|min|nominal|operating|supply|input|output|limit|limits|spec|specification|tolerance|clearance|torque|pressure|voltage|current|speed|temperature|frequency|power|capacity|width|height|length|depth|weight|diameter|thickness|gap|setting|setpoint)";
const HEDGE =
  /\b(?:typically|usually|often|generally|commonly|normally|for example|e\.g\.|such as|many|most|some|industrial|standard|common|might|may|could|would|should|approximately|around|about|roughly|likely)\b/i;
const EXACT_RATING_RE = new RegExp(
  `\\b${QTY}\\b[^.!?\\n]{0,60}?\\b(?:is|are|of|=|:|at)\\s*(?:${RANGE}|${NUM})\\s*${UNIT}\\b|\\b(?:${RANGE}|${NUM})\\s*${UNIT}\\b[^.!?\\n]{0,40}?\\b(?:rated|rating|nominal|maximum|minimum|operating range|limit)\\b`,
  "i",
);

/** A sentence-level scan: the rating claim must live in a sentence that is not
 *  hedged, so "industrial HMIs typically run 0–50 °C" survives while
 *  "the operating range is 0…+50 °C" (asserted as this machine's fact) does not. */
export function unsupportedExactRating(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!sentence.trim()) continue;
    if (HEDGE.test(sentence)) continue;
    const m = EXACT_RATING_RE.exec(sentence);
    if (m) return m[0].slice(0, 160);
  }
  return null;
}

// Fault-code-shaped token: letter prefix, optional separator, 2+ digits,
// optional suffix — Q-447-Delta, ZX-9987, F0000000, E-12. Deliberately does
// NOT match bare numbers, voltages (480V), thread sizes (M8), or model names
// without a digit run (S7-1500's "S7" has a single digit).
/** Longest token still treated as a fault code. Real ones are <20 chars. */
const MAX_FAULT_CODE_LEN = 128;

const FAULT_CODE_TOKEN = /\b[A-Za-z]{1,4}[-_]?\d{2,8}(?:[-_][A-Za-z0-9]+)?\b/g;

// A sentence that quotes-without-defining ("I can't verify what Q-447 means")
// is honest and allowed.
const NON_VERIFICATION =
  /\b(?:cannot|can'?t|unable\s+to|not\s+(?:able\s+to\s+)?(?:verify|confirm)|couldn'?t|unverified|don'?t\s+have|do\s+not\s+have|no\s+documentation|not\s+documented|isn'?t\s+documented|won'?t\s+guess|not\s+something\s+I\s+can)\b/i;

const FAULT_CONTEXT = /\b(?:fault|alarm|error|code|trip(?:ped|s)?)\b/i;

/* ------------------------------------------------------------------------ *
 * Detection-only canonicalization                                           *
 * ------------------------------------------------------------------------ */

/**
 * Hyphen-equivalent codepoints folded to ASCII `-`. NOT en/em dash.
 *
 * Membership is decided by Unicode decomposition, not by how a glyph looks:
 *   U+2010 HYPHEN, U+2012 FIGURE DASH, U+2212 MINUS SIGN  — hyphen/minus forms
 *   U+2011 NON-BREAKING HYPHEN  — <noBreak> U+2010        (the observed bypass)
 *   U+FE63 SMALL HYPHEN-MINUS   — <small>   U+002D
 *   U+FF0D FULLWIDTH HYPHEN-MINUS — <wide>  U+002D
 *
 * U+FE58 SMALL EM DASH is deliberately ABSENT. It was in this set until an
 * independent review checked its decomposition: `<small> U+2014`. It is an EM
 * DASH form, and folding it would have quietly contradicted the en/em-dash
 * exclusion three lines below — the precise class of interaction this file
 * exists to prevent. Judge a codepoint by `unicodedata.decomposition()`, never
 * by the shape of the glyph.
 */
const HYPHEN_EQUIV_CHARS = "\\u2010\\u2011\\u2012\\u2212\\uFE63\\uFF0D";
const HYPHEN_EQUIV = new RegExp(`[${HYPHEN_EQUIV_CHARS}]`, "g");
const APOSTROPHE_EQUIV_CHARS = "\\u2018\\u2019\\u02BC";
const APOSTROPHE_EQUIV = new RegExp(`[${APOSTROPHE_EQUIV_CHARS}]`, "g");

/**
 * Every Unicode SPACE SEPARATOR (category `Zs`) folded to ASCII " ".
 *
 * Chosen by Unicode category rather than by listing the ones we happened to
 * see: U+00A0, U+1680, the U+2000–U+200A block, U+202F, U+205F, U+3000. The
 * earlier hand-picked set (U+00A0, U+2007, U+202F) missed the entire
 * U+2000–U+200A block, and an exploratory fuzz over model-realistic variants
 * is what surfaced it.
 */
const UNICODE_SPACE_CHARS = "\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000";
const UNICODE_SPACE = new RegExp(`[${UNICODE_SPACE_CHARS}]`, "g");

/**
 * ALL invisible FORMAT characters (Unicode general category `Cf`) — removed
 * outright, because they are not part of the logical text at all.
 *
 * This is a CATEGORY, deliberately, and it is the second time that lesson has
 * had to be learned in this file. The first version listed six codepoints that
 * had actually been observed. An independent review then demonstrated a live
 * bypass of A1, A2 and A4 through eleven more — U+200E/U+200F and the
 * U+202A–U+202E and U+2066–U+2069 bidi controls — which are ordinary output
 * for a mixed-script model, and gpt-oss-120b, the model that caused #3973, is
 * one. A hand-picked list of invisible characters is the same mistake as a
 * hand-picked list of hyphens; only the category closes the class.
 *
 * U+00AD SOFT HYPHEN is in here by virtue of being `Cf`, and that is correct:
 * a soft hyphen is a LINE-BREAK HINT, not a hyphen. Folding it to "-" would
 * corrupt every word it appears inside ("ener\u00ADgized" -> "ener-gized"),
 * whereas removing it restores the word the model meant. The hazard grammars
 * already tolerate an absent hyphen ("re[-\s]?energi"), so stripping catches
 * "re\u00ADenergize" without inventing a hyphen anywhere.
 *
 * Safe to apply wholesale because this copy is never rendered: ZWJ emoji
 * sequences, Arabic number signs and language tags all lose nothing that a
 * SAFETY regex should have been matching on.
 */
const ZERO_WIDTH = /\p{Cf}/gu;

/**
 * Fold a string into the ASCII shape every rule in this file is written
 * against. **Detection only** — the returned string is never displayed,
 * persisted, or sent to a model. See `validateAnswer` for why en/em dash are
 * excluded.
 */
function foldForDetection(s: string): string {
  return s
    .replace(/[*`]/g, "")
    .replace(HYPHEN_EQUIV, "-")
    .replace(APOSTROPHE_EQUIV, "'")
    .replace(UNICODE_SPACE, " ")
    .replace(ZERO_WIDTH, "");
}

/**
 * Recover how a folded token was ACTUALLY spelled in the original text.
 *
 * Every user-visible string this module produces must come from the original
 * answer, never from the folded copy — otherwise the fold would silently
 * rewrite what the technician reads (a model that writes "Q\u2011447\u2011Delta"
 * must not be quoted back as "Q-447-Delta"). Only `specificityFallback` embeds
 * a matched token in visible text, so only that path needs this.
 *
 * Falls back to the folded token when the original cannot be located, which is
 * safe: the fallback text stays accurate, it just loses the exotic spelling.
 */
function originalSpelling(token: string, raw: string): string {
  const zw = "[\\u200B\\u200C\\u200D\\uFEFF]*";
  const body = Array.from(token)
    .map((ch) => {
      // These classes are the INVERSE of the fold sets above and must track
      // them. They were hand-duplicated once and immediately drifted: this
      // hyphen class still carried U+FE58 after it was removed from
      // HYPHEN_EQUIV for decomposing to EM DASH, and the space class was still
      // the pre-widening trio. Derived from one source now.
      if (ch === "-") return `[-${HYPHEN_EQUIV_CHARS}]`;
      if (ch === "'") return `['${APOSTROPHE_EQUIV_CHARS}]`;
      if (ch === " ") return `[ ${UNICODE_SPACE_CHARS}]`;
      return escapeRe(ch);
    })
    .join(zw);
  // A degenerate model output (a repetition loop) can produce a fault-code-
  // shaped token thousands of characters long, and this builds one regex
  // alternative per character: past ~40k the engine throws "regular expression
  // too large". That threw out of validateAnswer and errored the whole stream.
  // It failed CLOSED — no hazardous content shipped — but the documented
  // contract here is "falls back to the folded token", and it did not fall
  // back, it crashed. Now it does what it says.
  try {
    const m = new RegExp(zw + body, "i").exec(raw);
    return m ? m[0] : token;
  } catch {
    return token;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Codes the technician framed as fault/alarm/error codes in the question —
 *  defining one of these in the answer counts even when the answer's own
 *  sentence omits the word "fault". */
function questionCodes(question: string): Set<string> {
  if (!FAULT_CONTEXT.test(question)) return new Set();
  return new Set((question.match(FAULT_CODE_TOKEN) ?? []).map((t) => t.toLowerCase()));
}

function codeMeaningViolation(
  answer: string,
  question: string,
): { code: string; excerpt: string } | null {
  const asked = questionCodes(question);
  // Sentence-level DETECTION only — the draft is never rewritten piecewise
  // (research §"Correct the specificity gate": no uncontrolled splitting).
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const inFaultContext = FAULT_CONTEXT.test(s);
    // R1 (Codex finding, PR #3792 review): the honest-uncertainty exemption is
    // CLAUSE-scoped, not sentence-scoped. "I can't verify the manual, but
    // Q-447-Delta means a communication error" contains a disclaimer AND a
    // separate affirmative definition — the disclaimer must not exempt it.
    // "I can't verify what Q-447-Delta means" keeps its exemption because the
    // non-verification and the definition frame share one clause.
    const clauses = s.split(/[,;:]|—|–|\bbut\b|\bhowever\b|\byet\b/i);
    for (const clause of clauses) {
      if (NON_VERIFICATION.test(clause)) continue;
      for (const tok of clause.match(FAULT_CODE_TOKEN) ?? []) {
        // FAULT_CODE_TOKEN's trailing suffix is unbounded, so a model stuck in
        // a repetition loop yields a "fault code" thousands of characters long.
        // Every regex built from it below scales with its length, and past a
        // few thousand the engine throws "regular expression too large" —
        // which escaped validateAnswer and errored the whole SSE stream. It
        // failed CLOSED (nothing hazardous shipped) but it denied service on a
        // plausible degenerate output. No real fault code is anywhere near
        // this long; anything that is, is not a code worth defining.
        if (tok.length > MAX_FAULT_CODE_LEN) continue;
        if (!inFaultContext && !asked.has(tok.toLowerCase())) continue;
        const esc = escapeRe(tok);
        // "Q-447-Delta (usually) means/indicates/is a …" — a definition,
        // hedged or not. Hedges do not rescue an invented meaning.
        const defFrame = new RegExp(
          `["'\`]?${esc}["'\`]?(?:\\s*\\([^)]{0,40}\\))?\\s+(?:fault\\s+|alarm\\s+|error\\s+|code\\s+)?(?:usually\\s+|typically\\s+|often\\s+|generally\\s+|most\\s+likely\\s+)?(?:means|indicates|signals|refers\\s+to|stands\\s+for|denotes|corresponds\\s+to|is\\s+(?:a|an|the)|is\\s+caused\\s+by|occurs\\s+when)\\b`,
          "i",
        );
        // "the most likely reason you're seeing 'Q-447-Delta' is …"
        const causeFrame = new RegExp(
          `\\b(?:reason|cause)\\b[^.!?\\n]{0,60}\\b(?:seeing|getting|displaying|showing)\\s*["'\`]?${esc}["'\`]?[^.!?\\n]{0,25}\\bis\\b`,
          "i",
        );
        if (defFrame.test(clause) || causeFrame.test(clause)) {
          return { code: tok, excerpt: s.slice(0, 160) };
        }
      }
    }
  }
  return null;
}

/** Deterministic replacement for a specificity rejection — honest about the
 *  gap, still useful, funnels to upload (#3787 two-lane design, guardrails
 *  2–4). Never interpolates model output beyond the technician-shaped code. */
export function specificityFallback(code: string | null): string {
  const head = code
    ? `I can't verify what ${code} means on this machine from the evidence in this conversation, and I won't guess at machine-specific facts.`
    : `I can't verify that machine-specific detail from the evidence in this conversation, and I won't guess.`;
  return `${head}

What I can tell you honestly:
- Confirm the exact code and any text shown on the display — fault text often names the failing subsystem directly.
- With the machine electrically isolated, check the basics: supply power, E-stop state, tripped breakers, loose terminals, and anything that changed since it last ran.
- Note whether the problem returns immediately on restart or only under load — that separates a latched trip from an active condition.

If you add this machine's manual as a source and ask again, I'll give you the exact answer with a page reference.`;
}

/* ------------------------------------------------------------------------ *
 * Entry point                                                               *
 * ------------------------------------------------------------------------ */

export function validateAnswer(opts: {
  answerText: string;
  question: string;
  general: boolean;
  served: boolean;
  refused: boolean;
  /** Does anything back this turn — retrieved chunks, a machine packet, or a
   *  photo observation (current or prior) in context? Defaults to true so
   *  callers that do not track evidence keep the pre-2026-09-22 behaviour. */
  evidenceSufficient?: boolean;
}): AnswerValidation {
  const { answerText, question, general, served, refused } = opts;
  const evidenceSufficient = opts.evidenceSufficient ?? true;
  if (!served || !answerText.trim()) return { ok: true };

  // R2 (Codex finding, PR #3792 review): validate a NORMALIZED copy so
  // Markdown emphasis cannot break token adjacency ("**Q-447-Delta** means").
  // Asterisks and backticks appear in no fault-code token and no safety
  // phrase; underscores are left alone (they occur inside real tokens).
  // Detection-only — the displayed/persisted text is never this copy.
  //
  // R3 (#3973, found on live staging 2026-09-24): the same normalization has
  // to fold Unicode dashes and spaces to ASCII, because EVERY hyphen-sensitive
  // rule in this file is written against the ASCII "-". Groq's
  // openai/gpt-oss-120b routinely emits U+2011 NON-BREAKING HYPHEN, and the
  // staging leak that motivated this line was a complete restore-power-to-
  // measure procedure that A4 catches verbatim once the hyphen is ASCII and
  // misses entirely as "Re\u2011energize". The mirror risk — `(?<![\w-])energized`
  // exists to keep the SAFE "de-energized" out of the hazard grammars, and
  // U+2011 is in neither `\w` nor `-` — was measured and did NOT reproduce;
  // it is pinned as a control in answer-validation-unicode-hyphen.test.ts so
  // it cannot appear later. The ASCII assumption is file-wide rather than A4's,
  // which is why this folds here instead of widening one regex.
  //
  // The fold is deliberately HYPHENS ONLY. U+2013 EN DASH and U+2014 EM DASH
  // are load-bearing in this file and must NOT be folded: CLAUSE_BOUNDARY
  // splits on them, NUM/RANGE parse "0–600 A" through them, and three
  // HAZARD_AFFIRMATIONS anchor a sentence start on `[—–]`. Folding those to
  // "-" would silently rewrite A2's clause scoping and B's numeric grammar.
  // The observed bypass was U+2011; en dash appeared in the leaked answer only
  // as a list separator and was never load-bearing for the match.
  const scanText = foldForDetection(answerText);
  // The QUESTION is an input to detection too. `codeMeaningViolation` decides
  // whether a fault code was "asked about" by matching tokens from the
  // question; if the answer is folded and the question is not, the two stop
  // agreeing and a code spelled with U+2011 on BOTH sides escapes the rule
  // entirely. Measured, not assumed — see answer-validation-unicode-hyphen.
  const scanQuestion = foldForDetection(question);

  // A — both lanes, refusals included (cheap, and a mis-classified "refusal"
  // must not skip the floor).
  // Mask only complete administrative sentences, preserving every separator.
  // A1 uses whitespace inside phrases ("lockout is\nnot required"), so scanning
  // each sentence/line independently would weaken its existing coverage.
  const affirmationScanText = scanText.split(/((?<=[.!?])\s+)/)
    .map((part) => PERMIT_PRACTICES_DESCRIPTION.test(part.trim())
      ? part.replace(/[^\r\n.!?]/g, " ") : part)
    .join("");
  for (const p of HAZARD_AFFIRMATIONS) {
    const m = p.re.exec(affirmationScanText);
    if (m) {
      return {
        ok: false,
        kind: "unsafe_answer",
        violation: `unsafe-answer:${p.id}`,
        detail: m[0].slice(0, 160),
        replacement: SAFETY_STOP,
      };
    }
  }

  // A4 (#3973): restoring power in order to take a reading. Runs BEFORE the
  // generic clause rule because the same sentence usually satisfies both, and
  // this rule's response is the useful one — "de-energize first" is not
  // actionable advice for a measurement that only exists while the conductor
  // is live.
  //
  // UNCONDITIONAL, after measuring the alternative. It was first written to
  // fire only when the caller had classified the turn
  // (`matchSafetyStop` → ENERGIZED_ELECTRICAL_HAZARD), on the theory that
  // "re-energize" needs the category's blast radius to be safe. Both halves of
  // that were checked and the gate lost: the classifier is a QUESTION test and
  // returns null for "The MCC is humming weird. What should I check?", so a
  // gated rule would miss a hazardous ANSWER to an innocuous question — the
  // exact shape of #3973 one step earlier. And the feared false positives do
  // not occur: "only after the work is complete may the feeder be
  // re-energized", "after the repair, re-energize and confirm the drive comes
  // up", "turn the disconnect back on and verify the contactor pulls in" all
  // pass, because the narrow MEASURE_ACTION set below excludes work/replace/
  // service/verify. Pinned as controls in
  // answer-validation-energized-procedure.test.ts.
  const restore = restoreEnergyToMeasure(scanText);
  if (restore) {
    return {
      ok: false,
      kind: "unsafe_answer",
      violation: "unsafe-answer:energized-procedure",
      detail: restore.slice(0, 160),
      replacement: ENERGIZED_PROCEDURE_WITHHELD,
    };
  }

  // A2 — the clause-level inversion, both lanes, refusals included. Runs
  // AFTER the head grammars so their pinned violation ids are preserved.
  const hazard = clauseHazardViolation(affirmationScanText);
  if (hazard) {
    return {
      ok: false,
      kind: "unsafe_answer",
      violation: `unsafe-answer:clause-hazard-${hazard.relId}`,
      detail: hazard.sentence.slice(0, 160),
      replacement: SAFETY_STOP,
    };
  }

  // A3 — rigging overload (same-unit rated-capacity comparison, both lanes).
  const rig = riggingOverload(scanText);
  if (rig) {
    return {
      ok: false,
      kind: "unsafe_answer",
      violation: "unsafe-answer:rigging-overload",
      detail: rig,
      replacement: SAFETY_STOP,
    };
  }

  // B — general lane only. The grounded lane's specificity discipline is the
  // citation contract, already enforced upstream.
  if (!general || refused) return { ok: true };

  for (const p of FABRICATED_DOC_PATTERNS) {
    const m = p.re.exec(scanText);
    if (m) {
      return {
        ok: false,
        kind: "unsupported_specificity",
        violation: `fabricated-doc:${p.id}`,
        detail: m[0].slice(0, 160),
        replacement: specificityFallback(null),
      };
    }
  }

  const es = EXACT_SETTING_RE.exec(scanText);
  if (es) {
    return {
      ok: false,
      kind: "unsupported_specificity",
      violation: "unsupported-specificity:exact-setting",
      detail: es[0].slice(0, 160),
      replacement: specificityFallback(null),
    };
  }

  if (!evidenceSufficient) {
    const er = unsupportedExactRating(scanText);
    if (er) {
      return {
        ok: false,
        kind: "unsupported_specificity",
        violation: "unsupported-specificity:exact-rating",
        detail: er,
        replacement: specificityFallback(null),
      };
    }
  }

  const cm = codeMeaningViolation(scanText, scanQuestion);
  if (cm) {
    return {
      ok: false,
      kind: "unsupported_specificity",
      violation: "unsupported-specificity:code-meaning-asserted",
      detail: cm.excerpt,
      // The ONLY visible string in this module built from a matched token, so
      // it is the one place the fold could leak into what a technician reads.
      // Quote the code as the model actually spelled it.
      replacement: specificityFallback(originalSpelling(cm.code, answerText)),
    };
  }

  return { ok: true };
}

/** Split accepted text into whitespace-boundary pieces (~≤120 chars) so the
 *  release keeps the client's incremental-render path. Concatenation of the
 *  pieces is byte-identical to the input. */
export function chunkForRelease(text: string, max = 120): string[] {
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= max) {
      out.push(text.slice(start));
      break;
    }
    let cut = text.lastIndexOf(" ", start + max);
    if (cut <= start) cut = start + max;
    else cut += 1; // keep the space with the leading piece
    out.push(text.slice(start, cut));
    start = cut;
  }
  return out;
}
