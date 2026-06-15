import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { kgEntityToObjectInstance, filterExposable } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";
import { parentUnsPath } from "@/lib/i3x/data-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const rows = await withTenantContext(tenantId, (c) =>
    c.query<{ id: string; entity_type: string; name: string; approval_state: string | null; uns_path: string | null; properties: Record<string, unknown> | null }>(
      // TODO: paginate — currently capped at 500 verified entities (no cursor)
      `SELECT id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
         FROM kg_entities WHERE approval_state = 'verified' ORDER BY uns_path NULLS LAST LIMIT 500`,
    ).then((r) => r.rows),
  );
  const verified = filterExposable(rows);
  const byPath = new Map(verified.filter((r) => r.uns_path).map((r) => [r.uns_path as string, r.id]));
  const objects = verified.map((r) => {
    const pp = parentUnsPath(r.uns_path);
    return kgEntityToObjectInstance({ ...r, parent_id: pp ? byPath.get(pp) ?? null : null });
  });
  return NextResponse.json(successList(objects));
}
