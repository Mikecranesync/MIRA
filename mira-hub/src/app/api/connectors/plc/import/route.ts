import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { handlePlcImport } from "@/lib/plc-import";

export const dynamic = "force-dynamic";

/**
 * POST /api/connectors/plc/import — upload an offline PLC program export (Rockwell L5X or vendor
 * tag CSV) and get back the parser's maintenance-intelligence report + proposed UNS namespace
 * (and optional CESMII i3X payload). Forwards to mira-ingest `/ingest/plc-parse`.
 *
 * PR-B: parse + return only (no DB writes). Writing the proposals to `ai_suggestions` for the
 * `/proposals` approval queue is PR-C.
 */
export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  // Auth-gated (401 above); PR-B parses + returns only, so the tenant isn't used yet. PR-C will
  // thread ctx.tenantId through to scope the ai_suggestions write.
  return handlePlcImport(req);
}
