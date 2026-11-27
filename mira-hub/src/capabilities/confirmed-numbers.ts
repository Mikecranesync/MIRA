/**
 * #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
 * machine's number"), stored in `equipment_notebooks.confirmed_numbers` (migration 118).
 *
 * Only the thread status scope reads them (manual-status-subject.ts). The catalog number, the
 * lookup key, the manual search, manual matching and retrieval never do.
 *
 * Written only by `confirmNotebookIdentity` (notebook-manual-acquisition.ts), inside its own
 * transaction. Deliberately imports nothing from that module: tests replace it with a partial mock.
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

/** A client inside an open transaction (the identity confirm's, `withTenantContext`). */
export interface TxClient {
  query<R = unknown>(sql: string, values?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
}

/**
 * Records the ticked number inside the identity confirm's own transaction, after that confirm
 * locked the notebook row and wrote the identity (`confirmNotebookIdentity`, #6104 r2 F3/F4). `code`
 * is the order number the route read from `number` (`singleOrderNumber`).
 *
 * - Only the confirm that settles the identity may add a number (r2 F3). When the identity was
 *   already settled before this confirm (`settledBefore`), nothing is added: a retry of the number
 *   already saved for this machine is still a success, anything else is refused. A stale second card
 *   for the same machine therefore cannot add one, whichever box the first confirm left.
 * - One number per machine (r1 F3): the first saved code wins, a retry of it is a success, and a
 *   different code is refused. Only entries carrying a code count (r1 F4), so an entry the scope
 *   cannot use never blocks or stands in for one it can.
 *
 * Runs under its own savepoint: any failure (including a missing column before migration 118) is
 * rolled back to it, logged and reported as false, so it never fails the confirm. True when this
 * code is the machine's number afterwards. Touches only `confirmed_numbers`.
 */
export async function recordConfirmedNumber(
  c: TxClient,
  tenantId: string,
  notebookId: string,
  entry: { number: string; code: string; manufacturer: string; model: string },
  settledBefore: boolean,
): Promise<boolean> {
  await c.query("SAVEPOINT confirmed_number");
  try {
    const row = await c.query<{ confirmed_numbers: unknown }>(
      `SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, notebookId],
    );
    let saved = false;
    if (row.rows.length) {
      const value = row.rows[0]!.confirmed_numbers;
      const entries = Array.isArray(value) ? value.filter(isEntry) : [];
      const maker = makerKey(entry.manufacturer);
      const model = key(entry.model);
      const coded = entries.filter((e) => typeof e.code === "string" && makerKey(e.manufacturer) === maker && key(e.model) === model);
      if (coded.length) saved = coded.some((e) => e.code === entry.code);
      else if (!settledBefore) {
        const added = { number: entry.number, code: entry.code, manufacturer: entry.manufacturer, model: entry.model, confirmedAt: new Date().toISOString() };
        await c.query(
          `UPDATE equipment_notebooks SET confirmed_numbers = confirmed_numbers || $3::jsonb WHERE tenant_id = $1::uuid AND id = $2::uuid`,
          [tenantId, notebookId, JSON.stringify([added])],
        );
        saved = true;
      }
    }
    await c.query("RELEASE SAVEPOINT confirmed_number");
    return saved;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT confirmed_number");
    console.warn(`[confirmed-numbers] save failed notebook=${notebookId}: ${(err as Error).message}`);
    return false;
  }
}
