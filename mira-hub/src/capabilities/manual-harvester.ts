/**
 * Manual harvester — "which manuals does this technician need?", read from
 * their own history. PROPOSE-ONLY: this module never writes and never fetches.
 * A proposal becomes a manual only when the technician taps OK and the caller
 * hands it to the existing acquireManualForIdentity (manual-acquisition.ts) —
 * there is no second acquisition pipeline here.
 *
 * Inputs (all per tenant):
 *   - equipment_notebooks whose identity a human confirmed
 *     (identity_status user_confirmed | verified) with a manufacturer AND model.
 *     A candidate/unknown identity is a guess and never yields a proposal.
 *   - decision_traces closed turns on those notebooks that MIRA could not
 *     answer (outcome refused | abstained — the Hub never writes 'kb_gap',
 *     see capabilities/observability/turn-lifecycle.ts TurnOutcome).
 *   - equipment_notebook_sources: a notebook that already has a live manual
 *     source needs nothing and is dropped.
 *   - knowledge_entries: flags "the shared library already has this model".
 *
 * Pool discipline: notebooks/sources/traces are UUID-family RLS tables — run
 * them on a withTenantContext client. knowledge_entries is the HYBRID corpus —
 * run that read on the raw pool with (is_private = false OR tenant_id = $1)
 * (.claude/rules/knowledge-entries-tenant-scoping.md). Every query also binds
 * the caller tenant explicitly, so isolation never rests on RLS alone.
 */

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
};

export type ManualProposal = {
  manufacturer: string;
  model: string;
  catalogNumber: string | null;
  notebookIds: string[];
  refusedTurns: number;
  lastSeenAt: string;
  alreadyInLibrary: boolean;
};

const CONFIRMED = new Set(["user_confirmed", "verified"]);

/** Conservative grouping key: trim, case-fold, collapse whitespace. No fuzzy merging. */
export function normalizeIdentityPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function keyOf(manufacturer: string, model: string): string {
  return `${normalizeIdentityPart(manufacturer)}\u0000${normalizeIdentityPart(model)}`;
}

/** Pure: filter, group by (manufacturer, model), rank. Deterministic for equal input. */
export function rankManualProposals(
  notebooks: HarvestNotebook[],
  libraryKeys: ReadonlySet<string> = new Set(),
): ManualProposal[] {
  const groups = new Map<string, HarvestNotebook[]>();
  for (const n of notebooks) {
    if (!CONFIRMED.has(n.identityStatus)) continue;
    if (!n.manufacturer.trim() || !n.model.trim()) continue;
    if (n.hasManual) continue;
    const k = keyOf(n.manufacturer, n.model);
    const g = groups.get(k);
    if (g) g.push(n);
    else groups.set(k, [n]);
  }

  const out: (ManualProposal & { _last: number })[] = [];
  for (const [k, members] of groups) {
    const sorted = [...members].sort((a, b) => a.notebookId.localeCompare(b.notebookId));
    const last = Math.max(...sorted.map((m) => m.lastSeenMs));
    out.push({
      manufacturer: sorted[0].manufacturer.trim(),
      model: sorted[0].model.trim(),
      catalogNumber: sorted.find((m) => m.catalogNumber)?.catalogNumber ?? null,
      notebookIds: sorted.map((m) => m.notebookId),
      refusedTurns: sorted.reduce((s, m) => s + m.refusedTurns, 0),
      lastSeenAt: new Date(last).toISOString(),
      alreadyInLibrary: libraryKeys.has(k),
      _last: last,
    });
  }

  out.sort(
    (a, b) =>
      b.refusedTurns - a.refusedTurns ||
      b._last - a._last ||
      normalizeIdentityPart(a.manufacturer).localeCompare(normalizeIdentityPart(b.manufacturer)) ||
      normalizeIdentityPart(a.model).localeCompare(normalizeIdentityPart(b.model)),
  );
  return out.map(({ _last, ...p }) => p);
}

const NOTEBOOKS_SQL = `
  SELECT n.id::text AS notebook_id, n.manufacturer, n.model, n.catalog_number,
         n.identity_status,
         COALESCE(n.last_opened_at, n.created_at) AS last_seen,
         EXISTS (
           SELECT 1 FROM equipment_notebook_sources s
            WHERE s.tenant_id = $1::uuid AND s.notebook_id = n.id
              AND s.source_role = 'manual' AND s.match_state <> 'rejected'
              AND s.superseded_at IS NULL
         ) AS has_manual
    FROM equipment_notebooks n
   WHERE n.tenant_id = $1::uuid
     AND n.identity_status IN ('user_confirmed', 'verified')
     AND btrim(COALESCE(n.manufacturer, '')) <> ''
     AND btrim(COALESCE(n.model, '')) <> ''`;

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

/** Read-only loader. tenantDb: a withTenantContext client. sharedDb: the raw pool. */
export async function loadManualProposals(
  dbs: { tenantDb: QueryDb; sharedDb: QueryDb },
  tenantId: string,
): Promise<ManualProposal[]> {
  const nb = await dbs.tenantDb.query(NOTEBOOKS_SQL, [tenantId]);
  const notebooks: HarvestNotebook[] = nb.rows.map((r) => ({
    notebookId: String(r.notebook_id),
    manufacturer: String(r.manufacturer ?? ""),
    model: String(r.model ?? ""),
    catalogNumber: (r.catalog_number as string) ?? null,
    identityStatus: String(r.identity_status),
    lastSeenMs: ms(r.last_seen),
    hasManual: r.has_manual === true,
    refusedTurns: 0,
  }));
  const open = notebooks.filter((n) => !n.hasManual);
  if (open.length === 0) return [];

  const ref = await dbs.tenantDb.query(REFUSALS_SQL, [tenantId, open.map((n) => n.notebookId)]);
  const byId = new Map(open.map((n) => [n.notebookId, n]));
  for (const r of ref.rows) {
    const n = byId.get(String(r.notebook_id));
    if (!n) continue;
    n.refusedTurns = Number(r.refused) || 0;
    n.lastSeenMs = Math.max(n.lastSeenMs, ms(r.last_refused));
  }

  const mfrs = [...new Set(open.map((n) => normalizeIdentityPart(n.manufacturer)))];
  const models = [...new Set(open.map((n) => normalizeIdentityPart(n.model)))];
  const lib = await dbs.sharedDb.query(LIBRARY_SQL, [tenantId, mfrs, models]);
  const libraryKeys = new Set(
    lib.rows.map((r) => keyOf(String(r.manufacturer ?? ""), String(r.model ?? ""))),
  );
  return rankManualProposals(open, libraryKeys);
}
