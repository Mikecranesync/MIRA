import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { handlePlcImport } from "@/lib/plc-import";

export const dynamic = "force-dynamic";

/**
 * POST /api/connectors/plc/import — upload an offline PLC program export (Rockwell L5X or vendor
 * tag CSV) and get back the parser's maintenance-intelligence report + proposed UNS namespace
 * (and optional CESMII i3X payload). Forwards to mira-ingest `/ingest/plc-parse`.
 *
 * Default: parse + return only (preview). With `commit=true` (PR-C), the proposed UNS candidates
 * are also written to `ai_suggestions` (status `pending`) for the caller's tenant, surfacing in the
 * `/proposals` review queue. Nothing is auto-verified.
 */
export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  return handlePlcImport(req, ctx.tenantId);
}
