/**
 * #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
 * machine's number"), stored in `equipment_notebooks.confirmed_numbers` (migration 118).
 *
 * Only the thread status scope reads them (manual-status-subject.ts). The catalog number, the
 * lookup key, the manual search, manual matching and retrieval never do.
 *
 * Deliberately imports nothing from notebook-manual-acquisition.ts: route tests replace that
 * module with a partial mock.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { normalizeManufacturer } from "@/lib/manufacturerNormalize";

export interface ConfirmedNumberEntry {
  number: string;
  /** The order number `number` is (#6104 r1 F4). Absent on an entry the scope cannot use. */
  code?: string;
  manufacturer: string;
  model: string;
  confirmedAt: string;
}

const key = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const makerKey = (s: string | null | undefined) => key(normalizeManufacturer(s).canonical);

function isEntry(v: unknown): v is ConfirmedNumberEntry {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.number === "string" && typeof r.manufacturer === "string" && typeof r.model === "string" && typeof r.confirmedAt === "string";
}

/** The saved numbers that belong to this identity: same maker (vendor group) and model. */
export function numbersForIdentity(
  entries: readonly ConfirmedNumberEntry[],
  identity: { manufacturer: string | null | undefined; model: string | null | undefined },
): string[] {
  const maker = makerKey(identity.manufacturer);
  const model = key(identity.model);
  if (!maker || !model) return [];
  return entries.filter((e) => makerKey(e.manufacturer) === maker && key(e.model) === model).map((e) => e.number);
}

/** The notebook's saved numbers. Never throws: any error (including a missing column before the
 *  prod migration) gives none, which is today's behaviour. */
export async function readConfirmedNumbers(tenantId: string, notebookId: string): Promise<ConfirmedNumberEntry[]> {
  try {
    const res = await withTenantContext(tenantId, (c) =>
      c.query<{ confirmed_numbers: unknown }>(
        `SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, notebookId],
      ),
    );
    const value = res.rows[0]?.confirmed_numbers;
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch (err) {
    console.warn(`[confirmed-numbers] read failed notebook=${notebookId}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Saves the one confirmed number for this maker and model, under the notebook row lock. `code` is
 * the order number the route read from `number` (`singleOrderNumber`). One number per machine
 * (#6104 r1 F3): the first saved code wins, a retry of it is a success, and a different code is
 * refused. Only entries carrying a code count (#6104 r1 F4), so an entry the scope cannot use never
 * blocks or stands in for one it can. True when this code is the machine's number afterwards;
 * false when it is not, or no row matched. Touches only `confirmed_numbers`, so migration 101's
 * trigger never fires.
 */
export async function saveConfirmedNumber(
  tenantId: string,
  notebookId: string,
  entry: { number: string; code: string; manufacturer: string; model: string },
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const row = await c.query<{ confirmed_numbers: unknown }>(
      `SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
      [tenantId, notebookId],
    );
    if (!row.rows.length) return false;
    const value = row.rows[0]!.confirmed_numbers;
    const entries = Array.isArray(value) ? value.filter(isEntry) : [];
    const maker = makerKey(entry.manufacturer);
    const model = key(entry.model);
    const saved = entries.filter((e) => typeof e.code === "string" && makerKey(e.manufacturer) === maker && key(e.model) === model);
    if (saved.length) return saved.some((e) => e.code === entry.code);
    const added = { number: entry.number, code: entry.code, manufacturer: entry.manufacturer, model: entry.model, confirmedAt: new Date().toISOString() };
    await c.query(
      `UPDATE equipment_notebooks SET confirmed_numbers = confirmed_numbers || $3::jsonb WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId, JSON.stringify([added])],
    );
    return true;
  });
}
