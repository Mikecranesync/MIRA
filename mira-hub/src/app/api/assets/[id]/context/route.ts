import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { fetchMachineMemory, isUndefinedRelationOrColumn } from "@/lib/machine-memory";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/context
 *
 * Returns the minimum context the tablet needs to render the "is this the
 * right asset?" confirmation card before unlocking troubleshooting:
 *   - asset (id, name, asset_tag, uns_path)
 *   - components count + names
 *   - recent_signal_count
 *   - recent_work_order_count
 *
 * Used by the UNS Confirmation Gate. If the asset is missing or has no
 * components, returns the asset row but flags `ready_for_troubleshooting=false`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // Resolve the asset from cmms_equipment — the canonical asset id-space the
      // rest of the asset API uses (detail/documents/chat/validation-qa all key
      // `cmms_equipment.id`). The old query looked the `[id]` up in kg_entities,
      // which 404'd for every CMMS-registered asset that hasn't been promoted to
      // a kg_entities row (the common case) — breaking the UNS confirmation-gate
      // card for an asset that plainly exists. uns_path is enriched from
      // kg_entities via the same `(id::text=$ OR entity_id=$)` bridge the chat
      // route uses (null when the asset has no kg row).
      const assetRow = await c
        .query(
          `SELECT id, equipment_number, manufacturer, model_number
             FROM cmms_equipment
            WHERE id = $1 AND tenant_id = $2
            LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r) => r.rows[0] ?? null);

      if (!assetRow) return null;

      // Enrich uns_path from kg_entities via the same bridge the chat route uses.
      // Separate query (not a join): cmms_equipment.tenant_id is TEXT but
      // kg_entities.tenant_id is UUID, so a direct column compare errors
      // (uuid = text). Param-binding compares each in its own type. Null when the
      // asset has no kg_entities row (the common CMMS-only case).
      const unsPath = await c
        .query(
          `SELECT uns_path::text AS uns_path
             FROM kg_entities
            WHERE tenant_id = $1
              AND entity_type = 'equipment'
              AND (id::text = $2 OR entity_id = $2)
            LIMIT 1`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows[0]?.uns_path ?? null);

      // Machine memory (T2 / seam 3): latest run, state window, and up to 3
      // recent anomaly diffs, so the confirmation card can show what the
      // machine has been doing. Null when the asset has no uns_path, or when
      // the 038/040 machine-memory tables aren't applied in this env yet.
      //
      // Review Q1 (PR #2414): unlike the chat route's `buildMachineMemorySection`,
      // this block is returned as raw JSON *data* for a client to render — it is
      // never interpolated into an LLM prompt — so it does NOT need
      // neutralizeReferenceText/length-capping. Only prompt interpolations of
      // these DB-sourced fields are a prompt-injection vector; plain API
      // pass-through is not.
      let machineMemory: {
        latest_run: Record<string, unknown> | null;
        latest_window: Record<string, unknown> | null;
        latest_diffs: Record<string, unknown>[];
        next_check: string | null;
      } | null = null;
      if (unsPath) {
        try {
          const memory = await fetchMachineMemory(c, ctx.tenantId, unsPath);
          machineMemory = {
            latest_run: memory.latest_run,
            latest_window: memory.latest_window,
            latest_diffs: memory.latest_diffs.slice(0, 3),
            // The newest anomaly diff that carries a next_check in metadata.
            next_check:
              memory.latest_diffs.find((d) => d.next_check)?.next_check ?? null,
          };
        } catch (err) {
          // 038 not applied in this env — machine memory simply isn't
          // available. Anything else is a real error for the outer handler.
          if (!isUndefinedRelationOrColumn(err)) throw err;
          console.error("[api/assets/[id]/context GET] machine-memory tables unavailable (038/040 not applied?)", err);
          machineMemory = null;
        }
      }

      const components = await c
        .query(
          `SELECT id, component_name, canonical_name, plc_tag
             FROM installed_component_instances
            WHERE tenant_id = $1 AND asset_id = $2
            ORDER BY component_name`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows);

      const signals = await c
        .query(
          `SELECT COUNT(*)::int AS n
             FROM live_signal_events e
             JOIN installed_component_instances i ON i.id = e.component_id
            WHERE e.tenant_id = $1 AND i.asset_id = $2
              AND e.created_at > now() - interval '24 hours'`,
          [ctx.tenantId, id],
        )
        .then((r) => Number(r.rows[0]?.n ?? 0));

      return {
        asset: {
          id: assetRow.id,
          name: assetRow.equipment_number ?? null,
          asset_tag: assetRow.equipment_number ?? null,
          manufacturer: assetRow.manufacturer ?? null,
          model: assetRow.model_number ?? null,
          uns_path: unsPath,
        },
        components: components.map((cmp: Record<string, unknown>) => ({
          id: cmp.id,
          name: cmp.component_name,
          canonical_name: cmp.canonical_name,
          plc_tag: cmp.plc_tag,
        })),
        recent_signal_count_24h: signals,
        machine_memory: machineMemory,
        ready_for_troubleshooting: components.length > 0,
      };
    });

    if (!result) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/context GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
