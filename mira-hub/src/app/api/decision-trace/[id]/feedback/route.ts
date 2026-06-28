// POST /api/decision-trace/[id]/feedback
//
// Records trace-linked technician feedback (the "Correct / Wrong / Missing
// context / Needs review" loop on the "Why MIRA Thinks This" panel).
// Tenant-scoped: the trace must belong to the caller's tenant (else 404), and
// the feedback row is stamped with the caller's tenant + user id.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = new Set(["good", "bad", "missing_context", "needs_review"]);

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
    return NextResponse.json({ error: "invalid trace id" }, { status: 400 });
  }

  let body: { verdict?: string; note?: string };
  try {
    body = (await req.json()) as { verdict?: string; note?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const verdict = body.verdict ?? "";
  if (!VERDICTS.has(verdict)) {
    return NextResponse.json(
      { error: "verdict must be one of: good, bad, missing_context, needs_review" },
      { status: 422 },
    );
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // Confirm the trace belongs to this tenant before recording feedback.
      const owned = await c
        .query(
          `SELECT 1 FROM decision_traces WHERE trace_id = $1 AND tenant_id = $2 LIMIT 1`,
          [id, ctx.tenantId],
        )
        .then((r: { rows: unknown[] }) => r.rows.length > 0);
      if (!owned) return null;

      const inserted = await c
        .query(
          `INSERT INTO decision_trace_feedback
             (trace_id, tenant_id, verdict, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING feedback_id, verdict, created_at`,
          [id, ctx.tenantId, verdict, note, ctx.userId],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0]);
      return inserted;
    });

    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
