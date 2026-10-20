/**
 * Manual harvester — "which manuals does this technician need?", read from
 * their own history. PROPOSE-ONLY: this module never writes and never fetches.
 * A proposal becomes a manual only when the technician taps OK and the route
 * hands it to the existing startManualAcquisition — no second pipeline.
 *
 * Inputs (all per tenant):
 *   - equipment_notebooks whose identity qualifies for the acquisition pipeline
 *     (acquisitionKey: user_confirmed + manufacturer + model-or-catalog).
 *   - equipment_notebook_sources, judged by the EXISTING applicability contract
 *     (applicableEnabledSource): only an enabled, trusted manual stamped for the
 *     CURRENT identity counts. A disabled leftover from a prior identity does not.
 *   - decision_traces closed turns MIRA could not answer (outcome refused |
 *     abstained — the Hub never writes 'kb_gap'; turn-lifecycle.ts TurnOutcome).
 *   - equipment_notebooks.manual_acquisition: a search already recorded for the
 *     current key makes the identity "searched" (status shown, not approvable).
 *   - knowledge_entries: flags "the shared library already has this model".
 *
 * Pool discipline: the tenant reads (notebooks, sources, traces) run on ONE
 * withTenantContext client and finish before the hybrid knowledge_entries read
 * runs on the raw pool — never two pool connections held at once (Codex #4542 F4).
 * The hybrid read uses (is_private = false OR tenant_id = $1)
 * (.claude/rules/knowledge-entries-tenant-scoping.md).
 */
import { acquisitionKey, applicableEnabledSource } from "@/capabilities/notebook-manual-acquisition";
import type { NotebookSource } from "@/lib/equipment-notebooks";

export type QueryDb = {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type HarvestNotebook = {
  notebookId: string;
  manufacturer: string;
  model: string;
  catalogNumber: string | null;
  identityStatus: string;
  lastSeenMs: number;
  hasManual: boolean;
  refusedTurns: number;
  /** Outcome of a search already recorded for THIS identity, or null if never searched. */
  lastSearch?: string | null;
};

export type ManualProposal = {
  manufacturer: string;
  model: string;
  catalogNumber: string | null;
  notebookIds: string[];
  refusedTurns: number;
  lastSeenAt: string;
  alreadyInLibrary: boolean;
  /** Recorded outcome for this identity (e.g. no_manual_found), or null. */
  lastSearch: string | null;
};

export type HarvestResult = {
  /** Never searched for the current identity — the one-tap OK can start these. */
  proposals: ManualProposal[];
  /** Already searched — shown with the outcome; approval would not start a new search. */
  searched: ManualProposal[];
};

/** Conservative display grouping key: trim, case-fold, collapse whitespace. */
export function normalizeIdentityPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function libKey(manufacturer: string, model: string): string {
  return `${normalizeIdentityPart(manufacturer)}\u0000${normalizeIdentityPart(model)}`;
}

function keyOfNotebook(n: HarvestNotebook): string | null {
  return acquisitionKey({
    identityStatus: n.identityStatus,
    manufacturer: n.manufacturer,
    model: n.model,
    catalogNumber: n.catalogNumber,
  });
}

/** Pure: filter, group by acquisition key, rank, split by actionability. Deterministic. */
export function rankManualProposals(
  notebooks: HarvestNotebook[],
  libraryKeys: ReadonlySet<string> = new Set(),
): HarvestResult {
  const groups = new Map<string, HarvestNotebook[]>();
  for (const n of notebooks) {
    // Eligibility is EXACTLY what approval can act on: the pipeline's own key.
    const k0 = keyOfNotebook(n);
    if (!k0 || n.hasManual) continue;
    // Actionability is per NOTEBOOK (Codex #4542 F6): a search recorded on one
    // notebook must not hide another unsearched notebook of the same identity.
    const k = `${k0}\u0000${n.lastSearch ? "searched" : "open"}`;
    const g = groups.get(k);
    if (g) g.push(n);
    else groups.set(k, [n]);
  }

  const all: (ManualProposal & { _last: number })[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => a.notebookId.localeCompare(b.notebookId));
    const last = Math.max(...sorted.map((m) => m.lastSeenMs));
    all.push({
      manufacturer: sorted[0].manufacturer.trim(),
      model: sorted[0].model.trim(),
      catalogNumber: sorted.find((m) => m.catalogNumber)?.catalogNumber ?? null,
      notebookIds: sorted.map((m) => m.notebookId),
      refusedTurns: sorted.reduce((s, m) => s + m.refusedTurns, 0),
      lastSeenAt: new Date(last).toISOString(),
      alreadyInLibrary: libraryKeys.has(libKey(sorted[0].manufacturer, sorted[0].model)),
      lastSearch: sorted.find((m) => m.lastSearch)?.lastSearch ?? null,
      _last: last,
    });
  }

  all.sort(
    (a, b) =>
      b.refusedTurns - a.refusedTurns ||
      b._last - a._last ||
      normalizeIdentityPart(a.manufacturer).localeCompare(normalizeIdentityPart(b.manufacturer)) ||
      normalizeIdentityPart(a.model).localeCompare(normalizeIdentityPart(b.model)),
  );
  const strip = ({ _last, ...p }: ManualProposal & { _last: number }): ManualProposal => {
    void _last;
    return p;
  };
  return {
    proposals: all.filter((p) => p.lastSearch === null).map(strip),
    searched: all.filter((p) => p.lastSearch !== null).map(strip),
  };
}

const NOTEBOOKS_SQL = `
  SELECT n.id::text AS notebook_id, n.manufacturer, n.model, n.catalog_number,
         n.identity_status,
         COALESCE(n.last_opened_at, n.created_at) AS last_seen,
         n.manual_acquisition->>'state' AS search_state,
         n.manual_acquisition->>'key' AS search_key
    FROM equipment_notebooks n
   WHERE n.tenant_id = $1::uuid
     AND n.identity_status = 'user_confirmed'
     AND btrim(COALESCE(n.manufacturer, '')) <> ''
     AND (btrim(COALESCE(n.model, '')) <> '' OR btrim(COALESCE(n.catalog_number, '')) <> '')`;

const SOURCES_SQL = `
  SELECT notebook_id::text AS notebook_id, source_role, enabled_by_default, match_state, match_evidence
    FROM equipment_notebook_sources
   WHERE tenant_id = $1::uuid
     AND notebook_id = ANY($2::uuid[])
     AND superseded_at IS NULL`;

const REFUSALS_SQL = `
  SELECT notebook_id::text AS notebook_id, COUNT(*)::int AS refused,
         MAX(COALESCE(finished_at, ts)) AS last_refused
    FROM decision_traces
   WHERE tenant_id = $1::text  -- TEXT since migration 070
     AND lifecycle = 'closed'
     AND outcome IN ('refused', 'abstained')
     AND notebook_id = ANY($2::uuid[])
   GROUP BY notebook_id`;

const LIBRARY_SQL = `
  SELECT DISTINCT lower(btrim(manufacturer)) AS manufacturer,
                  lower(btrim(model_number)) AS model
    FROM knowledge_entries
   WHERE (is_private = false OR tenant_id = $1::uuid)
     AND lower(btrim(manufacturer)) = ANY($2::text[])
     AND lower(btrim(model_number)) = ANY($3::text[])`;

function ms(v: unknown): number {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : 0;
}

/** Tenant reads only — run inside ONE withTenantContext client. Read-only. */
export async function loadHarvestNotebooks(tenantDb: QueryDb, tenantId: string): Promise<HarvestNotebook[]> {
  const nb = await tenantDb.query(NOTEBOOKS_SQL, [tenantId]);
  const notebooks: HarvestNotebook[] = [];
  for (const r of nb.rows) {
    const n: HarvestNotebook = {
      notebookId: String(r.notebook_id),
      manufacturer: String(r.manufacturer ?? ""),
      model: String(r.model ?? ""),
      catalogNumber: (r.catalog_number as string) ?? null,
      identityStatus: String(r.identity_status),
      lastSeenMs: ms(r.last_seen),
      hasManual: false,
      refusedTurns: 0,
      lastSearch: null,
    };
    const k = keyOfNotebook(n);
    if (!k) continue;
    // A recorded outcome only describes the CURRENT identity when its key matches.
    if (r.search_key === k && typeof r.search_state === "string") n.lastSearch = r.search_state;
    notebooks.push(n);
  }
  if (notebooks.length === 0) return [];
  const ids = notebooks.map((n) => n.notebookId);

  const src = await tenantDb.query(SOURCES_SQL, [tenantId, ids]);
  const byNotebook = new Map<string, NotebookSource[]>();
  for (const r of src.rows) {
    const list = byNotebook.get(String(r.notebook_id)) ?? [];
    // Only the fields the applicability contract reads.
    list.push({
      sourceRole: (r.source_role as string) ?? null,
      enabledByDefault: r.enabled_by_default === true,
      matchState: r.match_state as NotebookSource["matchState"],
      matchEvidence: r.match_evidence ?? null,
    } as NotebookSource);
    byNotebook.set(String(r.notebook_id), list);
  }
  for (const n of notebooks) {
    n.hasManual =
      applicableEnabledSource(byNotebook.get(n.notebookId) ?? [], {
        identityStatus: n.identityStatus,
        manufacturer: n.manufacturer,
        model: n.model,
        catalogNumber: n.catalogNumber,
      }) !== null;
  }

  const ref = await tenantDb.query(REFUSALS_SQL, [tenantId, ids]);
  const byId = new Map(notebooks.map((n) => [n.notebookId, n]));
  for (const r of ref.rows) {
    const n = byId.get(String(r.notebook_id));
    if (!n) continue;
    n.refusedTurns = Number(r.refused) || 0;
    n.lastSeenMs = Math.max(n.lastSeenMs, ms(r.last_refused));
  }
  return notebooks;
}

/** Shared-library coverage — run on the RAW pool, after the tenant client is released. */
export async function loadLibraryKeys(
  sharedDb: QueryDb,
  tenantId: string,
  notebooks: HarvestNotebook[],
): Promise<Set<string>> {
  const open = notebooks.filter((n) => !n.hasManual && n.model.trim());
  if (open.length === 0) return new Set();
  const mfrs = [...new Set(open.map((n) => normalizeIdentityPart(n.manufacturer)))];
  const models = [...new Set(open.map((n) => normalizeIdentityPart(n.model)))];
  const lib = await sharedDb.query(LIBRARY_SQL, [tenantId, mfrs, models]);
  return new Set(lib.rows.map((r) => libKey(String(r.manufacturer ?? ""), String(r.model ?? ""))));
}
