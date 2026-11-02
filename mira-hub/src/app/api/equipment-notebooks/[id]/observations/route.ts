/**
 * GET  /api/equipment-notebooks/[id]/observations — the bound machine's observed
 *      state and one page of its history (`?cursor=<id>&limit=<n>`, at most
 *      HISTORY_PAGE_MAX). `?observation=<id>` also returns that one row (the panel's
 *      save readback). `?conflicts=<factKey>&conflictCursor=<id>` also returns one page
 *      of that fact's opposing reports past the ones the state lists (#5106). Asset-scoped:
 *      any notebook of this tenant bound to the same confirmed machine returns the same answer.
 * POST /api/equipment-notebooks/[id]/observations — record a technician-confirmed
 *      observation (append-only; a correction supersedes an earlier row).
 *
 * Mission 001. Flag `MIRA_OBSERVATION_STATE` off ⇒ 404. See
 * capabilities/observations/store.ts for the write and db/migrations/113 for the schema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, resolveBoundAsset } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { observationStateEnabled } from "@/capabilities/observations/flag";
import { confirmedAssetOf, observationsStorageUnavailable } from "@/capabilities/observations/gate";
import { validateObservationInput } from "@/capabilities/observations/validate";
import {
  getObservationForAsset,
  HISTORY_PAGE_DEFAULT,
  HISTORY_PAGE_MAX,
  insertObservation,
  listConflictPage,
  listObservationHistory,
  listProjectionRows,
} from "@/capabilities/observations/store";
import { FACT_KEYS, type FactKey } from "@/capabilities/observations/parse";
import { deriveObservedState, summaryOf } from "@/capabilities/observations/project";

export const dynamic = "force-dynamic";

const DISABLED = { error: "observations_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };

function pageLimit(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 1) return HISTORY_PAGE_DEFAULT;
  return Math.min(Math.floor(n), HISTORY_PAGE_MAX);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!observationStateEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  const asset = confirmedAssetOf(await resolveBoundAsset(ctx.tenantId, id));
  if (!asset.ok) return asset.response;

  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor");
  if (cursor !== null && !isUuid(cursor)) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  const observationId = q.get("observation");
  if (observationId !== null && !isUuid(observationId)) {
    return NextResponse.json({ error: "invalid_observation_id" }, { status: 400 });
  }
  const conflicts = q.get("conflicts");
  if (conflicts !== null && !(FACT_KEYS as readonly string[]).includes(conflicts)) {
    return NextResponse.json({ error: "invalid_fact_key" }, { status: 400 });
  }
  const conflictCursor = q.get("conflictCursor");
  if (conflictCursor !== null && (conflicts === null || !isUuid(conflictCursor))) {
    return NextResponse.json({ error: "invalid_conflict_cursor" }, { status: 400 });
  }

  try {
    const entityId = asset.asset.entityId;
    const { rows, contests } = await listProjectionRows(ctx.tenantId, entityId);
    const state = deriveObservedState(rows, { now: new Date(), contests });
    const page = await listObservationHistory(ctx.tenantId, entityId, { cursor, limit: pageLimit(q.get("limit")) });
    if (page.status === "invalid_cursor") return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    const conflictPage = conflicts
      ? await listConflictPage(ctx.tenantId, entityId, conflicts as FactKey, { cursor: conflictCursor, limit: pageLimit(q.get("limit")) })
      : null;
    if (conflictPage?.status === "invalid_cursor") return NextResponse.json({ error: "invalid_conflict_cursor" }, { status: 400 });
    return NextResponse.json({
      equipmentEntityId: entityId,
      state: summaryOf(state),
      history: page.rows,
      nextCursor: page.nextCursor,
      ...(conflictPage?.status === "ok"
        ? { conflicts: { factKey: conflicts, rows: conflictPage.rows, nextCursor: conflictPage.nextCursor } }
        : {}),
      ...(observationId ? { observation: await getObservationForAsset(ctx.tenantId, entityId, observationId) } : {}),
    });
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
