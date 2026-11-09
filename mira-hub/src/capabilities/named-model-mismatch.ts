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
export type NamedModelMismatch = { requested: string[]; declared: string[] };

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
  return `The manual in this notebook is for the ${have}, not the ${asked} you asked about, so I won't answer from it — its values may not apply to the ${asked}. Add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
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
 *   "either", "not sure", "I think") always asks, whatever else the sentence
 *   says (Codex r4 F6: no comparison word exempts an explicit alternative);
 * - nothing or a bare "," asks, unless the clause opens with a comparison that
 *   names the list ("Compare the SMC-50, SMC Flex fault codes");
 * - the pair is answered only when the words between them end in a joining
 *   word ("and", "vs", "versus", "with", "than", "as", "to", "from",
 *   "between"): today's path, where every manual is cited under its own title;
 * - anything else asks.
 * Different families are never ambiguous here. Pure, no LLM.
 */
const CLAUSE_BREAK_RE = /[.?!;:]/;
const DOUBT_GAP_RE = /\bor\b|\/|\b(?:maybe|possibly|perhaps|probably|either|not\s+sure|i\s+think)\b/i;
const JOINED_GAP_RE = /\b(?:and|vs|versus|with|than|as|to|from|between)\s+(?:(?:the|my|a|an)\s+)?$/i;
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
  for (let i = 1; i < mentions.length; i++) {
    const [a, b] = [mentions[i - 1], mentions[i]];
    const family = familyOf(a.id);
    if (!family || family !== familyOf(b.id) || a.id === b.id || b.start < a.end) continue;
    const gap = question.slice(a.end, b.start);
    if (CLAUSE_BREAK_RE.test(gap)) continue;
    if (DOUBT_GAP_RE.test(gap)) return [a.id, b.id].sort();
    if (LIST_GAP_RE.test(gap)) {
      if (LIST_COMPARISON_RE.test(clauseBefore(question, a.start))) continue;
      return [a.id, b.id].sort();
    }
    if (JOINED_GAP_RE.test(gap)) continue;
    return [a.id, b.id].sort();
  }
  return null;
}

export function ambiguousModelAskText(ids: string[]): string {
  const names = ids.map(displayModelIdentity);
  const listed = names.length === 2 ? `${names[0]} or the ${names[1]}` : `${names.slice(0, -1).join(", ")} or the ${names[names.length - 1]}`;
  return `You mentioned the ${names.join(" and the ")}. They are different models with different fault codes and settings, so I won't guess which one you mean. Which one is it — the ${listed}? Ask again naming just that one and I'll answer from its manual.`;
}
