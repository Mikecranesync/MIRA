/**
 * PUT /api/equipment-notebooks/[id]/components/selection
 *   { threadId, componentId | null, via, expectedVersion | null, clientRequestId }
 *
 * Points this technician's conversation at one component ("Asking about …"),
 * or clears it (whole machine). `via` is how: the picker, the "Return to …"
 * action after a refusal, a clarification choice, or confirming a component.
 * Re-picking the component already selected still moves the boundary, so a
 * Return ends a refused question's carry. Nothing is written into the
 * conversation: the next question is not rephrased, it is asked under this state.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { setSelection, type SelectedVia } from "@/capabilities/bench-components/store";
import { isUuid } from "@/capabilities/bench-components/validate";
import { bad, requestIdOf, threadKeyOf } from "@/capabilities/bench-components/http";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIAS: readonly SelectedVia[] = ["picker", "return", "clarify", "confirm"];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const threadKey = threadKeyOf(body.threadId);
  if (!threadKey) return bad("invalid_thread_id");
  if (body.componentId !== null && !isUuid(body.componentId)) return bad("invalid_component_id");
  if (!VIAS.includes(body.via as SelectedVia)) return bad("invalid_via", 400, { allowed: VIAS });
  const expectedVersion = body.expectedVersion === null ? null : Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : undefined;
  if (expectedVersion === undefined) return bad("expected_version_required");

  const result = await setSelection(ctx.tenantId, id, ctx.userId, threadKey, {
    componentId: body.componentId as string | null,
    via: body.via as SelectedVia,
    expectedVersion,
    clientRequestId,
  });
  switch (result.status) {
    case "set":
    case "existing":
      return NextResponse.json({ status: result.status, selection: result.selection });
    case "cleared":
      return NextResponse.json({ status: "cleared", selection: null });
    case "component_not_found":
      return bad("component_not_found", 404);
    case "component_retired":
      return bad("component_retired", 409);
    case "version_conflict":
      return bad("selection_changed", 409, { message: "The component for this chat was changed on another screen.", selection: result.selection });
  }
}
