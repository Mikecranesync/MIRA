import { NextResponse, type NextRequest } from "next/server";
import { handleLocalUpload } from "@/lib/local-upload";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/uploads/folder
 *
 * Service-token sibling of /api/uploads/local. Same multipart contract, same
 * downstream pipeline (mira-ingest → KB). Used by the MiraDrop desktop
 * watcher (tools/mira-drop-watcher/) — no browser, no Auth.js session,
 * just a bearer token + tenant header.
 *
 * Headers:
 *   Authorization: Bearer <HUB_INGEST_TOKEN>
 *   X-Mira-Tenant-Id: <uuid>
 *
 * Body: multipart/form-data — same fields as /api/uploads/local
 *   file (required), assetTag (optional), unsPath (optional)
 */
export async function POST(req: NextRequest) {
  const expected = process.env.HUB_INGEST_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json({ error: "service_disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenantId = (req.headers.get("x-mira-tenant-id") ?? "").trim();
  if (!UUID_RE.test(tenantId)) {
    return NextResponse.json(
      { error: "x_mira_tenant_id_required" },
      { status: 400 },
    );
  }

  return handleLocalUpload(req, { tenantId });
}
