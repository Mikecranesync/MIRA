/**
 * Insert-with-a-fallback-name, fenced by a SAVEPOINT.
 *
 * WHY A SAVEPOINT AND NOT A try/catch
 * In Postgres a unique violation ABORTS the enclosing transaction:
 *
 *   BEGIN;
 *   INSERT ... ;                     -- 23505
 *   SELECT 1;                        -- ERROR: current transaction is aborted,
 *                                    --        commands ignored until end of
 *                                    --        transaction block
 *
 * So catching 23505 and simply re-issuing the statement does NOT work inside a
 * transaction — every later statement, including the retry and the COMMIT,
 * fails with a different and far more confusing error. Every Hub write path
 * runs inside `withTenantContext`, which opens an explicit transaction, so this
 * applies to all of them.
 *
 * A SAVEPOINT scopes the damage: rolling back to it un-aborts the transaction
 * and leaves everything written before it intact.
 *
 * This exists because `kg_entities` is UNIQUE (tenant_id, entity_type, name)
 * and several writers legitimately want the same human name — an asset's
 * identity node and a notebook's backing node are both entity_type='equipment',
 * and two machines can genuinely share a description.
 */
import type { PoolClient, QueryResult } from "pg";

let counter = 0;

/**
 * Run `sql` with `first`. If it raises a unique violation, roll back to the
 * savepoint and run it once more with `second`. Any other error propagates
 * with the transaction already rolled back to the savepoint, so the caller may
 * still handle it or roll back further.
 *
 * Returns the successful result, or throws the second attempt's error.
 */
export async function insertWithUniqueFallback<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  first: unknown[],
  second: unknown[],
): Promise<QueryResult<T>> {
  // Savepoint names are identifiers, not parameters — this one is generated,
  // never caller-supplied, so there is nothing to inject.
  const sp = `sp_uniq_${(counter = (counter + 1) % 1_000_000)}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const res = await client.query<T>(sql, first);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return res;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    if ((err as { code?: string })?.code !== "23505") {
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      throw err;
    }
    const res = await client.query<T>(sql, second);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return res;
  }
}
