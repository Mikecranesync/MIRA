import { EARLIER_SUBJECT_WAY_OUT } from "./manual-applicability";
import { familyCovers, modelMentionsInText } from "./model-token";

/**
 * CV-101 journey S6 (2026-11-08): a question that names a model the notebook's
 * manuals do not cover ("Micro850" in a notebook holding only the Micro820
 * installation instructions) is refused by retrieval — correctly, since a
 * sibling's values must never be cited — but the reply used to be the generic
 * "add the manual for the equipment you're asking about". When retrieval can
 * PROVE the mismatch (every refused page declares its own, different model on
 * its cover), the reply says so, names both models, and still refuses to answer
 * from the wrong manual. Static text plus identity labels only: no value, page
 * or wording from the refused manual ever reaches it.
 */

/** What retrieveNodeChunks reports: the identities the question named, and the
 *  identities the refused manuals declare (modelIdentitiesInText's shape). */
export type NamedModelMismatch = {
  requested: string[];
  declared: string[];
  /** Set when the model was named in an earlier question of this conversation
   *  that was not answered from a document, not in this one. */
  source?: "conversation";
};

/** "MICRO850" → "Micro850", "PF525" → "PowerFlex 525"; other identities as stored. */
export function displayModelIdentity(id: string): string {
  const micro = /^MICRO(\d+)$/.exec(id);
  if (micro) return `Micro${micro[1]}`;
  const pf = /^PF(\d+M?)$/.exec(id);
  if (pf) return `PowerFlex ${pf[1]}`;
  // #5355: the SMC starters as Rockwell writes them.
  if (id === "SMCFLEX") return "SMC Flex";
  const smc = /^SMC(\d+)$/.exec(id);
  if (smc) return `SMC-${smc[1]}`;
  return id;
}

const list = (ids: string[]) => ids.map(displayModelIdentity).join(" / ");

export function namedModelMismatchText(m: NamedModelMismatch): string {
  const asked = list(m.requested);
  const have = list(m.declared);
  if (m.source === "conversation") {
    return `The manual in this notebook is for the ${have}, not the ${asked} you asked about earlier in this conversation, so I won't answer from it — its values may not apply to the ${asked}. ${EARLIER_SUBJECT_WAY_OUT} Otherwise add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
  }
  return `The manual in this notebook is for the ${have}, not the ${asked} you asked about, so I won't answer from it — its values may not apply to the ${asked}. Add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
}

/**
 * No manual is selected, so the only pages the turn had were the shared
 * library's for the model the search was held to, and the question names a
 * model those pages do not cover. Static text plus identity labels only.
 */
export function libraryNotForAskedModelText(requested: string[], libraryModel: string): string {
  const asked = list(requested);
  return `No manual is selected for this question, so the only pages I could use are the shared library's for the ${libraryModel}. You asked about the ${asked}, so I won't answer from them — their values may not apply to the ${asked}. Select or attach the ${asked} manual (or the page that covers it) and ask again.`;
}

/**
 * #5355 (Mike, 2026-11-09): a question that names two models is either a
 * genuine comparison / connection ("SMC-50 vs SMC Flex", "Micro820
 * communicating with Micro850") or an ambiguous request ("my SMC-50 or SMC
 * Flex just faulted, what is code 10?"). Codex r2 on #5359: scanning the whole
 * question for cue words misfired both ways ("tripped due to a fault" read as
 * a comparison). So ambiguity is decided by what sits BETWEEN two adjacent
 * mentions of one product family (same identity prefix: SMC, PF, MICRO…) in
 * one clause, and the DEFAULT is to ask which one (Codex r6 F8: after four
 * rounds of listing the gap shapes that ask — "or", "(or maybe", ", or",
 * "(maybe" — the rule is inverted, so a phrasing nobody listed asks):
 * - doubt between them ("or", "/", "maybe", "possibly", "perhaps", "probably",
 *   "either", "could", "might", "may", "mixed up", "confused", "mistaken",
 *   "not sure/certain", "don't know", "unclear", "I think/guess/believe")
 *   always asks, whatever else the sentence says (Codex r4 F6: no comparison
 *   word exempts an explicit alternative);
 * - nothing or a bare "," asks, unless the clause opens with a comparison that
 *   names the list ("Compare the SMC-50, SMC Flex fault codes");
 * - the pair is answered only when the words between them are EXACTLY one
 *   link from a closed list (optionally after a comma, before the/my/a/an):
 *   explicit links answer on their own — vs, versus, than, compared with/to,
 *   connected/wired/talking/communicating/linked/networked with/to, (is) the
 *   same as, similar to, different from; plain links (and, with, to, from)
 *   answer only when the sentence also names why two machines are involved —
 *   a comparison, a replacement or move, a connection or network, "both"
 *   (Codex r10–r13: free words, and a bare "and", were eventually a hedge);
 * - identity doubt anywhere in the sentence ("mixed up", "confused", "can't
 *   tell … apart", "not sure", "which one") asks; modal words ("might",
 *   "could", "may") ask only between the names, since "why might the link be
 *   down" is about the fault, not the machine (Codex r13 F14);
 * - anything else asks.
 * Different families are never ambiguous here. Pure, no LLM.
 */
const CLAUSE_BREAK_RE = /[.?!;:]/;
// Doubt BETWEEN the two names: an alternative ("or", "/") or any hedge.
const DOUBT_GAP_RE =
  /\bor\b|\/|\b(?:maybe|possibly|perhaps|probably|either|could|might|may|unsure|uncertain|unclear|aka|mix(?:ed)?\s+up|confus\w*|mistak\w*|not\s+(?:sure|certain)|(?:do\s*n[o']?t|don't)\s+know|can'?t\s+tell|cannot\s+tell|apart|i\s+(?:think|guess|believe))\b/i;
// Doubt about WHICH MACHINE anywhere in the sentence. Modal words about the
// fault or the link ("why might the link be down", "how could they talk")
// are not identity doubt (Codex r13 F14), so they count only between the names.
const IDENTITY_DOUBT_RE =
  /\b(?:unsure|uncertain|unclear|aka|mix(?:ed)?\s+up|confus\w*|mistak\w*|not\s+(?:sure|certain)|(?:do\s*n[o']?t|don't)\s+know|can'?t\s+tell|cannot\s+tell|apart|which\s+one|i\s+(?:think|guess|believe))\b/i;
// Codex r11 F13: free text inside the "answered" exception was eventually a
// hedge, so it is a CLOSED list of exact links. Codex r13 F13: a plain "and"
// can join two machines or one machine the technician cannot place ("I can't
// tell the SMC-50 and SMC Flex apart"), so plain links answer only when the
// sentence also says why two machines are named (a comparison, a replacement
// or move, or a connection).
const EXPLICIT_LINK_SRC =
  "(?:vs|versus|than|compared\\s+(?:with|to)|(?:communicating|talking|connected|wired|linked|networked)\\s+(?:with|to)|(?:is\\s+|are\\s+)?(?:the\\s+same\\s+as|similar\\s+to|different\\s+from))";
const gapIs = (link: string) => new RegExp(`^\\s*,?\\s*${link}\\s+(?:(?:the|my|a|an)\\s+)?$`, "i");
const EXPLICIT_GAP_RE = gapIs(EXPLICIT_LINK_SRC);
const PLAIN_GAP_RE = gapIs("(?:and|with|to|from)");
const TWO_MACHINE_CUE_RE =
  /\b(?:compar\w*|differen\w*|replac\w*|swap\w*|upgrad\w*|migrat\w*|mov(?:e|ing)\b|transfer\w*|cop(?:y|ying)\b|communicat\w*|connect\w*|wir(?:e|ed|ing)\b|network\w*|talk\w*|link\w*|both)\b/i;
const LIST_GAP_RE = /^\s*\(?\s*,?\s*(?:(?:the|my|a|an)\s+)?$/i;
// Only a comparison that names the listed models: "compare", "comparing",
// "comparison", "difference(s) between". Not "compared to", not a bare
// "between" or "vs" elsewhere in the clause (Codex r4 F6). A clause ends at
// . ? ! ; or :, so a comparison in another sentence never applies.
const LIST_COMPARISON_RE = /\b(?:compare|comparing|comparison|differences?\s+between)\b/i;
const clauseBefore = (text: string, at: number) => text.slice(0, at).split(/[.?!;:]/).pop() ?? "";

/** The family prefix of an identity ("SMC50" → "SMC", "PF4M" → "PF"); null for
 *  identities without a letter prefix (catalog numbers). */
const familyOf = (id: string): string | null => /^([A-Z]+)\d|^([A-Z]+)FLEX$/.exec(id)?.slice(1).find(Boolean) ?? null;

export function ambiguousSiblingModels(question: string): string[] | null {
  // A family named alongside one of its own members ("Micro800 … Micro820") is
  // that member, so the family mention is dropped before pairing (Codex r7 F9).
  // Dropping it, rather than skipping its pairs, keeps the members it sits
  // between adjacent: "Micro820 (or Micro800 series Micro850)" still compares
  // 820 with 850 across the gap and its "or" (Codex r8 F10).
  const all = modelMentionsInText(question);
  const mentions = all.filter((m) => !all.some((o) => o !== m && familyCovers(m.id, o.id)));
  // Each model is compared with the NEXT model of its own family, skipping other
  // families in between: "SMC-50 connected to a Micro820 might be an SMC Flex"
  // still compares the two starters (Codex r9 F11). The clause rule below keeps
  // the comparison inside one clause.
  for (let i = 0; i < mentions.length; i++) {
    const a = mentions[i];
    const family = familyOf(a.id);
    if (!family) continue;
    const b = mentions.slice(i + 1).find((m) => familyOf(m.id) === family);
    if (!b || a.id === b.id || b.start < a.end) continue;
    const gap = question.slice(a.end, b.start);
    if (CLAUSE_BREAK_RE.test(gap)) continue;
    // Identity doubt anywhere in the SENTENCE that holds the pair asks, even
    // across a ; or : ("Not sure which: the SMC-50 vs the SMC Flex"); any hedge
    // between the names asks (Codex r11/r12/r13 F13).
    const sentence = (question.slice(0, a.start).split(/[.?!]/).pop() ?? "") + question.slice(a.start, b.end) + (question.slice(b.end).split(/[.?!]/)[0] ?? "");
    if (IDENTITY_DOUBT_RE.test(sentence) || DOUBT_GAP_RE.test(gap)) return [a.id, b.id].sort();
    if (LIST_GAP_RE.test(gap)) {
      if (LIST_COMPARISON_RE.test(clauseBefore(question, a.start))) continue;
      return [a.id, b.id].sort();
    }
    if (EXPLICIT_GAP_RE.test(gap)) continue;
    if (PLAIN_GAP_RE.test(gap) && TWO_MACHINE_CUE_RE.test(sentence)) continue;
    return [a.id, b.id].sort();
  }
  return null;
}

export function ambiguousModelAskText(ids: string[]): string {
  const names = ids.map(displayModelIdentity);
  const listed = names.length === 2 ? `${names[0]} or the ${names[1]}` : `${names.slice(0, -1).join(", ")} or the ${names[names.length - 1]}`;
  return `You mentioned the ${names.join(" and the ")}. They are different models with different fault codes and settings, so I won't guess which one you mean. Which one is it — the ${listed}? Ask again naming just that one and I'll answer from its manual.`;
}

/** Garage pilot L8 (Mike 2026-11-12): the project is confirmed as one unit by its
 *  catalog number and the question names a sibling of that number's family. Both
 *  numbers are named, no value is given, and the wording is one the pilot
 *  harness's refusal rule reads as a refusal that names the manual. */
export function siblingOfRecordAskText(d: { asked: string[]; record: string }): string {
  const asked = d.asked.map((a) => `the ${a}`);
  const listed = asked.length <= 1 ? asked.join("") : `${asked.slice(0, -1).join(", ")} or ${asked[asked.length - 1]}`;
  return `This project is set up for the ${d.record}. Your question is about ${listed}, which is a different unit, so I can't give its values from this project's manual — the pages here answer for the ${d.record} only. If you are working on ${listed}, open or create a project for that unit and ask there; I'll answer from its manual and show you the page.`;
}

/** The conversation has run further without an answer from a manual than the
 *  route reads back, and the question names no model. */
export function subjectOutOfReachText(): string {
  return "This conversation has gone a long way without an answer from a manual, so I can't tell which machine this question is about and I won't guess. Name the model in your question, or start a new conversation, and I'll answer from its manual.";
}
