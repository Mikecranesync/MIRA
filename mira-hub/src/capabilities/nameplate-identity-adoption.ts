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
