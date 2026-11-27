/**
 * #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
 * machine's number"), stored in `equipment_notebooks.confirmed_numbers` (migration 118).
 *
 * Only the thread status scope reads them (manual-status-subject.ts). The catalog number, the
 * lookup key, the manual search, manual matching and retrieval never do.
 *
 * Written by `confirmNotebookIdentity` (notebook-manual-acquisition.ts), inside its own
 * transaction, and emptied by `updateNotebook` (lib/equipment-notebooks.ts) when a PATCH writes the
 * identity status or source by hand. Deliberately imports nothing from either module: tests replace
 * them with partial mocks.
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
 * Decides the notebook's numbers inside the identity confirm's own transaction, after that confirm
 * locked the notebook row and wrote the identity (`confirmNotebookIdentity`, #6104 r2 F3/F4).
 * `entry` is the ticked number, or null when nothing was ticked; `code` is the order number the
 * route read from `number` (`singleOrderNumber`).
 *
 * - `settledBefore` is whether the identity card had already settled this identity (settled, with
 *   source `user`). A confirm where it had not (a blank or reopened identity, or one a nameplate
 *   photo settled) decides its numbers afresh: they become exactly its tick, or none, whatever an
 *   earlier identity left (round-3 pre-screen). An identity reopened and settled again therefore
 *   never brings an old number back.
 * - A confirm on an identity the card already settled changes no number (r2 F3): a retry of the
 *   number saved for this machine is still a success, anything else is refused. A stale second card
 *   for the same machine therefore cannot add or clear one, whichever box the first confirm left.
 *   Only entries carrying a code count (r1 F4), so an entry the scope cannot use never stands in.
 *
 * Runs under its own savepoint: a failing statement is rolled back to it, logged and reported as
 * false. A missing column (before migration 118, when every read fails closed) ends there, so the
 * confirm still commits. Any other failure on a settle then empties the numbers outside the
 * savepoint (round-3 pre-screen 3): a settle never commits over numbers an earlier identity left,
 * and if even that write fails the confirm's transaction fails and nothing commits. The row is
 * locked and was just written in this transaction, so neither write can match no row. True when
 * the ticked code is the machine's number afterwards. Touches only `confirmed_numbers`.
 */
export async function recordConfirmedNumber(
  c: TxClient,
  tenantId: string,
  notebookId: string,
  entry: { number: string; code: string; manufacturer: string; model: string } | null,
  settledBefore: boolean,
): Promise<boolean> {
  await c.query("SAVEPOINT confirmed_number");
  try {
    let saved = false;
    if (!settledBefore) {
      const next = entry
        ? [{ number: entry.number, code: entry.code, manufacturer: entry.manufacturer, model: entry.model, confirmedAt: new Date().toISOString() }]
        : [];
      const res = await c.query(
        `UPDATE equipment_notebooks SET confirmed_numbers = $3::jsonb WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, notebookId, JSON.stringify(next)],
      );
      saved = entry !== null && (res.rowCount ?? 0) > 0;
    } else if (entry) {
      const row = await c.query<{ confirmed_numbers: unknown }>(
        `SELECT confirmed_numbers FROM equipment_notebooks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, notebookId],
      );
      const value = row.rows[0]?.confirmed_numbers;
      const entries = Array.isArray(value) ? value.filter(isEntry) : [];
      const maker = makerKey(entry.manufacturer);
      const model = key(entry.model);
      saved = entries.some((e) => e.code === entry.code && makerKey(e.manufacturer) === maker && key(e.model) === model);
    }
    await c.query("RELEASE SAVEPOINT confirmed_number");
    return saved;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT confirmed_number");
    console.warn(`[confirmed-numbers] save failed notebook=${notebookId}: ${(err as Error).message}`);
    if (!settledBefore && !missingColumn(err)) await c.query(CLEAR_SQL, [tenantId, notebookId]);
    return false;
  }
}

/** Empties a notebook's numbers. */
const CLEAR_SQL = `UPDATE equipment_notebooks SET confirmed_numbers = '[]'::jsonb WHERE tenant_id = $1::uuid AND id = $2::uuid`;

/** Postgres "undefined column": a Hub running before migration 118, where every read fails closed. */
function missingColumn(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "42703";
}

/**
 * Empties the notebook's numbers inside the caller's open transaction (round-3 pre-screen 2). A
 * notebook PATCH that writes the identity status or source by hand settles or reopens an identity
 * without the identity card, and only the card adds a number, so an identity asserted by hand
 * starts with none. Under its own savepoint: a missing column (before migration 118, when every read
 * fails closed) is rolled back to it and logged, so the PATCH still succeeds. Any other failure is
 * rolled back to it and thrown, so the PATCH fails rather than commit over the old numbers (round-3
 * pre-screen 3).
 */
export async function clearConfirmedNumbers(c: TxClient, tenantId: string, notebookId: string): Promise<void> {
  await c.query("SAVEPOINT confirmed_number");
  try {
    await c.query(CLEAR_SQL, [tenantId, notebookId]);
    await c.query("RELEASE SAVEPOINT confirmed_number");
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT confirmed_number");
    if (!missingColumn(err)) throw err;
    console.warn(`[confirmed-numbers] clear failed notebook=${notebookId}: ${(err as Error).message}`);
  }
}
