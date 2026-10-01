/**
 * #4178 — a BLANK notebook adopts the nameplate the technician just confirmed.
 *
 * The nameplate-confirm route never writes a notebook's identity, because a
 * nameplate usually belongs to a COMPONENT (a drive inside a ride) and must not
 * rename the machine. That reasoning only holds when the notebook already names
 * a machine. A blank notebook — no maker, no model, no catalog number, not
 * confirmed, not bound to an asset — has no machine to rename: the photographed
 * nameplate is the best identity it will ever get, and it is exactly how a
 * technician starts on the phone ("new notebook → photo the plate → confirm").
 *
 * Adopting it makes everything already built for a confirmed identity apply:
 * the recorded confirm-time manual search, its server-side recovery after a
 * limit or outage (#4160 S7), and OEM retrieval scoped to that model.
 *
 * The write is ONE conditional statement that also records its provenance: it re-checks blankness in the WHERE, so a
 * concurrent chat turn or edit that gave the notebook an identity first is never
 * overwritten (the caller then falls back to the unrecorded inline search).
 * Only maker, model and catalog number are adopted — never a serial number
 * (ADR-0036: no serial egress, and a serial identifies one unit, not the model).
 */
import { withTenantContext } from "@/lib/tenant-context";

export type NameplateIdentity = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
};

type NotebookShape = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  identityStatus?: string | null;
  asset?: { entityId?: string | null } | null;
};

const filled = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Pre-check (the conditional UPDATE below is the authority): blank, unconfirmed, unbound. */
export function isBlankUnboundNotebook(nb: NotebookShape): boolean {
  if (filled(nb.manufacturer) || filled(nb.model) || filled(nb.catalogNumber)) return false;
  if (nb.identityStatus === "user_confirmed" || nb.identityStatus === "verified") return false;
  return !nb.asset?.entityId;
}

/** A nameplate identity worth adopting: a maker plus a model or catalog number. */
export function isAdoptableIdentity(id: NameplateIdentity): boolean {
  return filled(id.manufacturer) && (filled(id.model) || filled(id.catalogNumber));
}

// ── Provenance lives ON the notebook row (Codex #4191 r2 F1, r3 F1/F3) ──────
// A technician whose search failed may correct the SAME nameplate photo ("Edit
// the details and try again"); the adopted identity must follow, or the
// corrected search runs unrecorded while the chat retries the wrong model.
//
// Earlier rounds stamped provenance on the nameplate's source row. That row is
// replaced by byte-dedup re-confirms, reordered by document reuse, and written
// in a second statement — three ways to lose it. The provenance now rides in the
// SAME single UPDATE as the identity, on the notebook itself:
//
//   identity_source_ref = 'nameplate:<photo file id>:<md5 of maker|model|catalog>'
//
// (`identity_source_ref` is migration 073's slot for exactly this — which
// observation the identity came from; nothing else writes it.) The fingerprint
// is computed by Postgres from the values it writes, so a later manual edit of
// maker/model/catalog (PATCH never touches the ref) breaks the match and the
// photo can no longer move the identity. One statement: nothing to half-write,
// nothing to reorder, nothing for a source upsert to erase.

const FINGERPRINT_COLS = `md5(concat_ws('|', COALESCE(NULLIF(btrim(manufacturer), ''), ''),
                                         COALESCE(NULLIF(btrim(model), ''), ''),
                                         COALESCE(NULLIF(btrim(catalog_number), ''), '')))`;
const FINGERPRINT_NEW = `md5(concat_ws('|', COALESCE($3::text, ''), COALESCE($4::text, ''), COALESCE($5::text, '')))`;

const toIdentity = (id: NameplateIdentity): Required<NameplateIdentity> => ({
  manufacturer: filled(id.manufacturer) ? id.manufacturer.trim() : null,
  model: filled(id.model) ? id.model.trim() : null,
  catalogNumber: filled(id.catalogNumber) ? id.catalogNumber.trim() : null,
});

/** Pre-check only (the UPDATE is the authority): could this notebook's identity
 *  have come from a nameplate photo, and is it still unbound? */
export function mayBeNameplateAdopted(nb: NotebookShape & { identitySourceType?: string | null }): boolean {
  return nb.identityStatus === "user_confirmed" && nb.identitySourceType === "nameplate_image" && !nb.asset?.entityId;
}

/** Adopt the confirmed nameplate as the notebook's identity, in ONE statement,
 *  when EITHER the notebook is still blank and unbound, OR its identity was
 *  adopted from THIS photo and has not been edited or bound since (a correction).
 *  Returns false when neither holds (a lost race, another photo, a manual edit). */
export async function adoptNameplateIdentity(
  tenantId: string,
  notebookId: string,
  originFileId: string,
  id: NameplateIdentity,
): Promise<boolean> {
  if (!isAdoptableIdentity(id) || !filled(originFileId)) return false;
  const next = toIdentity(id);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebooks
          SET manufacturer = $3, model = $4, catalog_number = $5,
              identity_status = 'user_confirmed', identity_source_type = 'nameplate_image',
              identity_source_ref = 'nameplate:' || $6::text || ':' || ${FINGERPRINT_NEW},
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid
          AND equipment_entity_id IS NULL
          AND (
            ( COALESCE(btrim(manufacturer), '') = ''
              AND COALESCE(btrim(model), '') = ''
              AND COALESCE(btrim(catalog_number), '') = ''
              AND identity_status IN ('unknown', 'candidate') )
            OR
            ( identity_status = 'user_confirmed'
              AND identity_source_type = 'nameplate_image'
              AND identity_source_ref = 'nameplate:' || $6::text || ':' || ${FINGERPRINT_COLS} )
          )`,
      [tenantId, notebookId, next.manufacturer, next.model, next.catalogNumber, originFileId],
    );
    return (res.rowCount ?? 0) > 0;
  });
}
