import type { NangoSync, Part } from "../../models";

// MaintainX parts/inventory sync — cursor-based pagination
// Runs: every 2 hours (configured in nango.yaml)

export default async function fetchData(nango: NangoSync): Promise<void> {
  let cursor: string | null = null;
  const limit = 100;

  do {
    const params: Record<string, string | number> = { limit };
    if (cursor) params.cursor = cursor;

    const response = await nango.get<{
      parts: RawPart[];
      nextCursor: string | null;
    }>({
      endpoint: "/parts",
      params,
    });

    const { parts, nextCursor } = response.data;

    if (!parts?.length) break;

    const records: Part[] = parts.map(mapPart);
    await nango.batchSave(records, "Part");
    await nango.log(`Synced ${records.length} parts`);

    cursor = nextCursor;
  } while (cursor);
}

interface RawPart {
  id: number;
  name: string;
  partNumber?: string;
  totalQuantity?: number;
  unitCost?: number;
  description?: string;
  locationId?: number;
}

function mapPart(raw: RawPart): Part {
  return {
    id: raw.id,
    name: raw.name,
    part_number: raw.partNumber ?? null,
    quantity: raw.totalQuantity ?? 0,
    unit_cost: raw.unitCost ?? null,
    description: raw.description ?? null,
    location_id: raw.locationId ?? null,
  };
}
