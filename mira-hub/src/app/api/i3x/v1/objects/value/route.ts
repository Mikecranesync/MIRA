import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { readingForElement } from "@/lib/i3x/data-access";
import { toCurrentValueResult } from "@/lib/i3x";
import { bulk, bulkItem, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  if (ids.length > 200) return NextResponse.json(errorBody(400, "Bad Request", "elementIds exceeds maximum of 200"), { status: 400 });

  const items = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const reading = await readingForElement(c, id);
      if (reading) out.push(bulkItem(id, toCurrentValueResult(reading)));
      else out.push(bulkItem(id, null, { title: "Not Found", status: 404, detail: "no approved value for element" }));
    }
    return out;
  });
  return NextResponse.json(bulk(items));
}

// Writes are disabled (read-only doctrine; i3X update.current=false).
export async function PUT() {
  return NextResponse.json(errorBody(501, "Not Implemented", "i3X writes are disabled on this server"), { status: 501 });
}
