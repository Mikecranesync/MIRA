/**
 * GET /api/equipment-notebooks/[id]/turns/diagnostics?limit=
 * GET /api/equipment-notebooks/[id]/turns/diagnostics?client_request_id=<uuid>
 *
 * Recent Turn Flight Recorder packets for a notebook — ids, decision and
 * anomaly codes only, never a packet body (that's the single-turn route
 * `[turnId]/diagnostics`). Design:
 * docs/architecture/observability/2026-09-22-turn-flight-recorder.md §4.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  listTurnDiagnostics,
  loadTurnDiagnosticsByClientRequestId,
} from "@/capabilities/observability/diagnostics-read";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;

function requestSearchParams(req: NextRequest): URLSearchParams {
  const maybe = req as { nextUrl?: { searchParams?: URLSearchParams }; url?: string };
  if (maybe.nextUrl?.searchParams) return maybe.nextUrl.searchParams;
  return new URL(maybe.url ?? "http://localhost/").searchParams;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const sp = requestSearchParams(req);

  // ---- alternate key: client_request_id -----------------------------------
  // An external caller (the release acceptance harness, a support script) knows
  // only the idempotency key it supplied. It CANNOT know `decision_traces.turn_id`,
  // which is `equipment_notebook_turns.id` — the SSE `trace` frame exposes the
  // OTel turn id (== the client request id), not the row id. Without this key the
  // single-turn route 404s for every such caller and a perfectly recorded packet
  // looks like a missing one. Same tenant + notebook scoping, same SELECT; only
  // the lookup column differs, so this adds no new reachability.
  const crid = sp.get("client_request_id");
  if (crid !== null) {
    // Reject a malformed key before Postgres. A bad literal here would be a
    // plain text mismatch rather than an error, but validating keeps the
    // not-found shape identical to a real-but-foreign id, which leaks nothing.
    if (!UUID_RE.test(crid)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const one = await loadTurnDiagnosticsByClientRequestId(ctx.tenantId, id, crid);
    if (!one) {
      // DELIBERATELY DISTINCT from a missing notebook/route: the caller must be
      // able to tell "no packet for this turn" from "wrong notebook" and from
      // "endpoint does not exist". A single generic 404 body made all three
      // indistinguishable, which is how a broken harness reads as a broken product.
      return NextResponse.json(
        { error: "packet_not_found", client_request_id: crid, notebook_id: id },
        { status: 404 },
      );
    }
    return NextResponse.json({
      traceId: one.traceId,
      turnId: one.turnId,
      notebookId: one.notebookId,
      packet: one.packet,
      anomalies: one.anomalies,
      ts: one.ts,
    });
  }

  const rawLimit = sp.get("limit");
  const parsedLimit = rawLimit === null ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  const turns = await listTurnDiagnostics(ctx.tenantId, id, limit);
  return NextResponse.json({ turns });
}
