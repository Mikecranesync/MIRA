#!/usr/bin/env bun
/**
 * Seed live one-board telemetry for the synthetic demo tenant.
 *
 * Usage:
 *   bun run scripts/seed-demo-signals.ts
 *
 * Required env:
 *   NEON_DATABASE_URL
 *
 * Optional env:
 *   SYNTH_TENANT_ID (defaults to the synthetic demo tenant)
 */

import { Pool } from "pg";

export const DEFAULT_SYNTH_TENANT_ID = "00000000-0000-0000-0000-000000000099";
export const SYNTH_TENANT_ID = process.env.SYNTH_TENANT_ID || DEFAULT_SYNTH_TENANT_ID;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LTREE_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export type DemoSignalRow = {
  plcTag: string;
  value: string | number | boolean;
  unsPath: string;
};

type QueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number | null }>;
};

const STARDUST_ZONES = ["launch_1", "launch_2", "station_load", "station_unload"] as const;
const STARDUST_SIGNALS = ["block_occupied", "lsm_ready", "brake_ready", "fault_latched"] as const;

export const REQUIRED_DEMO_TAGS = new Set<string>([
  "conv_simple.motor_run",
  "conv_simple.vfd_speed_hz",
  "conv_simple.vfd_current_amps",
  "conv_simple.fault_code",
  "conv_simple.comm_ok",
  "conv_simple.height_sensor_mm",
  "conv_simple.sort_divert_active",
  ...STARDUST_ZONES.flatMap((zone) =>
    STARDUST_SIGNALS.map((signal) => `stardust.${zone}.${signal}`),
  ),
]);

export const DEMO_SIGNAL_ROWS: DemoSignalRow[] = [
  {
    plcTag: "conv_simple.motor_run",
    value: true,
    unsPath: "enterprise.demo.conveyor.conv_simple.motor_run",
  },
  {
    plcTag: "conv_simple.vfd_speed_hz",
    value: 30,
    unsPath: "enterprise.demo.conveyor.conv_simple.vfd_speed_hz",
  },
  {
    plcTag: "conv_simple.vfd_current_amps",
    value: 2.4,
    unsPath: "enterprise.demo.conveyor.conv_simple.vfd_current_amps",
  },
  {
    plcTag: "conv_simple.fault_code",
    value: 0,
    unsPath: "enterprise.demo.conveyor.conv_simple.fault_code",
  },
  {
    plcTag: "conv_simple.comm_ok",
    value: true,
    unsPath: "enterprise.demo.conveyor.conv_simple.comm_ok",
  },
  {
    plcTag: "conv_simple.height_sensor_mm",
    value: 114,
    unsPath: "enterprise.demo.conveyor.conv_simple.height_sensor_mm",
  },
  {
    plcTag: "conv_simple.sort_divert_active",
    value: false,
    unsPath: "enterprise.demo.conveyor.conv_simple.sort_divert_active",
  },
  ...[
    ["launch_1", true, false, true, false],
    ["launch_2", false, true, true, false],
    ["station_load", false, true, true, false],
    ["station_unload", false, false, false, true],
  ].flatMap(([zone, blockOccupied, lsmReady, brakeReady, faultLatched]) => [
    {
      plcTag: `stardust.${zone}.block_occupied`,
      value: blockOccupied,
      unsPath: `enterprise.demo.stardust.${zone}.block_occupied`,
    },
    {
      plcTag: `stardust.${zone}.lsm_ready`,
      value: lsmReady,
      unsPath: `enterprise.demo.stardust.${zone}.lsm_ready`,
    },
    {
      plcTag: `stardust.${zone}.brake_ready`,
      value: brakeReady,
      unsPath: `enterprise.demo.stardust.${zone}.brake_ready`,
    },
    {
      plcTag: `stardust.${zone}.fault_latched`,
      value: faultLatched,
      unsPath: `enterprise.demo.stardust.${zone}.fault_latched`,
    },
  ] as DemoSignalRow[]),
];

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function normalizeSourceTagPath(sourceTagPath: unknown) {
  if (typeof sourceTagPath !== "string" || sourceTagPath.trim() === "") {
    throw new Error("sourceTagPath must be a non-empty string");
  }
  return sourceTagPath.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function valueColumns(value: string | number | boolean) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("numeric demo signal values must be finite");
  }

  return {
    text: typeof value === "string" ? value : null,
    numeric: typeof value === "number" ? value : null,
    bool: typeof value === "boolean" ? value : null,
  };
}

export function validateSyntheticTenantId(tenantId: string) {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`SYNTH_TENANT_ID must be a UUID, received: ${tenantId}`);
  }
}

export function validateDemoSignalRow(row: unknown): DemoSignalRow {
  if (!row || typeof row !== "object") {
    throw new Error("demo signal row must be an object");
  }

  const candidate = row as Partial<DemoSignalRow>;
  if (typeof candidate.plcTag !== "string" || candidate.plcTag.trim() === "") {
    throw new Error("demo signal row plcTag must be a non-empty string");
  }
  const value = candidate.value;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(`demo signal row ${candidate.plcTag} value must be string, number, or boolean`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`demo signal row ${candidate.plcTag} numeric value must be finite`);
  }
  if (typeof candidate.unsPath !== "string" || !LTREE_RE.test(candidate.unsPath)) {
    throw new Error(`demo signal row ${candidate.plcTag} unsPath must be ltree-safe`);
  }

  return {
    plcTag: candidate.plcTag,
    value,
    unsPath: candidate.unsPath,
  };
}

function assertQueryClient(client: QueryClient) {
  if (!client || typeof client.query !== "function") {
    throw new Error("seed-demo-signals requires a pg client with a query method");
  }
}

async function seedRow(client: QueryClient, row: DemoSignalRow) {
  assertQueryClient(client);
  const validRow = validateDemoSignalRow(row);
  const value = valueColumns(validRow.value);
  const properties = JSON.stringify({ seeded_by: "seed-demo-signals.ts" });

  try {
    await client.query(
      `INSERT INTO approved_tags
         (tenant_id, source_system, source_tag_path, normalized_tag_path, uns_path, enabled, notes)
       VALUES ($1::uuid, 'simulator', $2, $3, $4::ltree, true, 'Seeded by seed-demo-signals.ts')
       ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE SET
         normalized_tag_path = EXCLUDED.normalized_tag_path,
         uns_path = EXCLUDED.uns_path,
         enabled = true,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [SYNTH_TENANT_ID, validRow.plcTag, normalizeSourceTagPath(validRow.plcTag), validRow.unsPath],
    );

    await client.query(
      `INSERT INTO live_signal_cache
         (tenant_id, plc_tag,
          last_value_text, last_value_numeric, last_value_bool,
          simulated, source, properties,
          uns_path, source_system, latest_quality, freshness_status,
          expected_freshness_seconds, last_seen_at, last_changed_at)
       VALUES ($1::uuid, $2, $3, $4, $5, true, 'demo_simulator', $6::jsonb,
               $7::ltree, 'simulator', 'good', 'simulated', 60, now(), now())
       ON CONFLICT (tenant_id, plc_tag) DO UPDATE SET
         last_value_text = EXCLUDED.last_value_text,
         last_value_numeric = EXCLUDED.last_value_numeric,
         last_value_bool = EXCLUDED.last_value_bool,
         simulated = EXCLUDED.simulated,
         source = EXCLUDED.source,
         properties = EXCLUDED.properties,
         uns_path = EXCLUDED.uns_path,
         source_system = EXCLUDED.source_system,
         latest_quality = EXCLUDED.latest_quality,
         freshness_status = EXCLUDED.freshness_status,
         expected_freshness_seconds = EXCLUDED.expected_freshness_seconds,
         last_seen_at = now(),
         last_changed_at = now(),
         updated_at = now()`,
      [
        SYNTH_TENANT_ID,
        validRow.plcTag,
        value.text,
        value.numeric,
        value.bool,
        properties,
        validRow.unsPath,
      ],
    );
  } catch (err) {
    throw new Error(`Failed to seed demo signal ${validRow.plcTag}: ${errorMessage(err)}`);
  }
}

export async function seedDemoSignals(connectionString: string) {
  validateSyntheticTenantId(SYNTH_TENANT_ID);
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  let client: (QueryClient & { release: () => void }) | undefined;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const tenant = await client.query("SELECT 1 FROM hub_tenants WHERE id = $1", [SYNTH_TENANT_ID]);
    if (tenant.rowCount === 0) {
      throw new Error(`Synthetic demo tenant ${SYNTH_TENANT_ID} not found. Run seed-synthetic-users.ts first.`);
    }

    for (const row of DEMO_SIGNAL_ROWS) {
      await seedRow(client, row);
    }

    await client.query("COMMIT");
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("[seed] rollback failed:", rollbackErr);
      });
    }
    throw err;
  } finally {
    client?.release();
    await pool.end();
  }
}

export async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("NEON_DATABASE_URL is required");
    process.exit(1);
  }

  await seedDemoSignals(url);
  console.log(`[seed] Demo signals ready: ${DEMO_SIGNAL_ROWS.length} canonical tags`);
}

if (process.argv[1]?.endsWith("seed-demo-signals.ts")) {
  main().catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  });
}
