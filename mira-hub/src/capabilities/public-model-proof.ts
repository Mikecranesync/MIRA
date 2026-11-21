import type { PoolClient } from "pg";

/**
 * #5268 owner decision 2026-11-07 (option A): on a plate that shows a serial
 * or asset label, a code may be offered for a web search only when it is
 * proven public — printed in that maker's own manuals in the shared OEM
 * library. A private value (an asset tag, a serial) is never in a maker's
 * manual, so this check needs no reading of how the plate words its labels.
 *
 * Returns the matching document's series (its `model_number`, e.g. "GS10"
 * for "GS11N-20P2"), "" when the row carries none, or null when the code is
 * not proven public. Shared corpus only (`is_private = false`, raw pool).
 * Fails closed: any query error is null.
 */
export async function publicManualSeries(client: PoolClient, manufacturer: string, code: string): Promise<string | null> {
  const maker = manufacturer.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (maker.length < 3 || !/[A-Za-z]/.test(code) || !/\d/.test(code) || code.replace(/[^A-Za-z0-9]/g, "").length < 4) return null;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const { rows } = await client.query<{ model_number: string | null }>(
      `SELECT model_number
         FROM knowledge_entries
        WHERE is_private = false
          AND lower(regexp_replace(manufacturer, '[^A-Za-z0-9]', '', 'g')) = $1
          AND content ~* $2
        LIMIT 1`,
      [maker, `(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`],
    );
    return rows.length > 0 ? (rows[0].model_number ?? "").trim() : null;
  } catch (err) {
    console.error("[public-model-proof] lookup failed (not proven):", err instanceof Error ? err.message : err);
    return null;
  }
}
