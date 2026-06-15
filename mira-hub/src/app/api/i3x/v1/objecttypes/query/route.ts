import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listObjectTypes } from "@/lib/i3x/object-types";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

// Filters by body.elementIds when provided; returns full list otherwise.
export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.elementIds) ? body.elementIds : undefined;
  const all = listObjectTypes();
  return NextResponse.json(successList(ids ? all.filter((t) => ids.includes(t.elementId)) : all));
}
