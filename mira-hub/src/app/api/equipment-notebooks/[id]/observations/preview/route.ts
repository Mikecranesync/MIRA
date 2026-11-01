/**
 * POST /api/equipment-notebooks/[id]/observations/preview — deterministic,
 * zero-token preview of a technician's observation text, plus the SERVER
 * binding it would be recorded against. Never writes: the technician confirms
 * the preview, then POSTs the parent route.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, resolveBoundAsset } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { observationStateEnabled } from "@/capabilities/observations/flag";
import { confirmedAssetOf } from "@/capabilities/observations/gate";
import { previewObservation } from "@/capabilities/observations/parse";

export const dynamic = "force-dynamic";

/** Lake Wales, FL. A bare "09:10" on a technician's clock is read in plant time. */
const PLANT_TIME_ZONE = "America/New_York";
const NOT_FOUND = { error: "notebook_not_found" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!observationStateEnabled()) return NextResponse.json({ error: "observations_disabled" }, { status: 404 });

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
  const text = typeof body === "object" && body !== null ? (body as Record<string, unknown>).text : undefined;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }

  const preview = previewObservation(text, { now: new Date(), timeZone: PLANT_TIME_ZONE });
  return NextResponse.json({
    preview,
    asset: { equipmentEntityId: asset.asset.entityId, displayName: asset.asset.name, unsPath: asset.asset.unsPath },
  });
}
