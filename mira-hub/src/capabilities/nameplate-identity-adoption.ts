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
 * The write is CONDITIONAL and atomic (with its provenance — adoptNameplateIdentity): it re-checks blankness in the WHERE, so a
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

// ── Codex #4191 r2 F1: identity and provenance commit TOGETHER ───────────────
// The notebook UPDATE and the provenance stamp run in ONE transaction. A stamp
// that fails (or finds no source row) rolls the adoption back, so an identity
// is never adopted without the provenance a later correction needs. The caller
// sees a thrown error and reports it; nothing is half-written.
//
// Provenance is read from EVERY reading of the photo, superseded ones included
// (findAdoptedIdentityForPhoto). An edited re-confirm supersedes the stamped
// reading before it re-adopts; if that re-adoption then fails, the retry still
// finds the stamp on the superseded row and recognises the correction. Each
// stamp is written in the same transaction as its adoption, so the newest stamp
// is the identity this photo last gave the notebook.

export type AdoptionRequest =
  | { kind: "blank"; identity: NameplateIdentity }
  | { kind: "correction"; previous: NameplateIdentity; identity: NameplateIdentity };

export class AdoptionProvenanceError extends Error {}

/** Atomically adopt (blank notebook) or re-adopt (correction of the adopting
 *  photo) and stamp the provenance on `nameplateDocId`'s source row. Returns
 *  false when the conditional write lost (the notebook changed meanwhile);
 *  throws — with nothing committed — when the provenance cannot be recorded. */
export async function adoptNameplateIdentity(
  tenantId: string,
  notebookId: string,
  nameplateDocId: string,
  req: AdoptionRequest,
): Promise<boolean> {
  if (!isAdoptableIdentity(req.identity)) return false;
  const next = toIdentity(req.identity);
  return withTenantContext(tenantId, async (c) => {
    const res =
      req.kind === "blank"
        ? await c.query(
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
            [tenantId, notebookId, next.manufacturer, next.model, next.catalogNumber],
          )
        : await (() => {
            const prev = toIdentity(req.previous);
            return c.query(
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
          })();
    if ((res.rowCount ?? 0) === 0) return false;
    const stamp = await c.query(
      `UPDATE equipment_notebook_sources
          SET match_evidence = COALESCE(match_evidence, '{}'::jsonb) || jsonb_build_object('adopted_identity', $4::jsonb)
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
      [tenantId, notebookId, nameplateDocId, JSON.stringify(next)],
    );
    if ((stamp.rowCount ?? 0) === 0) {
      // Throwing rolls the identity UPDATE back with it (one transaction).
      throw new AdoptionProvenanceError(`no nameplate source row ${nameplateDocId} to stamp`);
    }
    return true;
  });
}

/** The identity this photo most recently gave the notebook, read across ALL of
 *  its readings (superseded included), or null when it never adopted one. */
export async function findAdoptedIdentityForPhoto(
  tenantId: string,
  notebookId: string,
  originFileId: string,
): Promise<NameplateIdentity | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT match_evidence
         FROM equipment_notebook_sources
        WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
          AND origin_file_id = $3::uuid
          AND match_evidence ? 'adopted_identity'
        ORDER BY created_at DESC, doc_id DESC
        LIMIT 1`,
      [tenantId, notebookId, originFileId],
    );
    return adoptedIdentityFromEvidence(res.rows?.[0]?.match_evidence);
  });
}
