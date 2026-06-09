import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

// Accept the spec verdicts plus the approve/reject aliases the UI uses.
const VERDICT_ALIASES: Record<string, "good" | "bad" | "needs_review"> = {
  good: "good",
  bad: "bad",
  needs_review: "needs_review",
  approve: "good",
  reject: "bad",
};

// PUT /api/assets/[id]/validation-qa/[qaId]/verdict  { verdict }
// A human marks a validation answer good / bad / needs_review.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, qaId } = await params;

  const body = (await req.json().catch(() => ({}))) as { verdict?: string };
  const verdict = VERDICT_ALIASES[(body.verdict ?? "").trim().toLowerCase()];
  if (!verdict) {
    return NextResponse.json(
      { error: "verdict must be one of good, bad, needs_review" },
      { status: 400 },
    );
  }
  const reviewer = `human:${ctx.userId}`;

  try {
    const row = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `UPDATE asset_validation_qa
             SET reviewer_verdict = $3, reviewed_by = $4, reviewed_at = now()
           WHERE id = $1 AND equipment_id = $2
           RETURNING id, reviewer_verdict, reviewed_by, reviewed_at`,
          [qaId, id, verdict, reviewer],
        )
        .then((r) => r.rows[0] ?? null),
    );
    if (!row) {
      return NextResponse.json({ error: "Validation Q&A not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: row.id,
      reviewerVerdict: row.reviewer_verdict,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
    });
  } catch (err) {
    console.error("[api/assets/[id]/validation-qa/[qaId]/verdict PUT]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
