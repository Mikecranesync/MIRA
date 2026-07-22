// mira-hub/src/app/api/visual/evidence/[id]/regions/route.ts
//
// Visual Focus Workspace (PR V2) — regions on one evidence item.
//   GET  → list regions (canonical factorylm.visual-region.v1 geometry out).
//   POST → create a region (origin='user', frozen-contract validation).
//
// Geometry round-trips through the ONE serialization boundary — the merged V1
// mirror of the frozen contract (@/lib/visual toStorageGeometry /
// fromStorageGeometry, byte-parity to Python pinned by golden vectors). Never
// a second serializer (PRD §22: one contract spine).
//
// region_of_interest is INSERT+UPDATE only (DELETE revoked in 063) — there is
// deliberately no DELETE endpoint; corrections are updates or supersession.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  SCHEMA_ID,
  RegionValidationError,
  canonicalGeometry,
  toStorageGeometry,
  fromStorageGeometry,
  validateRegion,
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

function shapeRegion(row: RegionRow) {
  let geometry: unknown = null;
  let geometryError: string | null = null;
  try {
    geometry = fromStorageGeometry(row.geometry);
  } catch (err) {
    // A malformed stored geometry must not poison the whole list (see
    // canonical.ts — fromStorageGeometry re-validates on read).
    geometryError = err instanceof RegionValidationError ? err.message : "invalid_geometry";
  }
  return {
    schema: SCHEMA_ID,
    region_id: row.region_id,
    evidence_id: row.evidence_id,
    geometry,
    geometry_error: geometryError,
    label: row.label,
    origin: row.origin,
    created_at: row.created_at,
  };
}

async function evidenceOwned(
  tenantId: string,
  evidenceId: string,
): Promise<{ session_id: string } | null> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<{ session_id: string }>(
      `SELECT session_id FROM evidence_item WHERE evidence_id = $1 AND tenant_id = $2`,
      [evidenceId, tenantId],
    );
    return res.rows[0] ?? null;
  });
}

export async function GET(
  _req: Request,
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

  try {
    if (!(await evidenceOwned(ctx.tenantId, id))) {
      return NextResponse.json({ error: "evidence_not_found" }, { status: 404 });
    }
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<RegionRow>(
        `SELECT region_id, evidence_id, geometry, label, origin, created_at
         FROM region_of_interest
         WHERE evidence_id = $1 AND tenant_id = $2
         ORDER BY created_at ASC`,
        [id, ctx.tenantId],
      );
      return res.rows;
    });
    return NextResponse.json({ regions: rows.map(shapeRegion) });
  } catch (err) {
    console.error("[api/visual/evidence/:id/regions GET]", err);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}

interface CreateRegionPayload {
  geometry?: unknown;
  label?: unknown;
}

export async function POST(
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

  let payload: CreateRegionPayload;
  try {
    payload = (await req.json()) as CreateRegionPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const label =
    typeof payload.label === "string" && payload.label.trim().length > 0
      ? payload.label.trim().slice(0, 200)
      : null;

  // Frozen-contract validation + canonicalization. Hub-drawn regions are
  // origin='user' (the 063 column default is 'system' — always set explicitly).
  let storageGeometry: unknown;
  let canonical: unknown;
  try {
    validateRegion({ schema: SCHEMA_ID, origin: "user", geometry: payload.geometry });
    canonical = canonicalGeometry(payload.geometry);
    storageGeometry = toStorageGeometry(payload.geometry);
  } catch (err) {
    const detail = err instanceof RegionValidationError ? err.message : "invalid geometry";
    return NextResponse.json({ error: "invalid_geometry", detail }, { status: 400 });
  }

  try {
    const owned = await evidenceOwned(ctx.tenantId, id);
    if (!owned) {
      return NextResponse.json({ error: "evidence_not_found" }, { status: 404 });
    }
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const ins = await c.query<RegionRow>(
        `INSERT INTO region_of_interest (evidence_id, tenant_id, geometry, label, origin)
         VALUES ($1, $2, $3, $4, 'user')
         RETURNING region_id, evidence_id, geometry, label, origin, created_at`,
        [id, ctx.tenantId, JSON.stringify(storageGeometry), label],
      );
      // Keep the session's activity ordering honest (no updated_at trigger).
      await c.query(
        `UPDATE visual_session SET updated_at = NOW() WHERE session_id = $1 AND tenant_id = $2`,
        [owned.session_id, ctx.tenantId],
      );
      return ins.rows[0];
    });
    return NextResponse.json(
      {
        region: {
          schema: SCHEMA_ID,
          region_id: row.region_id,
          evidence_id: row.evidence_id,
          geometry: canonical,
          geometry_error: null,
          label: row.label,
          origin: row.origin,
          created_at: row.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/visual/evidence/:id/regions POST]", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
