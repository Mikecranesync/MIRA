// The ONE asset → uns_path bridge (kg_entities). Extracted from
// machine-memory-response.ts / assets/[id]/context / assets/[id]/signal-history
// (three byte-identical copies) so the Sensor history route is not a fourth —
// docs/discovery/2026-08-28-sensor-v0-discovery.md §5 "Do NOT build".
//
// Why a separate lookup and never a join: cmms_equipment.tenant_id is TEXT,
// kg_entities.tenant_id is UUID (uuid = text errors). Param-binding compares
// each in its own type. Null when the asset has no promoted kg_entities row
// (the common CMMS-only case) — callers treat that as "no machine memory",
// not as an error.

import type { MachineMemoryClient } from "@/lib/machine-memory";

/** Resolve an asset id (kg_entities.id or entity_id) to its UNS path. Read-only. */
export async function resolveAssetUnsPath(
  client: MachineMemoryClient,
  tenantId: string,
  id: string,
): Promise<string | null> {
  const r = await client.query(
    `SELECT uns_path::text AS uns_path
         FROM kg_entities
        WHERE tenant_id = $1
          AND entity_type = 'equipment'
          AND (id::text = $2 OR entity_id = $2)
        LIMIT 1`,
    [tenantId, id],
  );
  return (r.rows[0]?.uns_path as string | undefined) ?? null;
}
