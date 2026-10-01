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
 * The write is CONDITIONAL and atomic: it re-checks blankness in the WHERE, so a
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

/** Atomically adopt the nameplate identity iff the notebook is still blank and
 *  unbound. Returns true only when the row was actually written. */
export async function adoptNameplateIdentityIfBlank(
  tenantId: string,
  notebookId: string,
  id: NameplateIdentity,
): Promise<boolean> {
  if (!isAdoptableIdentity(id)) return false;
  const clean = (v: string | null | undefined) => (filled(v) ? v.trim() : null);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebooks
          SET manufacturer = $3, model = $4, catalog_number = $5,
              identity_status = 'user_confirmed', identity_source_type = 'nameplate_image',
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid
          AND COALESCE(btrim(manufacturer), '') = ''
          AND COALESCE(btrim(model), '') = ''
          AND COALESCE(btrim(catalog_number), '') = ''
          AND identity_status IN ('unknown', 'candidate')
          AND equipment_entity_id IS NULL`,
      [tenantId, notebookId, clean(id.manufacturer), clean(id.model), clean(id.catalogNumber)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

// ── Codex #4191 F1: corrections of the adopting photo ─────────────────────────
// A technician whose search failed may correct the SAME nameplate photo ("Edit
// the details and try again"). The adopted identity must follow the correction,
// or the corrected search runs unrecorded while the chat keeps retrying the
// wrong model. Provenance makes this safe without a schema change: on adoption
// the nameplate source row is stamped with `adopted_identity`; a later confirm
// of that photo re-adopts only when the notebook still holds exactly that
// identity (no manual edit since), still came from a nameplate, and is still
// unbound — re-checked atomically in the UPDATE.

const sameIdentity = (a: NameplateIdentity, b: NameplateIdentity) =>
  (a.manufacturer ?? "").trim() === (b.manufacturer ?? "").trim() &&
  (a.model ?? "").trim() === (b.model ?? "").trim() &&
  (a.catalogNumber ?? "").trim() === (b.catalogNumber ?? "").trim();

const toIdentity = (id: NameplateIdentity): Required<NameplateIdentity> => ({
  manufacturer: filled(id.manufacturer) ? id.manufacturer.trim() : null,
  model: filled(id.model) ? id.model.trim() : null,
  catalogNumber: filled(id.catalogNumber) ? id.catalogNumber.trim() : null,
});

/** The identity this photo's earlier confirm adopted, if its source row was stamped. */
export function adoptedIdentityFromEvidence(matchEvidence: unknown): NameplateIdentity | null {
  if (!matchEvidence || typeof matchEvidence !== "object") return null;
  const a = (matchEvidence as { adopted_identity?: unknown }).adopted_identity;
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return { manufacturer: str(r.manufacturer), model: str(r.model), catalogNumber: str(r.catalogNumber) };
}

/** Pre-check (the conditional UPDATE is the authority): this notebook's identity
 *  was adopted from this photo and nothing has changed it since. */
export function isCorrectionOfAdoptedNameplate(
  nb: NotebookShape & { identitySourceType?: string | null },
  priorAdopted: NameplateIdentity | null,
): boolean {
  if (!priorAdopted || nb.asset?.entityId) return false;
  if (nb.identityStatus !== "user_confirmed" || nb.identitySourceType !== "nameplate_image") return false;
  return sameIdentity(nb, priorAdopted);
}

/** Atomically move an adopted identity to the corrected nameplate. */
export async function readoptCorrectedNameplate(
  tenantId: string,
  notebookId: string,
  previous: NameplateIdentity,
  corrected: NameplateIdentity,
): Promise<boolean> {
  if (!isAdoptableIdentity(corrected)) return false;
  const next = toIdentity(corrected);
  const prev = toIdentity(previous);
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE equipment_notebooks
          SET manufacturer = $3, model = $4, catalog_number = $5, updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid
          AND identity_source_type = 'nameplate_image'
          AND identity_status = 'user_confirmed'
          AND NULLIF(btrim(manufacturer), '') IS NOT DISTINCT FROM $6
          AND NULLIF(btrim(model), '') IS NOT DISTINCT FROM $7
          AND NULLIF(btrim(catalog_number), '') IS NOT DISTINCT FROM $8
          AND equipment_entity_id IS NULL`,
      [tenantId, notebookId, next.manufacturer, next.model, next.catalogNumber, prev.manufacturer, prev.model, prev.catalogNumber],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/** Stamp the adopted identity on the nameplate source row it came from. Best
 *  effort: a missing stamp only means a later correction is not recognised. */
export async function stampAdoptionProvenance(
  tenantId: string,
  notebookId: string,
  nameplateDocId: string,
  id: NameplateIdentity,
): Promise<void> {
  await withTenantContext(tenantId, async (c) => {
    await c.query(
      `UPDATE equipment_notebook_sources
          SET match_evidence = COALESCE(match_evidence, '{}'::jsonb) || jsonb_build_object('adopted_identity', $4::jsonb)
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
      [tenantId, notebookId, nameplateDocId, JSON.stringify(toIdentity(id))],
    );
  });
}
