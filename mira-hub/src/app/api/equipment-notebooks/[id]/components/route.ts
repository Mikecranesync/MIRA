/**
 * GET  /api/equipment-notebooks/[id]/components?threadId=… — the bench checklist,
 *      every component with an honest status and its documents, plus the
 *      component this technician's conversation is asking about.
 * POST /api/equipment-notebooks/[id]/components — add one component (optionally
 *      with what its label says). Keyed on clientRequestId: a retry adds nothing.
 *
 * Trust boundary: the client may say what the label reads and which fields it is
 * not sure of. Only the technician's own Confirm (`confirm: true`, in a revision
 * POST) makes an identity confirmed; an add is never confirmed.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources } from "@/lib/equipment-notebooks";
import { addComponent, type ComponentOrigin } from "@/capabilities/bench-components/store";
import { readRevisionInput } from "@/capabilities/bench-components/validate";
import { bad, benchState, requestIdOf, threadKeyOf } from "@/capabilities/bench-components/http";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINS: readonly ComponentOrigin[] = ["device_schedule", "inventory", "technician"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) return bad("DB not configured", 503);
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!UUID_RE.test(id)) return bad("invalid_notebook_id");
  const threadKey = threadKeyOf(req.nextUrl.searchParams.get("threadId"));
  if (!threadKey) return bad("invalid_thread_id");
  if (!(await getNotebook(ctx.tenantId, id))) return bad("notebook_not_found", 404);
  const sources = await listSources(ctx.tenantId, id);
  return NextResponse.json(await benchState(ctx.tenantId, id, ctx.userId, threadKey, sources));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) return bad("DB not configured", 503);
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!UUID_RE.test(id)) return bad("invalid_notebook_id");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_json");
  }
  const clientRequestId = requestIdOf(body);
  if (!clientRequestId) return bad("client_request_id_required");
  const origin = body.origin ?? "technician";
  if (!ORIGINS.includes(origin as ComponentOrigin)) return bad("invalid_origin");
  const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim().slice(0, 60) : null;
  const position = Number.isInteger(body.position) && (body.position as number) >= 0 ? (body.position as number) : null;
  let revision = null;
  if (body.revision != null) {
    if (typeof body.revision !== "object") return bad("invalid_revision");
    const read = readRevisionInput(body.revision as Record<string, unknown>, false);
    if ("error" in read) return bad(read.error);
    revision = read;
  }
  const result = await addComponent(ctx.tenantId, id, ctx.userId, { clientRequestId, kind, origin: origin as ComponentOrigin, position, revision });
  if (result.status === "notebook_not_found") return bad("notebook_not_found", 404);
  if (result.status === "request_id_conflict") return bad("client_request_id_reused", 409);
  return NextResponse.json({ status: result.status, componentId: result.component.id }, { status: result.status === "created" ? 201 : 200 });
}
