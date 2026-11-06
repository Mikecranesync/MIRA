import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, resolveBoundAsset } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { confirmedAssetOf } from "@/capabilities/observations/gate";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { validatePacketIntake } from "@/capabilities/living-sheet/packet-intake";
import { intakePacket } from "@/capabilities/living-sheet/intake-closeout-store";
import { intakeJson, intakeFailure } from "@/capabilities/living-sheet/intake-route";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json({ error: "living_sheet_disabled" }, { status: 404 });
  if (!ctx.userId) return intakeFailure("unauthenticated");
  const { id } = await params;
  if (!isUuid(id) || !await getNotebook(ctx.tenantId, id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  const asset = confirmedAssetOf(await resolveBoundAsset(ctx.tenantId, id));
  if (!asset.ok) return asset.response;
  const raw = await intakeJson(req);
  if ("response" in raw) return raw.response;
  const checked = validatePacketIntake(raw.value, id);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const result = await intakePacket(ctx.tenantId, id, asset.asset, checked.value, { userId: ctx.userId, label: ctx.email ?? null });
    if (result.status !== "created" && result.status !== "existing") return intakeFailure(result.status);
    return NextResponse.json({ jobId: result.jobId, view: result.view, replayed: result.status === "existing" }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) { const response = livingSheetStorageUnavailable(error); if (response) return response; throw error; }
}
