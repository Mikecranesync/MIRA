/**
 * GET /api/equipment-notebooks/[id]/turns/[turnId]/diagnostics
 *
 * One turn's Turn Flight Recorder packet — how Mike finds why a bad answer
 * happened without SSHing into staging. Design:
 * docs/architecture/observability/2026-09-22-turn-flight-recorder.md §4.
 *
 * Returns ids/counts/flags/timings only. NEVER the technician's question or
 * MIRA's answer text — those live on `decision_traces.user_question` /
 * `.recommendation` under their existing PII-sanitized contract, and this
 * route does not select those columns at all (diagnostics-read.ts's SELECT
 * list never names them).
 *
 * `viewerUrl` is the trace-viewer link built from MIRA_TRACE_VIEWER_URL_TEMPLATE
 * (config.viewerUrlFor); null when the template is unset or the turn has no
 * OTel trace id.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { loadTurnDiagnostics } from "@/capabilities/observability/diagnostics-read";
import { viewerUrlFor } from "@/capabilities/observability/config";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; turnId: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, turnId } = await params;

  // Malformed ids can never match a row; reject before they reach Postgres
  // (an invalid uuid literal raises 22P02, not "not found") — same shape as
  // a real-but-foreign id, so this leaks nothing about what does exist.
  if (!UUID_RE.test(id) || !UUID_RE.test(turnId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const diagnostics = await loadTurnDiagnostics(ctx.tenantId, id, turnId);
  if (!diagnostics) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    traceId: diagnostics.traceId,
    turnId: diagnostics.turnId,
    notebookId: diagnostics.notebookId,
    packet: diagnostics.packet,
    anomalies: diagnostics.anomalies,
    viewerUrl: diagnostics.traceId ? viewerUrlFor(diagnostics.traceId) : null,
    ts: diagnostics.ts,
  });
}
