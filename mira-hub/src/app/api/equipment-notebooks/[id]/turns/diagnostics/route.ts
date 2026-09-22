/**
 * GET /api/equipment-notebooks/[id]/turns/diagnostics?limit=
 *
 * Recent Turn Flight Recorder packets for a notebook — ids, decision and
 * anomaly codes only, never a packet body (that's the single-turn route
 * `[turnId]/diagnostics`). Design:
 * docs/architecture/observability/2026-09-22-turn-flight-recorder.md §4.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { listTurnDiagnostics } from "@/capabilities/observability/diagnostics-read";

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

  const rawLimit = requestSearchParams(req).get("limit");
  const parsedLimit = rawLimit === null ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  const turns = await listTurnDiagnostics(ctx.tenantId, id, limit);
  return NextResponse.json({ turns });
}
