import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { historyForElement } from "@/lib/i3x/data-access";
import { toHistoricalValueResult } from "@/lib/i3x";
import { bulk, bulkItem, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

const MAX_POINTS = 5000; // bounded tag_events window; no historian dependency

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  const startTime: string | null = typeof body?.startTime === "string" ? body.startTime : null;
  const endTime: string | null = typeof body?.endTime === "string" ? body.endTime : null;

  const items = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const readings = await historyForElement(c, id, { startTime, endTime, limit: MAX_POINTS });
      out.push(bulkItem(id, toHistoricalValueResult(readings)));
    }
    return out;
  });
  return NextResponse.json(bulk(items));
}

export async function PUT() {
  return NextResponse.json(errorBody(501, "Not Implemented", "i3X writes are disabled on this server"), { status: 501 });
}
