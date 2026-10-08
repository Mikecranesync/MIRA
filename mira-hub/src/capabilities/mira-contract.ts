/**
 * MIRA Intelligence Contract — slice 1, rebuilt on main (#3959, 2026-10-05).
 *
 * The original #3959 draft made "augmented" the default for every notebook
 * turn. Its own staging acceptance found the cost: once a model is asked to
 * DECIDE whether a partially matching excerpt supports an answer, citation
 * becomes a judgement (attached manual cited 3/5, OEM 4/5) instead of the
 * constraint grounded mode enforces. Owner decision 2026-10-05, answering how a
 * turn with an attached manual and matching excerpts should route: "Grounded
 * when attached+hit". Main already does that (`docGrounded` selects the
 * grounded prompt), so this slice changes exactly one case:
 *
 *   sources attached, the scoped search matched NOTHING, no specific decline
 *   lane applies  →  answer from general knowledge, saying first that nothing
 *   in the attached documents matched, instead of abstaining (#4015's
 *   "couldn't find that in the documentation I have").
 *
 * Attaching a manual is not consent to document-only answers. A technician who
 * wants document-only answers asks for them explicitly (`mode: "source_only"`),
 * which keeps the abstain. In a machine-bound notebook a question about that
 * machine also keeps the abstain (#4068, see answersOnAttachedMiss), so what
 * this lane answers is a teaching question, or any question in a notebook
 * bound to no machine. Main's other decline lanes (missing model manual, no
 * evidence for the machine, unidentified service text, photo part lookups)
 * run only on general turns and are untouched.
 *
 * Behind MIRA_PERSONA_CONTRACT, default off: with it off the route is
 * byte-identical to before. The flag reaches the container only through a
 * compose `environment:` line; those files are lifecycle-guarded, so the owner
 * adds the line when staging should try it.
 *
 * Deferred (not this slice): one shared persona/identity block across Hub
 * surfaces. Main's prompts now carry rules (NFPA 70E energized-work redirect,
 * plant-specific-value abstain) that the 09-22 contract text contradicts, so
 * consolidating them is a safety-reviewed change of its own.
 */

/** Is the contract active? Default OFF. */
export function miraContractEnabled(): boolean {
  return process.env.MIRA_PERSONA_CONTRACT === "1";
}

/**
 * Should this turn answer from general knowledge instead of abstaining?
 * Only for a NON-general turn (sources attached), only when nothing matched,
 * never when the technician asked for source-only answers, and never for a
 * question about THIS machine in a machine-bound notebook: #4068's owner
 * decision (2026-09-27, "lean to declining") is the more specific rule there —
 * an uncited answer about this machine is not acceptable. The caller computes
 * `machineSpecificQuestion` with the same predicates that lane uses
 * (asksAboutThisEquipment / asksForDocumentedValue against the bound model),
 * so the two lanes cannot disagree about what "about this machine" means.
 */
export function answersOnAttachedMiss(turn: {
  general: boolean;
  sourceOnly: boolean;
  chunkCount: number;
  machineSpecificQuestion: boolean;
}): boolean {
  return (
    miraContractEnabled() && !turn.general && !turn.sourceOnly && turn.chunkCount === 0 && !turn.machineSpecificQuestion
  );
}

/**
 * The exact sentence the answer opens with. Worded so the route's refusal
 * classifier (a negation verb such as "don't"/"cannot" near "find/contain/
 * cover…" plus "documents/manual…") cannot read it as a refusal: a search that
 * matched nothing is reported, not a claim that the documents lack the topic.
 */
export const ATTACHED_MISS_LEAD =
  "Nothing in your attached documents matched this question, so this answer is from general knowledge.";

/**
 * Lines of the general prompt that are FALSE for an attached-miss turn, and
 * their replacements. Everything else in the general prompt — the bracket ban,
 * the NFPA 70E redirect, the plant-specific abstain, the honesty rules about
 * part numbers — is kept byte for byte.
 */
export const ATTACHED_MISS_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "No manual for this machine has been loaded, so you are reasoning from general electrical, mechanical, and controls knowledge.",
    "The technician's attached documents were searched for this question and nothing in them matched, so you are reasoning from general electrical, mechanical, and controls knowledge.",
  ],
  [
    "- You have NO manual for this machine. Never decode",
    "- No excerpt from the attached documents is in front of you. Never decode",
  ],
  [
    "- You searched NO documentation. Never write \"the documentation does not specify\", \"the manual doesn't say\", or anything implying you looked something up and it was missing. Say \"I'm answering from general knowledge, not this machine's manual\" instead.",
    `- Begin the answer with exactly this sentence: "${ATTACHED_MISS_LEAD}" Then answer. Never write that the documents or the manual do not cover, specify or say something: a search that matched nothing does not prove the documents lack it.`,
  ],
];

/**
 * The general prompt rewritten for an attached-miss turn. Returns null when
 * any line to replace is not found exactly once — the general prompt changed —
 * so the caller keeps the abstain rather than sending a prompt that still says
 * "no manual has been loaded" to a technician who attached one.
 */
export function attachedMissPrompt(generalPrompt: string): string | null {
  let out = generalPrompt;
  for (const [from, to] of ATTACHED_MISS_REPLACEMENTS) {
    if (out.split(from).length !== 2) return null;
    out = out.replace(from, to);
  }
  return out;
}
