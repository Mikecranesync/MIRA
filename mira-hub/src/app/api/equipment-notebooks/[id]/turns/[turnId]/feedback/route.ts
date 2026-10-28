// POST /api/equipment-notebooks/[id]/turns/[turnId]/feedback
//
// Records turn-linked technician feedback (helpful / not-helpful) on notebook answers.
// Tenant-scoped: the turn must belong to the caller's tenant and notebook (else 404),
// and the feedback row is stamped with the caller's tenant + user id.
// Feedback is stored in decision_trace_feedback, keyed to the turn's decision_traces row.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; turnId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id: notebookId, turnId } = await params;
  if (!UUID_RE.test(notebookId) || !UUID_RE.test(turnId)) {
    return NextResponse.json({ error: "invalid notebook or turn id" }, { status: 400 });
  }

  let body: { helpful?: boolean; reason?: string };
  try {
    body = (await req.json()) as { helpful?: boolean; reason?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const helpful = typeof body.helpful === "boolean" ? body.helpful : null;
  if (helpful === null) {
    return NextResponse.json(
      { error: "helpful must be true or false" },
      { status: 422 },
    );
  }

  const verdict = helpful ? "good" : "bad";
  const note = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // Find the decision_traces row for this turn, ensure it belongs to this tenant and notebook.
      const traceRes = await c.query(
        `SELECT trace_id FROM decision_traces
         WHERE turn_id = $1 AND notebook_id = $2 AND tenant_id = $3 AND lifecycle = 'closed'
         LIMIT 1`,
        [turnId, notebookId, ctx.tenantId],
      );

      if ((traceRes.rows?.length ?? 0) === 0) {
        return null;
      }

      const traceId = (traceRes.rows[0] as Record<string, unknown>).trace_id as string;

      // Insert feedback into decision_trace_feedback, linked to the trace.
      const inserted = await c
        .query(
          `INSERT INTO decision_trace_feedback
             (trace_id, tenant_id, verdict, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING feedback_id, verdict, created_at`,
          [traceId, ctx.tenantId, verdict, note, ctx.userId],
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
