// mira-hub/src/app/api/visual/regions/[id]/route.ts
//
// Visual Focus Workspace (PR V2) — update one region (geometry and/or label).
// UPDATE is the only mutation 063 grants on region_of_interest (no DELETE);
// the SET list is a strict whitelist of those two columns.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  SCHEMA_ID,
  RegionValidationError,
  canonicalGeometry,
  toStorageGeometry,
  fromStorageGeometry,
} from "@/lib/visual";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RegionRow {
  region_id: string;
  evidence_id: string;
  geometry: unknown;
  label: string | null;
  origin: string;
  created_at: string;
}

interface PatchRegionPayload {
  geometry?: unknown;
  label?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let payload: PatchRegionPayload;
  try {
    payload = (await req.json()) as PatchRegionPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hasGeometry = payload.geometry !== undefined;
  const hasLabel = payload.label !== undefined;
  if (!hasGeometry && !hasLabel) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  let storageGeometry: string | null = null;
  if (hasGeometry) {
    try {
      canonicalGeometry(payload.geometry);
      storageGeometry = JSON.stringify(toStorageGeometry(payload.geometry));
    } catch (err) {
      const detail = err instanceof RegionValidationError ? err.message : "invalid geometry";
      return NextResponse.json({ error: "invalid_geometry", detail }, { status: 400 });
    }
  }
  let label: string | null = null;
  if (hasLabel) {
    if (payload.label !== null && typeof payload.label !== "string") {
      return NextResponse.json({ error: "invalid_label" }, { status: 400 });
    }
    label =
      typeof payload.label === "string" && payload.label.trim().length > 0
        ? payload.label.trim().slice(0, 200)
        : null;
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      // Ownership check doubles as the 404 gate (cross-tenant → not found).
      const existing = await c.query<RegionRow>(
        `SELECT region_id, evidence_id, geometry, label, origin, created_at
         FROM region_of_interest
         WHERE region_id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (!existing.rows[0]) return null;

      // Strict column whitelist: geometry, label. Nothing else is mutable.
      const sets: string[] = [];
      const args: unknown[] = [];
      if (storageGeometry !== null) {
        args.push(storageGeometry);
        sets.push(`geometry = $${args.length}`);
      }
      if (hasLabel) {
        args.push(label);
        sets.push(`label = $${args.length}`);
      }
      args.push(id, ctx.tenantId);
      const res = await c.query<RegionRow>(
        `UPDATE region_of_interest SET ${sets.join(", ")}
         WHERE region_id = $${args.length - 1} AND tenant_id = $${args.length}
         RETURNING region_id, evidence_id, geometry, label, origin, created_at`,
        args,
      );
      return res.rows[0] ?? null;
    });

    if (!row) {
      return NextResponse.json({ error: "region_not_found" }, { status: 404 });
    }

    let geometry: unknown = null;
    let geometryError: string | null = null;
    try {
      geometry = fromStorageGeometry(row.geometry);
    } catch (err) {
      geometryError = err instanceof RegionValidationError ? err.message : "invalid_geometry";
    }
    return NextResponse.json({
      region: {
        schema: SCHEMA_ID,
        region_id: row.region_id,
        evidence_id: row.evidence_id,
        geometry,
        geometry_error: geometryError,
        label: row.label,
        origin: row.origin,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error("[api/visual/regions/:id PATCH]", err);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
