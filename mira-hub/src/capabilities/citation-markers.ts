/**
 * Technician-facing citation-marker hygiene for equipment-notebook answers.
 *
 * The model writes `[n]` (or `【n】`, already normalized elsewhere). A marker
 * is only a citation when `n` matches a shipped source that names a manual
 * and page. Anything else is a bare marker and must not reach Hub or mobile.
 *
 * General mode already strips every `[n]` (no sources). This is the grounded
 * counterpart: keep resolvable markers so the existing chip/card can render
 * manual + page; drop the rest.
 *
 * Does not convert `【n】` → `[n]` — that lives in `answer-shape.ts` /
 * `makeCitationNormalizer` (PR #4303 shares it with NodeChat). Do not
 * duplicate that conversion here.
 */

const COMPLETE_MARK = /([ \t]*)\[(\d+)\]/g;

export function citationIdsOf(citations: readonly { citationId: string }[]): ReadonlySet<string> {
  return new Set(citations.map((c) => c.citationId));
}

/** Drop `[n]` that do not resolve to a known citation id. Keep matching `[n]`
 *  (and the space before them) so the notebook renderers can turn them into
 *  a manual+page citation. */
export function stripUnresolvedCitationMarkers(
  text: string,
  citations: readonly { citationId: string }[],
): string {
  const known = citationIdsOf(citations);
  return text.replace(COMPLETE_MARK, (full, ws: string, n: string) => (known.has(n) ? `${ws}[${n}]` : ""));
}

/**
 * Streaming-safe stripper: same rule as `stripUnresolvedCitationMarkers`, but
 * a trailing `[` / `[12` is held until the next delta (or flush) so a split
 * marker cannot leak as visible text. Matches `makeGeneralBracketStripper`.
 */
export function makeUnresolvedCitationStripper(
  citations: readonly { citationId: string }[],
): { push: (delta: string) => string; flush: () => string } {
  const known = citationIdsOf(citations);
  let pending = "";
  const dropUnknown = (s: string) =>
    s.replace(COMPLETE_MARK, (full, ws: string, n: string) => (known.has(n) ? `${ws}[${n}]` : ""));
  return {
    push(delta: string): string {
      const buf = dropUnknown(pending + delta);
      const partial = buf.match(/[ \t]*\[\d*$|[ \t]+$/);
      if (partial) {
        pending = partial[0];
        return buf.slice(0, buf.length - partial[0].length);
      }
      pending = "";
      return buf;
    },
    flush(): string {
      const rest = pending;
      pending = "";
      return rest;
    },
  };
}
