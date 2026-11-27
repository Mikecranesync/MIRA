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

/** Appends one confirmed number unless the same number (any spelling) is already saved for the
 *  same maker and model. True when the entry is on the row afterwards; false when no row matched.
 *  Touches only `confirmed_numbers`, so migration 101's trigger never fires. */
export async function saveConfirmedNumber(
  tenantId: string,
  notebookId: string,
  entry: { number: string; manufacturer: string; model: string },
): Promise<boolean> {
  const written = await withTenantContext(tenantId, (c) =>
    c.query<{ id: string }>(
      `UPDATE equipment_notebooks AS n
          SET confirmed_numbers = CASE
                WHEN EXISTS (
                  SELECT 1 FROM jsonb_array_elements(n.confirmed_numbers) AS e
                   WHERE upper(regexp_replace(e->>'number', '[^A-Za-z0-9]', '', 'g')) = $6
                     AND e->>'manufacturer' = $4 AND e->>'model' = $5)
                THEN n.confirmed_numbers
                ELSE n.confirmed_numbers || jsonb_build_array(jsonb_build_object(
                  'number', $3::text, 'manufacturer', $4::text, 'model', $5::text, 'confirmedAt', $7::text))
              END
        WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
        RETURNING n.id`,
      [tenantId, notebookId, entry.number, entry.manufacturer, entry.model, key(entry.number), new Date().toISOString()],
    ),
  );
  return (written.rowCount ?? 0) > 0;
}
