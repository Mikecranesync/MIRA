import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";
import { enrichAsset } from "@/lib/agents/asset-intelligence";
import { generateAssetTag, validateAssetTag } from "@/lib/asset-tag";
import { backfillAssetUnsPath, mintAssetBridgeNode } from "@/lib/knowledge-graph/asset-bridge";

export const dynamic = "force-dynamic";

function rowToAsset(r: Record<string, unknown>) {
  return {
    id: r.id,
    tag: r.equipment_number ?? r.id,
    name: (r.description as string) || [r.manufacturer, r.model_number, r.equipment_type].filter(Boolean).join(" "),
    manufacturer: r.manufacturer ?? null,
    model: r.model_number ?? null,
    serialNumber: r.serial_number ?? null,
    type: r.equipment_type ?? null,
    location: r.location ?? null,
    department: r.department ?? null,
    criticality: r.criticality ?? "medium",
    workOrderCount: r.work_order_count ?? 0,
    downtimeHours: r.total_downtime_hours ?? 0,
    lastMaintenance: r.last_maintenance_date ?? null,
    lastWorkOrder: r.last_work_order_at ?? null,
    lastFault: r.last_reported_fault ?? null,
    description: r.description ?? null,
    createdAt: r.created_at ?? null,
    parentAssetId: r.parent_asset_id ?? null,
    qrGeneratedAt: r.qr_generated_at ?? null,
  };
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const url = new URL(req.url);
    const manufacturer = url.searchParams.get("manufacturer");
    const rootsOnly = url.searchParams.get("roots") === "true";

    const filters: string[] = ["tenant_id = $1"];
    const params: unknown[] = [ctx.tenantId];
    if (manufacturer) {
      params.push(manufacturer);
      filters.push(`LOWER(manufacturer) = LOWER($${params.length})`);
    }
    if (rootsOnly) {
      filters.push("parent_asset_id IS NULL");
    }

    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, equipment_number, manufacturer, model_number, serial_number,
          equipment_type, location, department, criticality,
          work_order_count, total_downtime_hours,
          last_maintenance_date, last_work_order_at,
          last_reported_fault, description, created_at, parent_asset_id
        FROM cmms_equipment
        WHERE ${filters.join(" AND ")}
        ORDER BY last_work_order_at DESC NULLS LAST, created_at DESC`,
        params,
      ).then((r) => r.rows),
    );
    return NextResponse.json(rows.map(rowToAsset));
  } catch (err) {
    console.error("[api/assets GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "assets.create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const { name, tag, manufacturer, model, serialNumber, location, criticality, installDate, parentAssetId } = body;

    if (!manufacturer?.trim()) {
      return NextResponse.json({ error: "manufacturer is required" }, { status: 400 });
    }

    const safeLevel = ["low", "medium", "high", "critical"].includes((criticality ?? "").toLowerCase())
      ? (criticality as string).toLowerCase()
      : "medium";

    // Permanent QR identity: every asset gets an equipment_number on create.
    // If the caller supplied one, validate; otherwise auto-generate from the
    // manufacturer prefix. Retry on the rare collision against the unique
    // partial index from migration 012.
    let resolvedTag: string;
    if (tag?.trim()) {
      const v = validateAssetTag(tag);
      if (!v.ok || !v.value) {
        return NextResponse.json({ error: v.reason ?? "invalid tag" }, { status: 400 });
      }
      resolvedTag = v.value;
    } else {
      resolvedTag = generateAssetTag({ manufacturer });
    }

    const insert = (assetTag: string) =>
      withTenantContext(ctx.tenantId, async (c) => {
        const created = await c.query(
          `INSERT INTO cmms_equipment
             (tenant_id, equipment_number, manufacturer, model_number, serial_number,
              location, criticality, installation_date, description,
              parent_asset_id, qr_generated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::criticalitylevel, $8, $9, $10, NOW())
           RETURNING
             id, equipment_number, manufacturer, model_number, serial_number,
             equipment_type, location, criticality, description, created_at,
             parent_asset_id, qr_generated_at`,
          [
            ctx.tenantId,
            assetTag,
            manufacturer.trim(),
            model?.trim() || null,
            serialNumber?.trim() || null,
            location?.trim() || null,
            safeLevel,
            installDate || null,
            name?.trim() || null,
            parentAssetId || null,
          ],
        ).then((r) => r.rows[0]);

        // Bridge the new asset into the knowledge graph in the SAME
        // transaction. A half-created machine — an asset-register row with no
        // kg_entities node — is precisely the state that made scan→notebook
        // work for CV-101 (whose bridge row was seeded by hand) and 404 with
        // "That asset isn't in this account" for every other machine. Create
        // is the only moment both facts are known, so it is where they are
        // written together. See lib/knowledge-graph/asset-bridge.ts.
        const bridge = await mintAssetBridgeNode(c, ctx.tenantId, {
          assetId: String(created.id),
          tag: assetTag,
          description: (created.description as string | null) ?? null,
          manufacturer: (created.manufacturer as string | null) ?? null,
          model: (created.model_number as string | null) ?? null,
        });
        if (bridge.ok) {
          await backfillAssetUnsPath(c, ctx.tenantId, String(created.id), bridge.unsPath);
        } else {
          // Not fatal: the asset is still usable in the register and a later
          // namespace edit can place it. Loud, because until it is placed the
          // machine cannot open a notebook.
          console.warn(
            `[api/assets POST] asset ${created.id} created without a UNS path (${bridge.reason}) — notebook will refuse it`,
          );
        }
        return created;
      });

    let row: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        row = await insert(resolvedTag);
        break;
      } catch (e) {
        const msg = (e as { code?: string; message?: string })?.code === "23505"
          ? "unique_violation"
          : (e as Error)?.message ?? "";
        if (msg === "unique_violation" && !tag?.trim()) {
          // collision on auto-gen — retry with a fresh tag
          resolvedTag = generateAssetTag({ manufacturer });
          continue;
        }
        if ((e as { code?: string })?.code === "23505") {
          return NextResponse.json({ error: "tag already exists" }, { status: 409 });
        }
        throw e;
      }
    }
    if (!row) {
      return NextResponse.json({ error: "Failed to allocate asset tag" }, { status: 500 });
    }

    // Fire-and-forget enrichment — don't await, never block the 201 response
    void enrichAsset(ctx.tenantId, String(row.id)).catch((e) =>
      console.error("[asset enrichment fire-forget]", e),
    );

    return NextResponse.json(rowToAsset(row), { status: 201 });
  } catch (err) {
    console.error("[api/assets POST]", err);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
