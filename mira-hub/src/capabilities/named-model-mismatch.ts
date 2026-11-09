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
 * genuine comparison / connection ("SMC-50 vs SMC Flex", "wire a Micro820 to a
 * GS10") or an ambiguous request ("my SMC-50 or SMC Flex just faulted, what is
 * code 10?"). A comparison keeps today's behaviour: no model filter, every
 * manual citable under its own title. Only SIBLINGS of one product family
 * (same identity prefix: SMC, PF, MICRO, ACS, GS…) asked with no comparison
 * cue are ambiguous, because their fault codes and parameters differ while
 * the question reads as one machine. Different families (Micro820 + GS10) are
 * a multi-device question, never ambiguous here. Pure, no LLM.
 */
const COMPARISON_CUE_RE =
  /\b(?:vs\.?|versus|compar\w*|differen\w*|differ|between|both|same\s+as|similar|unlike|instead\s+of|replac\w*|upgrad\w*|migrat\w*|swap\w*|convert\w*|to\s+an?|with\s+an?|from\s+an?)\b/i;

/** The family prefix of an identity ("SMC50" → "SMC", "PF4M" → "PF"); null for
 *  identities without a letter prefix (catalog numbers). */
const familyOf = (id: string): string | null => /^([A-Z]+)\d|^([A-Z]+)FLEX$/.exec(id)?.slice(1).find(Boolean) ?? null;

export function ambiguousSiblingModels(question: string, identities: Iterable<string>): string[] | null {
  if (COMPARISON_CUE_RE.test(question)) return null;
  const byFamily = new Map<string, string[]>();
  for (const id of identities) {
    const family = familyOf(id);
    if (!family) continue;
    byFamily.set(family, [...(byFamily.get(family) ?? []), id]);
  }
  for (const ids of byFamily.values()) if (ids.length >= 2) return [...ids].sort();
  return null;
}

export function ambiguousModelAskText(ids: string[]): string {
  const names = ids.map(displayModelIdentity);
  const listed = names.length === 2 ? `${names[0]} or the ${names[1]}` : `${names.slice(0, -1).join(", ")} or the ${names[names.length - 1]}`;
  return `You mentioned the ${names.join(" and the ")}. They are different models with different fault codes and settings, so I won't guess which one you mean. Which one is it — the ${listed}? Ask again naming just that one and I'll answer from its manual.`;
}
