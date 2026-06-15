import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { relationshipsForElement, loadEntitiesByIds } from "@/lib/i3x/data-access";
import { kgEntityToObjectInstance, relatedFromEdge } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  if (ids.length > 200) return NextResponse.json(errorBody(400, "Bad Request", "elementIds exceeds maximum of 200"), { status: 400 });
  const relFilter: string | null = typeof body?.relationshipType === "string" ? body.relationshipType : null;

  const results = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const edges = await relationshipsForElement(c, id);
      const otherIds = edges.map((e) => (e.source_id === id ? e.target_id : e.source_id));
      const others = await loadEntitiesByIds(c, otherIds); // verified-only
      const byId = new Map(others.map((o) => [o.id, kgEntityToObjectInstance(o)]));
      for (const e of edges) {
        const r = relatedFromEdge(e, id, byId);
        if (r && (!relFilter || r.sourceRelationship === relFilter)) out.push(r);
      }
    }
    return out;
  });
  return NextResponse.json(successList(results));
}
