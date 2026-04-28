import type { NangoAction, Asset } from "../../models";

// MaintainX get-asset action — fetches a single asset by ID
// Input: { id: number }

export default async function runAction(
  nango: NangoAction,
  input: { id: number }
): Promise<Asset> {
  const response = await nango.get<{ asset: Record<string, unknown> }>({
    endpoint: `/assets/${input.id}`,
  });

  const a = response.data.asset;

  return {
    id: a.id as number,
    name: a.name as string,
    description: (a.description as string | undefined) ?? null,
    location_id: (a.locationId as number | undefined) ?? null,
    location_name: ((a.location as { name?: string } | undefined)?.name) ?? null,
    make: (a.make as string | undefined) ?? null,
    model: (a.model as string | undefined) ?? null,
    serial_number: (a.serialNumber as string | undefined) ?? null,
    status: (a.status as string | undefined) ?? null,
    created_at: a.createdAt as string,
    updated_at: a.updatedAt as string,
  };
}
