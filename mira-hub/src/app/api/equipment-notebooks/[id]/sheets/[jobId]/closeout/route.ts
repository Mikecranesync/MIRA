import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { validateCloseout } from "@/capabilities/living-sheet/packet-intake";
import { recordCloseout } from "@/capabilities/living-sheet/intake-closeout-store";
import { intakeJson, intakeFailure } from "@/capabilities/living-sheet/intake-route";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json({ error: "living_sheet_disabled" }, { status: 404 });
  if (!ctx.userId) return intakeFailure("unauthenticated");
  const { id, jobId } = await params;
  if (!isUuid(id) || !await getNotebook(ctx.tenantId, id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  if (!isUuid(jobId)) return intakeFailure("job_not_found");
  const raw = await intakeJson(req);
  if ("response" in raw) return raw.response;
  const checked = validateCloseout(raw.value);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const result = await recordCloseout(ctx.tenantId, id, jobId, checked.value, { userId: ctx.userId, label: ctx.email ?? null });
    if (result.status !== "created" && result.status !== "existing") return intakeFailure(result.status);
    return NextResponse.json({ candidate: result.candidate, replayed: result.status === "existing" }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) { const response = livingSheetStorageUnavailable(error); if (response) return response; throw error; }
}
