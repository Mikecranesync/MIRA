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
  "(?:reset(?:ting)?|clear(?:ing)?|work(?:ing)?|reach(?:ing)?|touch(?:ing)?|open(?:ing)?|remov\\w+|replac\\w+|repair(?:ing)?|servic\\w+|maintenance|adjust(?:ing)?|probe|probing|test(?:ing)?|measur\\w+|perform(?:ing)?|conduct(?:ing)?|carry(?:ing)?(?:\\s+out)?)";
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
];

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
const ENERGIZED_RELATION_SRC =
  ENERGIZED_LINK + "\\b[^.!?\\n]{0,40}?(?:(?<![\\w-])energized|\\blive\\b|\\bhot\\b|\\bpowered(?:\\s+on)?\\b|\\brunning\\b)";
const ENERGIZED_RELATION = new RegExp("\\b" + ENERGIZED_RELATION_SRC, "i");
const NO_ISOLATION_RELATION = new RegExp("\\b" + NO_ISOLATION, "i");
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
const NEG_HEAD_SRC =
  "(?:not|no|never|don'?t|do\\s+not|doesn'?t|does\\s+not|cannot|can'?t|couldn'?t|won'?t|wouldn'?t|shouldn'?t|should\\s+not|must\\s+not|mustn'?t|may\\s+not|avoid|refrain\\s+from)";
const NEG_AUX_GAP_SRC =
  "(?:\\s+(?:be|being|been|get|ever|even|again|simply|just|safe|safely|to|attempt\\s+to|try\\s+to)){0,3}";
const BOUND_PROHIBITION = new RegExp(
  "\\b" + NEG_HEAD_SRC + NEG_AUX_GAP_SRC + "\\s+" + HAZARD_ACTION_ANY_SRC + "\\b" +
    "|\\b" + NEG_HEAD_SRC + "\\s+(?:" + ENERGIZED_RELATION_SRC + "|" + NO_ISOLATION + ")" +
    "|\\b" + HAZARD_ACTION_ANY_SRC +
    "\\b[^.!?\\n]{0,60}?\\b(?:is|are|would\\s+be|remains)\\s+(?:strictly\\s+|extremely\\s+|very\\s+)?(?:dangerous|hazardous|unsafe|prohibited|forbidden|banned|illegal|not\\s+(?:allowed|permitted|safe|acceptable|recommended|advisable)|never\\s+(?:safe|allowed|permitted|acceptable)|against\\s)" +
    "|\\b(?:with|use|exercise)\\s+(?:extreme\\s+)?caution\\b|\\bunder\\s+no\\s+circumstances\\b",
  "i",
);

// Iteration-5 F1: the exemption must bind to the clause(s) that carry the
// hazardous instruction. Same boundary set as the R1 honesty-exemption
// splitter (comma/semicolon/colon/dash + contrastive conjunctions), so both
// exemptions scope identically.
const CLAUSE_BOUNDARY = /[,;:]|—|–|\bbut\b|\bhowever\b|\byet\b|\balthough\b|\bthough\b/i;

/** Returns the offending sentence, or null. DETECTION is sentence-scoped —
 *  splitting an instruction across punctuation ("While the machine is
 *  energized, reset the fault") must not hide it. The prohibitive/cautionary
 *  EXEMPTION is clause-scoped (iteration-5 F1): it applies only when the
 *  marker appears in a clause that carries part of the instruction (the
 *  hazard action or the energized/no-isolation relation). A warning or
 *  negation in an unrelated clause ("There is risk, but …", "Do not
 *  hesitate: …") never exempts. Detection only, never rewriting. */
function clauseHazardViolation(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!HAZARD_ACTION_ANY.test(sentence)) continue;
    if (!ENERGIZED_RELATION.test(sentence) && !NO_ISOLATION_RELATION.test(sentence)) continue;
    const bearing = sentence
      .split(CLAUSE_BOUNDARY)
      .filter(
        (c) =>
          HAZARD_ACTION_ANY.test(c) || ENERGIZED_RELATION.test(c) || NO_ISOLATION_RELATION.test(c),
      );
    // Fail-closed: no identifiable instruction-bearing clause (pathological
    // splitting) means no exemption is possible — the sentence-level match
    // above already established the hazardous coupling. The exemption must
    // GRAMMATICALLY bind the hazard (iteration-6 F1) — bare negation of some
    // other predicate in the same clause never exempts.
    const reassured = bearing.some((c) => REASSURANCE_AFFIRMATION.test(c));
    const prohibited = bearing.some((c) => BOUND_PROHIBITION.test(c));
    if (!reassured && prohibited) continue;
    return sentence;
  }
  return null;
}

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

// Fault-code-shaped token: letter prefix, optional separator, 2+ digits,
// optional suffix — Q-447-Delta, ZX-9987, F0000000, E-12. Deliberately does
// NOT match bare numbers, voltages (480V), thread sizes (M8), or model names
// without a digit run (S7-1500's "S7" has a single digit).
const FAULT_CODE_TOKEN = /\b[A-Za-z]{1,4}[-_]?\d{2,8}(?:[-_][A-Za-z0-9]+)?\b/g;

// A sentence that quotes-without-defining ("I can't verify what Q-447 means")
// is honest and allowed.
const NON_VERIFICATION =
  /\b(?:cannot|can'?t|unable\s+to|not\s+(?:able\s+to\s+)?(?:verify|confirm)|couldn'?t|unverified|don'?t\s+have|do\s+not\s+have|no\s+documentation|not\s+documented|isn'?t\s+documented|won'?t\s+guess|not\s+something\s+I\s+can)\b/i;

const FAULT_CONTEXT = /\b(?:fault|alarm|error|code|trip(?:ped|s)?)\b/i;

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
}): AnswerValidation {
  const { answerText, question, general, served, refused } = opts;
  if (!served || !answerText.trim()) return { ok: true };

  // R2 (Codex finding, PR #3792 review): validate a NORMALIZED copy so
  // Markdown emphasis cannot break token adjacency ("**Q-447-Delta** means").
  // Asterisks and backticks appear in no fault-code token and no safety
  // phrase; underscores are left alone (they occur inside real tokens).
  // Detection-only — the displayed/persisted text is never this copy.
  const scanText = answerText.replace(/[*`]/g, "");

  // A — both lanes, refusals included (cheap, and a mis-classified "refusal"
  // must not skip the floor).
  for (const p of HAZARD_AFFIRMATIONS) {
    const m = p.re.exec(scanText);
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

  // A2 — the clause-level inversion, both lanes, refusals included. Runs
  // AFTER the head grammars so their pinned violation ids are preserved.
  const hazardSentence = clauseHazardViolation(scanText);
  if (hazardSentence) {
    return {
      ok: false,
      kind: "unsafe_answer",
      violation: "unsafe-answer:clause-hazard-energized",
      detail: hazardSentence.slice(0, 160),
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

  const cm = codeMeaningViolation(scanText, question);
  if (cm) {
    return {
      ok: false,
      kind: "unsupported_specificity",
      violation: "unsupported-specificity:code-meaning-asserted",
      detail: cm.excerpt,
      replacement: specificityFallback(cm.code),
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
