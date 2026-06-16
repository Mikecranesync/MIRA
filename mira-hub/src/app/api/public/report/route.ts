import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_REPORTS_PER_HOUR = 5;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_CONTACT_LEN = 200;

// POST /api/public/report — no auth required.
//
// Accepts issue reports from field workers who scanned a QR code but have no
// hub account. Tied to the equipment via equipment_number from the QR URL.
//
// Rate-limited by IP hash (5 reports / IP / hour) to prevent spam.
// INSERT runs as neondb_owner (bypasses RLS intentionally — the table's RLS
// policy only gates SELECT for authenticated tenant reads).
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  let body: { equipmentNumber?: unknown; description?: unknown; contactInfo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { equipmentNumber, description, contactInfo } = body;

  if (typeof equipmentNumber !== "string" || !equipmentNumber.trim()) {
    return NextResponse.json({ error: "equipmentNumber is required" }, { status: 400 });
  }
  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json({ error: `description exceeds ${MAX_DESCRIPTION_LEN} characters` }, { status: 400 });
  }
  if (contactInfo !== undefined && contactInfo !== null) {
    if (typeof contactInfo !== "string" || contactInfo.length > MAX_CONTACT_LEN) {
      return NextResponse.json({ error: `contactInfo exceeds ${MAX_CONTACT_LEN} characters` }, { status: 400 });
    }
  }

  // Hash IP for rate limiting — we never store raw IPs.
  const hdrs = await headers();
  const rawIp = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? hdrs.get("x-real-ip")
    ?? "unknown";
  const ipHash = createHash("sha256").update(rawIp).digest("hex");

  const client = await pool.connect();
  try {
    // Rate limit check.
    const rateRow = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM equipment_guest_reports
        WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [ipHash],
    );
    if (parseInt(rateRow.rows[0]?.n ?? "0", 10) >= MAX_REPORTS_PER_HOUR) {
      return NextResponse.json({ error: "Too many reports — try again later" }, { status: 429 });
    }

    // Resolve equipment_number → (id, tenant_id). Reject if ambiguous or missing.
    // Runs as neondb_owner (no RLS), intentionally — the tag is public (on the QR label).
    const eqRows = await client.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM cmms_equipment WHERE equipment_number = $1`,
      [equipmentNumber.trim()],
    );
    if (eqRows.rows.length === 0) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }
    if (eqRows.rows.length > 1) {
      // Ambiguous — shouldn't happen given the unique index, but guard anyway.
      return NextResponse.json({ error: "Ambiguous equipment tag" }, { status: 409 });
    }
    const { id: equipmentId, tenant_id: tenantId } = eqRows.rows[0];

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO equipment_guest_reports
         (equipment_id, tenant_id, equipment_number, description, contact_info, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        equipmentId,
        tenantId,
        equipmentNumber.trim(),
        description.trim(),
        typeof contactInfo === "string" && contactInfo.trim() ? contactInfo.trim() : null,
        ipHash,
      ],
    );

    return NextResponse.json({ ok: true, reportId: inserted.rows[0].id }, { status: 201 });
  } catch (err) {
    console.error("[api/public/report POST]", err);
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  } finally {
    client.release();
  }
}
