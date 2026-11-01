/**
 * GET  /api/equipment-notebooks/[id]/observations — the bound machine's observed
 *      state and history. Asset-scoped: any notebook of this tenant bound to the
 *      same confirmed machine returns the same answer.
 * POST /api/equipment-notebooks/[id]/observations — record a technician-confirmed
 *      observation (append-only; a correction supersedes an earlier row).
 *
 * Mission 001. Flag `MIRA_OBSERVATION_STATE` off ⇒ 404. See
 * capabilities/observations/store.ts for the write and db/proposed/113 for the schema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, resolveBoundAsset } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { observationStateEnabled } from "@/capabilities/observations/flag";
import { confirmedAssetOf, observationsStorageUnavailable } from "@/capabilities/observations/gate";
import { validateObservationInput } from "@/capabilities/observations/validate";
import { insertObservation, listObservationsForAsset } from "@/capabilities/observations/store";
import { deriveObservedState } from "@/capabilities/observations/project";

export const dynamic = "force-dynamic";

const DISABLED = { error: "observations_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!observationStateEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  const asset = confirmedAssetOf(await resolveBoundAsset(ctx.tenantId, id));
  if (!asset.ok) return asset.response;

  try {
    const rows = await listObservationsForAsset(ctx.tenantId, asset.asset.entityId);
    const state = deriveObservedState(rows, { now: new Date() });
    return NextResponse.json({ equipmentEntityId: asset.asset.entityId, state, history: state.history });
  } catch (err) {
    const unavailable = observationsStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!observationStateEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  const asset = confirmedAssetOf(await resolveBoundAsset(ctx.tenantId, id));
  if (!asset.ok) return asset.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const validated = validateObservationInput(body, { now: new Date() });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  // A client-supplied machine id is only a check. The server binding decides.
  const claimed = (body as Record<string, unknown>).equipmentEntityId;
  if (claimed !== undefined && claimed !== asset.asset.entityId) {
    return NextResponse.json(
      { error: "asset_mismatch", message: "That observation is for a different machine than this notebook is on." },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await insertObservation(
      ctx.tenantId,
      id,
      asset.asset.entityId,
      asset.asset.unsPath,
      validated.value,
      ctx.userId ?? null,
    );
  } catch (err) {
    const unavailable = observationsStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }

  switch (result.status) {
    case "created":
      return NextResponse.json(
        { observation: result.observation, event: { eventId: result.eventId, sequence: result.sequence } },
        { status: 201 },
      );
    case "existing":
      return NextResponse.json({ observation: result.observation }, { status: 200 });
    case "request_id_conflict":
      return NextResponse.json(
        { error: "request_id_conflict", message: "That request id was already used for a different observation." },
        { status: 409 },
      );
    case "binding_changed":
      return NextResponse.json(
        { error: "asset_binding_changed", message: "This notebook's machine changed while saving. Check the machine and try again." },
        { status: 409 },
      );
    case "source_turn_not_found":
      return NextResponse.json({ error: "source_turn_not_found" }, { status: 400 });
    case "supersedes_not_found":
      return NextResponse.json(
        { error: "supersedes_not_found", message: "The observation being corrected is not on this machine." },
        { status: 409 },
      );
  }
}
