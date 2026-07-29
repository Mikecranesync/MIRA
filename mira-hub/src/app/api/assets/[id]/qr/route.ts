import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";
import { generateAssetTag } from "@/lib/asset-tag";

export const dynamic = "force-dynamic";

// POST /api/assets/[id]/qr — bind a permanent equipment_number (asset_tag) to
// an asset that doesn't have one yet. The QR encodes /m/{equipment_number}.
//
// Idempotent: if the asset already has equipment_number set, returns the
// existing tag without changing it. The binding is permanent — there is no
// PUT/PATCH to rewrite it.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "assets.write");
  if (denied) return denied;

  const { id } = await params;

  try {
    const existing = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT id, equipment_number, manufacturer, qr_generated_at
           FROM cmms_equipment
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [id, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );

    if (!existing) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    if (existing.equipment_number) {
      return NextResponse.json({
        tag: existing.equipment_number,
        qrGeneratedAt: existing.qr_generated_at,
        alreadyBound: true,
      });
    }

    // Allocate a fresh tag, retry on rare collision.
    let tag = generateAssetTag({ manufacturer: existing.manufacturer });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const updated = await withTenantContext(ctx.tenantId, (c) =>
          c.query(
            `UPDATE cmms_equipment
                SET equipment_number = $1,
                    qr_generated_at  = NOW()
              WHERE id = $2 AND tenant_id = $3 AND equipment_number IS NULL
              RETURNING equipment_number, qr_generated_at`,
            [tag, id, ctx.tenantId],
          ).then((r) => r.rows[0] ?? null),
        );
        if (!updated) {
          // Someone bound it between SELECT and UPDATE — re-read.
          const row = await withTenantContext(ctx.tenantId, (c) =>
            c.query(
              `SELECT equipment_number, qr_generated_at FROM cmms_equipment
                WHERE id = $1 AND tenant_id = $2`,
              [id, ctx.tenantId],
            ).then((r) => r.rows[0] ?? null),
          );
          return NextResponse.json({
            tag: row?.equipment_number ?? null,
            qrGeneratedAt: row?.qr_generated_at ?? null,
            alreadyBound: true,
          });
        }
        return NextResponse.json({
          tag: updated.equipment_number,
          qrGeneratedAt: updated.qr_generated_at,
          alreadyBound: false,
        }, { status: 201 });
      } catch (e) {
        if ((e as { code?: string })?.code === "23505") {
          tag = generateAssetTag({ manufacturer: existing.manufacturer });
          continue;
        }
        throw e;
      }
    }
    return NextResponse.json({ error: "Failed to allocate asset tag" }, { status: 500 });
  } catch (err) {
    console.error("[api/assets/[id]/qr POST]", err);
    return NextResponse.json({ error: "Failed to bind QR" }, { status: 500 });
  }
}
