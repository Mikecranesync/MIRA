import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listRelationshipTypes } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.elementIds) ? body.elementIds : undefined;
  const all = listRelationshipTypes();
  return NextResponse.json(successList(ids ? all.filter((t) => ids.includes(t.elementId)) : all));
}
