import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint that powers the QR-scan landing page
// at /m/{assetTag}. A technician on the plant floor scans the QR with the
// stock camera app and lands here with no session — the goal is to show
// "what is this thing" instantly so they can decide whether to ask MIRA,
// open a work order, or look up the manual.
//
// Security model: equipment_number from the auto-generator is an
// unguessable 8-char Crockford base32 suffix (32^8 ≈ 1.1 × 10^12 per
// prefix), so the tag itself is a bearer-style identifier. The endpoint:
//   - returns ONLY non-sensitive fields (no serial numbers, no fault
//     history, no PII, no work-order details)
//   - bypasses RLS deliberately because there is no tenant context
//   - returns the first row when a hand-typed legacy tag collides across
//     tenants (rare; new auto-generated tags don't collide)
//
// Authenticated info (recent WOs, PM schedule, fault history) is fetched
// separately by the page once it knows the viewer has a session.

const TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tag: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag).trim();
  if (!tag || !TAG_RE.test(tag)) {
    return NextResponse.json({ error: "invalid tag" }, { status: 400 });
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT
           id, equipment_number, manufacturer, model_number, equipment_type,
           location, criticality, description, parent_asset_id, qr_generated_at
         FROM cmms_equipment
         WHERE equipment_number = $1
         ORDER BY qr_generated_at ASC NULLS LAST, created_at ASC
         LIMIT 1`,
        [tag],
      );
      const row = result.rows[0];
      if (!row) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }

      const childrenResult = await client.query(
        `SELECT id, equipment_number, manufacturer, model_number, equipment_type, description
           FROM cmms_equipment
          WHERE parent_asset_id = $1
          ORDER BY equipment_number ASC NULLS LAST`,
        [row.id],
      );

      return NextResponse.json({
        id: row.id,
        tag: row.equipment_number,
        name:
          (row.description as string) ||
          [row.manufacturer, row.model_number, row.equipment_type].filter(Boolean).join(" "),
        manufacturer: row.manufacturer ?? null,
        model: row.model_number ?? null,
        type: row.equipment_type ?? null,
        location: row.location ?? null,
        criticality: row.criticality ?? "medium",
        qrGeneratedAt: row.qr_generated_at ?? null,
        children: childrenResult.rows.map((c) => ({
          id: c.id,
          tag: c.equipment_number ?? null,
          name:
            (c.description as string) ||
            [c.manufacturer, c.model_number, c.equipment_type].filter(Boolean).join(" "),
          manufacturer: c.manufacturer ?? null,
          model: c.model_number ?? null,
        })),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[api/public/assets/by-tag/[tag] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
