import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { loadEntitiesByIds } from "@/lib/i3x/data-access";
import { kgEntityToObjectInstance } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  if (ids.length > 200) return NextResponse.json(errorBody(400, "Bad Request", "elementIds exceeds maximum of 200"), { status: 400 });
  const entities = await withTenantContext(tenantId, (c) => loadEntitiesByIds(c, ids));
  return NextResponse.json(successList(entities.map(kgEntityToObjectInstance)));
}
