/**
 * GET  /api/manual-harvester — the manuals this technician's own history says
 *      they need (confirmed machines without a live manual), ranked. Read-only.
 * POST /api/manual-harvester — { notebookId }: the technician's one-tap OK.
 *      Starts the EXISTING background search (startManualAcquisition) for that
 *      notebook's confirmed identity. No second acquisition pipeline: claim,
 *      idempotency per identity key, download, applicability check and the
 *      candidate/verified decision all stay in notebook-manual-acquisition.
 *
 * Gated by the same switch as automatic acquisition (MIRA_NOTEBOOK_MANUAL_ACQUISITION):
 * a proposal list whose OK button could not run would be a dead affordance.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { loadHarvestNotebooks, loadLibraryKeys, rankManualProposals } from "@/capabilities/manual-harvester";
import {
  acquisitionEnabled,
  acquisitionKey,
  startManualAcquisition,
} from "@/capabilities/notebook-manual-acquisition";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ENABLED = { error: "not_enabled" };

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!acquisitionEnabled()) return NextResponse.json(NOT_ENABLED, { status: 404 });
  try {
    // Tenant reads finish (and release their connection) before the raw-pool
    // library read starts — never two pool connections held at once.
    const notebooks = await withTenantContext(ctx.tenantId, (c) => loadHarvestNotebooks(c, ctx.tenantId));
    const libraryKeys = await loadLibraryKeys(pool, ctx.tenantId, notebooks);
    return NextResponse.json(rankManualProposals(notebooks, libraryKeys));
  } catch (err) {
    console.error("[manual-harvester] list failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "harvest_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!acquisitionEnabled()) return NextResponse.json(NOT_ENABLED, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const notebookId = typeof body.notebookId === "string" ? body.notebookId : "";
  if (!UUID_RE.test(notebookId)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  // Read-only lookup (getNotebook would bump last_opened_at). Tenant-bound twice:
  // RLS via withTenantContext and the explicit predicate.
  const nb = await withTenantContext(ctx.tenantId, async (c) => {
    const r = await c.query(
      `SELECT id::text AS id, node_id::text AS node_id, manufacturer, model, catalog_number, identity_status,
              manual_acquisition->>'key' AS search_key, manual_acquisition->>'state' AS search_state
         FROM equipment_notebooks
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [ctx.tenantId, notebookId],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });
  if (!nb) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  const identity = {
    identityStatus: nb.identity_status as string | null,
    manufacturer: nb.manufacturer as string | null,
    model: nb.model as string | null,
    catalogNumber: nb.catalog_number as string | null,
  };
  const key = acquisitionKey(identity);
  if (!key) {
    return NextResponse.json({ error: "identity_not_confirmed" }, { status: 409 });
  }
  // Already searched for THIS identity: say so instead of a silent started=false.
  // Retries of a failed search stay the pipeline's own job (claim's retry rules).
  if (nb.search_key === key && typeof nb.search_state === "string") {
    return NextResponse.json({ error: "already_searched", state: nb.search_state }, { status: 409 });
  }

  const started = await startManualAcquisition({
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
    notebookId,
    nodeId: String(nb.node_id),
    identity,
  });
  // started=false here means a concurrent claim won the race for this key.
  return NextResponse.json({ started, notebookId });
}
