// Which machine do this notebook's manuals have to be for?
//
// A notebook gets its machine one of two ways:
//  - nameplate-first: a person confirms a maker and model on the notebook;
//  - machine-first: the notebook is made from a registered machine, and a
//    person confirms that machine. The maker and model then live on the
//    machine's own record, not on the notebook.
// Until 2026-11-10 only the first reached the wrong-manual check, so a
// notebook made from a registered controller answered from a relay's data
// sheet. This is the one place both are turned into the identity every manual
// read of the turn uses.
//
// It is used ONLY for the manual check. It is never written back to the
// notebook and never shown as the notebook's identity.
import type { IdentityStatus } from "@/lib/equipment-notebooks";

export type ManualIdentity = {
  identity: { manufacturer: string | null; model: string | null };
  catalogNumber: string | null;
  identityStatus: IdentityStatus | null;
};

type NotebookIdentityFields = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  identityStatus?: IdentityStatus | null;
} | null | undefined;

type BoundMachine =
  | { state: "unbound" }
  | { state: "unresolvable" }
  | {
      state: "resolved";
      confirmedAt: string | null;
      manufacturer?: string | null;
      model?: string | null;
      /** The register's full designation (cmms_equipment.manufacturer_part_number), when it holds one. */
      catalogNumber?: string | null;
    };

const confirmed = (status: IdentityStatus | null | undefined) => status === "user_confirmed" || status === "verified";
const text = (value: string | null | undefined) => value?.trim() || null;

/**
 * The notebook's own confirmed identity wins. Otherwise a CONFIRMED bound
 * machine that has a model or a catalog number on record supplies them (the
 * same predicate the notebook's own identity uses). Otherwise the notebook's
 * own fields are passed through unchanged, exactly as before (an unconfirmed
 * identity scopes nothing downstream).
 *
 * Garage pilot M4: until 2026-11-12 the bound branch hard-coded
 * `catalogNumber: null`, so a project made from a registered drive whose
 * record holds "GS11N-20P2" ran the wrong-manual check and the sibling-table
 * exclusion on the family ("GS11N") only, and asked for a number it had.
 *
 * `disputed`: the technician's device says it is at a different machine than
 * the one this notebook is bound to, so the binding is not used this turn.
 */
export function notebookManualIdentity(nb: NotebookIdentityFields, bound: BoundMachine, disputed = false): ManualIdentity {
  const own: ManualIdentity = {
    identity: { manufacturer: nb?.manufacturer ?? null, model: nb?.model ?? null },
    catalogNumber: nb?.catalogNumber ?? null,
    identityStatus: nb?.identityStatus ?? null,
  };
  if (confirmed(own.identityStatus) && (text(own.identity.model) || text(own.catalogNumber))) return own;
  if (!disputed && bound.state === "resolved" && bound.confirmedAt && (text(bound.model) || text(bound.catalogNumber))) {
    return {
      identity: { manufacturer: text(bound.manufacturer), model: text(bound.model) },
      catalogNumber: text(bound.catalogNumber),
      identityStatus: "user_confirmed",
    };
  }
  return own;
}
