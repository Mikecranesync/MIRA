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

/**
 * #5369 — a look-alike model the detector has no pattern for. maq2-2026-11-09
 * on 6e5361bff: two sibling controllers of a vendor family missing from
 * MODEL_PATTERNS were each answered from the other's manual, because the
 * question read as "no model named" and the named-ask filter never ran. One
 * more pattern per vendor would repeat the #5359 loop, so this check is
 * generic, and relational on purpose: a letters+digits token counts as a
 * model ONLY when the manual's own title declares a near-sibling of it (same
 * letters, same number of digits, same first digit, different number). A
 * parameter or fault code (A093, F005) never matches a title token, so it can
 * never refuse a manual. A question that also names the title's own model
 * (a comparison, or "M171 or M172?") is left to the existing paths.
 * Applicability only — never a retrieval-scoping token. Pure, no LLM.
 */
const LOOK_ALIKE_TOKEN_RE = /\b([a-z]{1,3})-?(\d{3,4})\b/gi;

function lookAlikeTokens(text: string): { id: string; letters: string; digits: string }[] {
  return [...text.matchAll(LOOK_ALIKE_TOKEN_RE)].map((m) => ({
    id: `${m[1]}${m[2]}`.toUpperCase(),
    letters: m[1].toUpperCase(),
    digits: m[2],
  }));
}

export function lookAlikeModelMismatch(question: string, title: string): NamedModelMismatch | null {
  const declared = lookAlikeTokens(title);
  if (declared.length === 0) return null;
  const asked = lookAlikeTokens(question);
  const declaredIds = new Set(declared.map((t) => t.id));
  if (asked.some((t) => declaredIds.has(t.id))) return null;
  const requested = asked.filter((q) =>
    declared.some((t) => t.letters === q.letters && t.digits.length === q.digits.length && t.digits[0] === q.digits[0]),
  );
  if (requested.length === 0) return null;
  return { requested: [...new Set(requested.map((t) => t.id))], declared: [...declaredIds] };
}
