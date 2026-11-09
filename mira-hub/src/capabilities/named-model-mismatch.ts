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
  const pf = /^PF(\d+)$/.exec(id);
  if (pf) return `PowerFlex ${pf[1]}`;
  return id;
}

const list = (ids: string[]) => ids.map(displayModelIdentity).join(" / ");

export function namedModelMismatchText(m: NamedModelMismatch): string {
  const asked = list(m.requested);
  const have = list(m.declared);
  return `The manual in this notebook is for the ${have}, not the ${asked} you asked about, so I won't answer from it — its values may not apply to the ${asked}. Add the ${asked} manual (or the page that covers it) to this notebook and ask again.`;
}
