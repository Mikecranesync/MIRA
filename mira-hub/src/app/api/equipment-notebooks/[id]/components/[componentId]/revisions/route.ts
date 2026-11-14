/**
 * POST /api/equipment-notebooks/[id]/components/[componentId]/revisions
 *
 * Clarify, correct, confirm, or mark "Not sure" on one component's identity.
 * The body is the whole identity as the technician left the confirmation card:
 *   { clientRequestId, expectedRevision, confirm, rawLabel, inputKind, manufacturer,
 *     family, catalogNumber, serialNumber, hardwareRevision, localTag, unresolved,
 *     evidenceFileId?, evidenceNote?, threadId?, selectionVersion? }
 *
 * - `expectedRevision` is the revision the card showed (0 = none). A save made
 *   against an older view is a 409 with the current component, never an overwrite.
 * - The same identity again writes nothing ("unchanged"): a confirmed component
 *   is not asked again until something material changes.
 * - When this conversation (`threadId`) is asking about this component, a
 *   correction re-points the selection at the new identity and moves its boundary,
 *   so the next question is checked against the new identity's documents.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { advanceSelectionRevision, getSelection, reviseComponent } from "@/capabilities/bench-components/store";
import { changedFields, readRevisionInput } from "@/capabilities/bench-components/validate";
import { bad, requestIdOf, threadKeyOf } from "@/capabilities/bench-components/http";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; componentId: string }> }) {
  if (!process.env.NEON_DATABASE_URL) return bad("DB not configured", 503);
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, componentId } = await params;
  if (!UUID_RE.test(id)) return bad("invalid_notebook_id");
  if (!UUID_RE.test(componentId)) return bad("invalid_component_id");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_json");
  }
  const clientRequestId = requestIdOf(body);
  if (!clientRequestId) return bad("client_request_id_required");
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) return bad("expected_revision_required");
  const read = readRevisionInput(body, body.confirm === true);
  if ("error" in read) return bad(read.error);
  const threadKey = body.threadId === undefined ? null : threadKeyOf(body.threadId);
  if (body.threadId !== undefined && !threadKey) return bad("invalid_thread_id");

  const result = await reviseComponent(ctx.tenantId, id, componentId, ctx.userId, {
    clientRequestId,
    expectedRevision: body.expectedRevision as number,
    revision: read,
  });
  if (result.status === "component_not_found") return bad("component_not_found", 404);
  if (result.status === "request_id_conflict") return bad("client_request_id_reused", 409);
  if (result.status === "stale_revision") {
    return bad("component_changed", 409, { message: "This component was changed on another screen. Review the current details.", current: result.component.current });
  }

  let selection = null;
  if (result.status === "created" && threadKey) {
    const current = await getSelection(ctx.tenantId, id, ctx.userId, threadKey);
    if (current && current.componentId === componentId && current.revision !== result.component.current?.revision) {
      selection = await advanceSelectionRevision(ctx.tenantId, id, ctx.userId, threadKey, current.version, result.component.current!.revision);
    }
  }
  return NextResponse.json(
    {
      status: result.status,
      current: result.component.current,
      changed: result.previous && result.component.current ? changedFields(result.previous, result.component.current) : [],
      selection,
    },
    { status: result.status === "created" ? 201 : 200 },
  );
}
