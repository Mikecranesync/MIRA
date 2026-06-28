import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/connectors/ignition/import
 *
 * Hub proxy: authenticates the session, then forwards to the mira-pipeline
 * connector import endpoint which calls IgnitionMockConnector →
 * import_and_propose() → ai_suggestions rows in NeonDB.
 *
 * Phase 2a of the Ignition tag-mapper plan.
 * Plan: docs/plans/2026-06-15-ignition-tag-mapper-implementation.md §Phase 2
 *
 * Body (optional, all fields have defaults):
 *   { connector_type?: "mock", record_types?: string[], limit?: number }
 *
 * Response:
 *   { ok, provider, proposals_created, record_count, relationship_count }
 */

export async function POST(req: Request) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const pipelineUrl = process.env.PIPELINE_URL;
  if (!pipelineUrl) {
    return NextResponse.json({ error: "PIPELINE_URL not configured" }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    // empty body is fine — all fields are optional
  }

  const payload = {
    tenant_id: ctx.tenantId,
    connector_type: body.connector_type ?? "mock",
    record_types: Array.isArray(body.record_types) ? body.record_types : ["asset", "tag"],
    limit: typeof body.limit === "number" ? body.limit : 500,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${pipelineUrl}/v1/connectors/ignition/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error("[api/connectors/ignition/import] upstream fetch failed:", err);
    return NextResponse.json({ error: "connector service unreachable" }, { status: 502 });
  }

  const json = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { error: json.detail ?? upstream.statusText },
      { status: upstream.status },
    );
  }

  return NextResponse.json(json);
}
