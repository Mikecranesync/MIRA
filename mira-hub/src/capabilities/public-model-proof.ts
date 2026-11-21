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
 * not proven public. Shared maker-manual corpus only (`is_private = false`,
 * `PUBLIC_MANUAL_SOURCE_TYPES`, raw pool).
 * Fails closed: any query error is null.
 */
/**
 * Codex #5706 r5 F13: only maker MANUAL documents prove a code public. Seeded
 * asset records, equipment photos, work-order history, transcripts and
 * curricula are shared rows too, but a code in them is not the maker printing
 * it — a photo row could even carry another site's plate.
 */
export const PUBLIC_MANUAL_SOURCE_TYPES = ["equipment_manual", "manual", "installation_manual", "oem_manual", "gdrive"] as const;

/**
 * The separators that join an identifier's parts — the applicability
 * matcher's own set (`ID_SEP` in manual-applicability.ts), with PDF en dashes
 * and non-breaking hyphens written as literal characters for Postgres.
 * Codex #5706 r6 F13: "GS11N-20P2\u2013EX" never proves GS11N-20P2.
 */
const PROOF_SEP = "[-._/\u2010-\u2015]";

export async function publicManualSeries(client: PoolClient, manufacturer: string, code: string): Promise<string | null> {
  const maker = manufacturer.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (maker.length < 3 || !/[A-Za-z]/.test(code) || !/\d/.test(code) || code.replace(/[^A-Za-z0-9]/g, "").length < 4) return null;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const { rows } = await client.query<{ model_number: string | null }>(
      `SELECT model_number
         FROM knowledge_entries
        WHERE is_private = false
          AND source_type = ANY ($3::text[])
          -- Owner decision 2026-11-20 (Codex #5706 r6 F13): a Drive import counts
          -- only when it is a PDF, never an imported text, Markdown or HTML note.
          AND (source_type <> 'gdrive' OR source_url ~* '[.]pdf$')
          AND lower(regexp_replace(manufacturer, '[^A-Za-z0-9]', '', 'g')) = $1
          AND content ~* $2
        LIMIT 1`,
      // The whole identifier: a separator followed by a letter or digit
      // continues it on either side ("GS11N-20P2-EX", "1.GS11N-20P2.A1" never
      // prove GS11N-20P2) — Codex #5706 r5 F13.
      [maker, `(^|[^A-Za-z0-9])(?<![A-Za-z0-9]${PROOF_SEP})${escaped}(?!${PROOF_SEP}?[A-Za-z0-9])`, [...PUBLIC_MANUAL_SOURCE_TYPES]],
    );
    return rows.length > 0 ? (rows[0].model_number ?? "").trim() : null;
  } catch (err) {
    console.error("[public-model-proof] lookup failed (not proven):", err instanceof Error ? err.message : err);
    return null;
  }
}
