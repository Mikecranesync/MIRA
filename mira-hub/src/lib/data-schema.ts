import pool from "@/lib/db";

let dataSchemaReady: Promise<void> | null = null;

/**
 * Idempotent Phase 2 migrations for tables created by mira-pipeline.
 * Called from ensureSchema() so every fresh deploy self-heals.
 * All operations are wrapped in try/catch — if a table doesn't exist yet
 * (e.g. first deploy before pipeline runs) the error is silently ignored.
 */
export function ensureDataSchema(): Promise<void> {
  if (dataSchemaReady) return dataSchemaReady;
  dataSchemaReady = (async () => {
    const pipelineTables = [
      "work_orders",
      "pm_schedules",
      "cmms_equipment",
      "kb_chunks",
      "telegram_messages",
    ] as const;

    for (const table of pipelineTables) {
      try {
        await pool.query(`
          ALTER TABLE ${table}
            ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'mike'
        `);
      } catch {
        // Table doesn't exist yet or column already correct — skip
      }
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_${table}_tenant
            ON ${table} (tenant_id)
        `);
      } catch {
        // Table doesn't exist yet — skip
      }
    }

    // pm_schedules had a nullable tenant_id in the original schema
    try {
      await pool.query(
        `UPDATE pm_schedules SET tenant_id = 'mike' WHERE tenant_id IS NULL`,
      );
      await pool.query(
        `ALTER TABLE pm_schedules ALTER COLUMN tenant_id SET NOT NULL`,
      );
    } catch {
      // Already NOT NULL or table doesn't exist
    }

    // Stamp the legacy 'mike' tenant with a human-readable slug
    try {
      await pool.query(
        `UPDATE hub_tenants SET slug = 'factorylm-default' WHERE id = 'mike' AND slug IS NULL`,
      );
    } catch {
      // Already set
    }
  })();
  return dataSchemaReady;
}
