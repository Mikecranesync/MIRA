import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function rowToQa(r: Record<string, unknown>) {
  return {
    id: r.id,
    question: r.question,
    expectedAnswer: r.expected_answer ?? null,
    miraAnswer: r.mira_answer ?? null,
    citations: r.citations ?? [],
    groundedness: r.groundedness ?? null,
    evidenceUtilization: r.evidence_utilization ?? null,
    reviewerVerdict: r.reviewer_verdict ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
    createdAt: r.created_at ?? null,
  };
}

// GET /api/assets/[id]/validation-qa — the validation transcript, newest first.
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

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const asset = await c
        .query(`SELECT 1 FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [
          id,
          ctx.tenantId,
        ])
        .then((r) => r.rows[0] ?? null);
      if (!asset) return null;
      return c
        .query(
          `SELECT id, question, expected_answer, mira_answer, citations,
                  groundedness, evidence_utilization, reviewer_verdict,
                  reviewed_by, reviewed_at, created_at
           FROM asset_validation_qa
           WHERE equipment_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [id],
        )
        .then((r) => r.rows);
    });
    if (result === null) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json(result.map(rowToQa));
  } catch (err) {
    console.error("[api/assets/[id]/validation-qa GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

// POST /api/assets/[id]/validation-qa — record a validation turn.
// The Validate tab asks the question through the existing asset chat, then
// posts the resulting answer + citations here for review (spec §8 reuses
// AssetChat — no separate inference in this route).
export async function POST(
  req: Request,
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

  const body = (await req.json().catch(() => ({}))) as {
    question?: string;
    expectedAnswer?: string;
    miraAnswer?: string;
    citations?: unknown;
    groundedness?: number;
    evidenceUtilization?: number;
  };
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const groundedness =
    typeof body.groundedness === "number"
      ? Math.max(1, Math.min(5, Math.round(body.groundedness)))
      : null;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const asset = await c
        .query(`SELECT 1 FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [
          id,
          ctx.tenantId,
        ])
        .then((r) => r.rows[0] ?? null);
      if (!asset) return null;

      // Ensure a lifecycle row exists so the asset surfaces in the readiness list.
      await c.query(
        `INSERT INTO asset_agent_status (tenant_id, equipment_id, uns_path, state)
         SELECT $1, $2, e.uns_path, 'draft'
         FROM cmms_equipment e WHERE e.id = $2 AND e.tenant_id = $1
         ON CONFLICT (tenant_id, equipment_id) DO NOTHING`,
        [ctx.tenantId, id],
      );

      return c
        .query(
          `INSERT INTO asset_validation_qa
             (tenant_id, equipment_id, question, expected_answer, mira_answer,
              citations, groundedness, evidence_utilization)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
           RETURNING id, question, expected_answer, mira_answer, citations,
                     groundedness, evidence_utilization, reviewer_verdict,
                     reviewed_by, reviewed_at, created_at`,
          [
            ctx.tenantId,
            id,
            question,
            body.expectedAnswer ?? null,
            body.miraAnswer ?? null,
            JSON.stringify(citations),
            groundedness,
            typeof body.evidenceUtilization === "number" ? body.evidenceUtilization : null,
          ],
        )
        .then((r) => r.rows[0]);
    });
    if (result === null) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json(rowToQa(result), { status: 201 });
  } catch (err) {
    console.error("[api/assets/[id]/validation-qa POST]", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}
