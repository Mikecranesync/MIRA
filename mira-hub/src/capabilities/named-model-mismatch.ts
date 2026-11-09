import { modelMentionsInText } from "./model-token";

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
 * mentions of one product family (same identity prefix: SMC, PF, MICRO…):
 * nothing, "or", "/" or "," (optionally in an opening parenthesis, optionally
 * followed by the/my/a/an) is one
 * machine named two ways; ANY other word between them ("and", "vs", "with",
 * "communicating with", "between") keeps today's path, where every manual is
 * cited under its own title. Different families are never ambiguous here.
 * Pure, no LLM.
 */
const ALTERNATIVE_GAP_RE = /^\s*\(?\s*(?:or\b|\/|,)?\s*(?:(?:the|my|a|an)\s+)?$/i;
// Codex r3 F1: a comparison word that GOVERNS the listed models — earlier in
// the same clause as the first of the pair ("Compare the SMC-50, SMC Flex
// fault codes", "difference between Micro820, Micro850") — makes even a
// comma-listed pair a comparison. A clause ends at . ? ! ; or :, so a
// comparison word in another sentence never applies.
const GOVERNING_COMPARISON_RE = /\b(?:compar\w*|differen\w*|between|vs\.?|versus|contrast\w*)\s/i;
const clauseBefore = (text: string, at: number) => text.slice(0, at).split(/[.?!;:]/).pop() ?? "";

/** The family prefix of an identity ("SMC50" → "SMC", "PF4M" → "PF"); null for
 *  identities without a letter prefix (catalog numbers). */
const familyOf = (id: string): string | null => /^([A-Z]+)\d|^([A-Z]+)FLEX$/.exec(id)?.slice(1).find(Boolean) ?? null;

export function ambiguousSiblingModels(question: string): string[] | null {
  const mentions = modelMentionsInText(question);
  for (let i = 1; i < mentions.length; i++) {
    const [a, b] = [mentions[i - 1], mentions[i]];
    const family = familyOf(a.id);
    if (!family || family !== familyOf(b.id) || a.id === b.id || b.start < a.end) continue;
    if (!ALTERNATIVE_GAP_RE.test(question.slice(a.end, b.start))) continue;
    if (GOVERNING_COMPARISON_RE.test(clauseBefore(question, a.start))) continue;
    return [a.id, b.id].sort();
  }
  return null;
}

export function ambiguousModelAskText(ids: string[]): string {
  const names = ids.map(displayModelIdentity);
  const listed = names.length === 2 ? `${names[0]} or the ${names[1]}` : `${names.slice(0, -1).join(", ")} or the ${names[names.length - 1]}`;
  return `You mentioned the ${names.join(" and the ")}. They are different models with different fault codes and settings, so I won't guess which one you mean. Which one is it — the ${listed}? Ask again naming just that one and I'll answer from its manual.`;
}
