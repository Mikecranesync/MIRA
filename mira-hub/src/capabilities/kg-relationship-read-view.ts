/**
 * Read view over `kg_relationships` that reconciles the two relationship vocabularies (#5519).
 *
 * Writers propose under legacy lowercase names (`feeds`, `caused_by`, `parent_of`…). Approval
 * stores the CANONICAL name, sometimes with the endpoints swapped (`caused_by` A→B is stored as
 * `CAUSES` B→A). Readers were written against the legacy names, so an approved edge was invisible.
 *
 * This module builds one SQL sub-select that readers use in place of the bare table. It yields
 * the same columns, and for every canonical row that has a legacy meaning it yields that row
 * under the legacy name, in the legacy direction. The mapping is the writer's own
 * (`proposals-writer.ts`); nothing is duplicated here.
 *
 * - No double counting: a legacy-alias row is suppressed when a verified row already exists
 *   for the same tenant, endpoints and legacy name.
 * - Tenant, endpoint and approval predicates stay with the caller, exactly as before; the view
 *   exposes `tenant_id` and `approval_state` unchanged.
 * - `keepCanonical: true` also yields the stored rows under their stored names (for callers
 *   that pass relationship names in). `false` yields each mapped canonical edge ONLY under its
 *   legacy name, plus every row that has no legacy meaning — one row per meaning, no repeats.
 * - Superseded facts are not current (#5523): a row whose originating proposal has been moved
 *   to `deprecated` (the supersede transition) is left out of BOTH forms. The row itself is not
 *   changed here — history stays in the tables; this is the read-side guard, and it holds
 *   whether or not the row's own approval_state is later demoted too.
 * - The names interpolated below come only from the compiled mapping and are checked to be
 *   plain identifiers; no request data reaches this string.
 */
import { legacyAliasesOfCanonicalEdges } from "@/lib/knowledge-graph/proposals-writer";

const SAFE_NAME = /^[A-Za-z_]+$/;
const COLUMNS = "id, tenant_id, relationship_type, source_id, target_id, approval_state, confidence, properties, created_at";

function aliasValues(): string {
  const rows = legacyAliasesOfCanonicalEdges();
  for (const { canonical, legacy } of rows) {
    if (!SAFE_NAME.test(canonical) || !SAFE_NAME.test(legacy)) {
      throw new Error(`kg-relationship-read-view: unsafe relationship name in mapping: ${canonical}/${legacy}`);
    }
  }
  return rows.map(({ canonical, legacy, flip }) => `('${canonical}', '${legacy}', ${flip ? "true" : "false"})`).join(", ");
}

/** True for a row whose originating proposal was superseded. `alias` is the row's table alias. */
function superseded(alias: string): string {
  return `EXISTS (SELECT 1 FROM relationship_proposals sp
                   WHERE sp.id = ${alias}.relationship_proposal_id AND sp.status = 'deprecated')`;
}

export function kgRelationshipsReadView(opts: { keepCanonical: boolean }): string {
  const values = aliasValues();
  const stored = opts.keepCanonical
    ? `SELECT ${COLUMNS} FROM kg_relationships k0 WHERE NOT ${superseded("k0")}`
    : `SELECT ${COLUMNS} FROM kg_relationships k0
        WHERE NOT EXISTS (SELECT 1 FROM (VALUES ${values}) AS m0(canonical, legacy, flip)
                           WHERE m0.canonical = k0.relationship_type)
          AND NOT ${superseded("k0")}`;
  return `(
    ${stored}
    UNION ALL
    SELECT k.id, k.tenant_id, m.legacy AS relationship_type,
           CASE WHEN m.flip THEN k.target_id ELSE k.source_id END AS source_id,
           CASE WHEN m.flip THEN k.source_id ELSE k.target_id END AS target_id,
           k.approval_state, k.confidence, k.properties, k.created_at
      FROM kg_relationships k
      JOIN (VALUES ${values}) AS m(canonical, legacy, flip) ON m.canonical = k.relationship_type
     WHERE NOT ${superseded("k")}
       AND NOT EXISTS (
             SELECT 1 FROM kg_relationships d
              WHERE d.tenant_id = k.tenant_id
                AND d.relationship_type = m.legacy
                AND d.approval_state = 'verified'
                AND NOT ${superseded("d")}
                AND d.source_id = CASE WHEN m.flip THEN k.target_id ELSE k.source_id END
                AND d.target_id = CASE WHEN m.flip THEN k.source_id ELSE k.target_id END)
  )`;
}

/** Legacy-normalised rows only: each meaning once. For readers with fixed legacy names. */
export const KG_EDGES_LEGACY = kgRelationshipsReadView({ keepCanonical: false });
/** Stored rows plus their legacy aliases. For readers whose caller supplies the names. */
export const KG_EDGES_BOTH = kgRelationshipsReadView({ keepCanonical: true });
