import type { NangoSync, WorkOrder } from "../../models";

// MaintainX work orders sync — cursor-based pagination
// Runs: every 30 minutes (configured in nango.yaml)
// Tier: Nango Cloud / Enterprise self-hosted (not free self-hosted)
// Free-tier alternative: use Nango Proxy via mira-hub/src/lib/nango.ts

export default async function fetchData(nango: NangoSync): Promise<void> {
  let cursor: string | null = null;
  const limit = 100;

  do {
    const params: Record<string, string | number> = { limit };
    if (cursor) params.cursor = cursor;

    const response = await nango.get<{
      workOrders: RawWorkOrder[];
      nextCursor: string | null;
    }>({
      endpoint: "/workorders",
      params,
    });

    const { workOrders, nextCursor } = response.data;

    if (!workOrders?.length) break;

    const records: WorkOrder[] = workOrders.map(mapWorkOrder);
    await nango.batchSave(records, "WorkOrder");
    await nango.log(`Synced ${records.length} work orders (cursor: ${cursor ?? "start"})`);

    cursor = nextCursor;
  } while (cursor);
}

interface RawWorkOrder {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  assetId?: number;
  locationId?: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  workOrderNo?: string;
  categories?: string[];
  assignees?: { id: number; name: string }[];
}

function mapWorkOrder(raw: RawWorkOrder): WorkOrder {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    status: raw.status,
    priority: raw.priority ?? null,
    asset_id: raw.assetId ?? null,
    location_id: raw.locationId ?? null,
    due_date: raw.dueDate ?? null,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    work_order_no: raw.workOrderNo ?? null,
    categories: raw.categories ?? [],
    assignees: (raw.assignees ?? []).map((a) => ({ id: a.id, name: a.name })),
  };
}
