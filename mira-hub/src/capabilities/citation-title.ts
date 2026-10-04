/**
 * The label a citation chip shows for its source.
 *
 * A notebook upload carries its filename as `title`. A shared OEM-library chunk
 * (`knowledge_entries`, `is_private = false`) carries no title, and the chat route
 * used to fall back to "Attached document" — telling a technician they attached a
 * file they never attached (Golden Walk, 2026-10-04: a Yaskawa GA500 answer cited
 * "Attached document p.889" on a notebook with zero sources). Name the library
 * manual by maker and model instead, the same label `chunksToSources` renders.
 */
export function citationTitle(c: { title?: string | null; manufacturer?: string | null; modelNumber?: string | null }): string {
  const title = (c.title ?? "").trim();
  if (title) return title;
  const makerModel = [c.manufacturer, c.modelNumber]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return makerModel ? `${makerModel} (manufacturer library)` : "Manufacturer library manual";
}
