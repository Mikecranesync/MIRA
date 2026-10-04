/**
 * The label a citation chip shows for its source.
 *
 * A notebook upload carries its filename as `title`. A chunk with no title used
 * to fall back to "Attached document" — telling a technician they attached a
 * file they never attached (Golden Walk, 2026-10-04: a Yaskawa GA500 answer cited
 * "Attached document p.889" on a notebook with zero sources). Name it by maker and
 * model instead. Deliberately provenance-neutral: a missing title does not prove
 * the chunk is shared manufacturer documentation — a tenant's own titleless
 * private upload reaches here too (Codex #4229 F1) — so the label never claims a
 * source it cannot show.
 */
export function citationTitle(c: { title?: string | null; manufacturer?: string | null; modelNumber?: string | null }): string {
  const title = (c.title ?? "").trim();
  if (title) return title;
  const makerModel = [c.manufacturer, c.modelNumber]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return makerModel ? `${makerModel} manual` : "Manual";
}
