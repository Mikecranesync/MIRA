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
  "(?:reset(?:ting)?|clear(?:ing)?|work(?:ing)?|reach(?:ing)?|touch(?:ing)?|open(?:ing)?|remov\\w+|replac\\w+|repair(?:ing)?|servic\\w+|maintenance|adjust(?:ing)?|probe|probing|test(?:ing)?|measur\\w+)";
const ENERGIZED_STATE = "(?:energized|live|hot|powered(?:\\s+on)?|running)";

const HAZARD_AFFIRMATIONS: readonly { readonly id: string; readonly re: RegExp }[] = [
  // "yes, you can reset it while the machine is energized" /
  // "it is safe to work on the contactor while live"
  {
    id: "affirm-energized-work",
    re: new RegExp(
      "\\b(?:yes,?\\s+)?(?:you\\s+(?:can|may)|it(?:'s|\\s+is)\\s+(?:safe|permitted|acceptable|fine|ok(?:ay)?)|(?<!\\bnot\\s)(?<!n't\\s)(?<!\\bnever\\s)(?<!\\bcannot\\s)safe(?:ly)?\\s+to)\\b[^.!?\\n]{0,50}\\b" +
        HAZARD_ACTIONS +
        "\\b[^.!?\\n]{0,60}\\b(?:while|with)\\b[^.!?\\n]{0,40}\\b" +
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
        "\\b[^.!?\\n]{0,60}\\b(?:while|with)\\b[^.!?\\n]{0,40}\\b" +
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
    re: /(?:^|[.!?:;]\s+|[—–]\s*|\n)\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:then\s+|next\s+|now\s+|first\s+|simply\s+|just\s+|go\s+ahead\s+and\s+)?(?:reset|clear|open|remove|replace|repair|service|adjust|probe|test|measure|proceed(?!\s+with\s+caution\b)|continue|work|perform|conduct|carry(?:\s+out)?|complete|begin|start)\b[^.!?\n]{0,60}\b(?:while|with)\s[^.!?\n]{0,40}\b(?:energized|live|hot|powered(?:\s+on)?|running)\b/im,
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
];

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
