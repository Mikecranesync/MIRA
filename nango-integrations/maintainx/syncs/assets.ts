import type { NangoSync, Asset } from "../../models";

// MaintainX assets sync — cursor-based pagination
// Runs: every 1 hour (configured in nango.yaml)

export default async function fetchData(nango: NangoSync): Promise<void> {
  let cursor: string | null = null;
  const limit = 100;

  do {
    const params: Record<string, string | number> = { limit };
    if (cursor) params.cursor = cursor;

    const response = await nango.get<{
      assets: RawAsset[];
      nextCursor: string | null;
    }>({
      endpoint: "/assets",
      params,
    });

    const { assets, nextCursor } = response.data;

    if (!assets?.length) break;

    const records: Asset[] = assets.map(mapAsset);
    await nango.batchSave(records, "Asset");
    await nango.log(`Synced ${records.length} assets`);

    cursor = nextCursor;
  } while (cursor);
}

interface RawAsset {
  id: number;
  name: string;
  description?: string;
  locationId?: number;
  location?: { id: number; name: string };
  make?: string;
  model?: string;
  serialNumber?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

function mapAsset(raw: RawAsset): Asset {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    location_id: raw.locationId ?? null,
    location_name: raw.location?.name ?? null,
    make: raw.make ?? null,
    model: raw.model ?? null,
    serial_number: raw.serialNumber ?? null,
    status: raw.status ?? null,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
  };
}
