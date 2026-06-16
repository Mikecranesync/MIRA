import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listNamespaces } from "@/lib/i3x/namespaces";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  return NextResponse.json(successList(listNamespaces()));
}
