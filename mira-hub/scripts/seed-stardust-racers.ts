#!/usr/bin/env bun
/**
 * Stardust Racers demo seed.
 *
 * Creates / upserts Stardust demo CMMS assets under the synthetic demo
 * tenant. Idempotent: re-running updates existing rows in place rather than
 * creating duplicates.
 *
 * Usage:
 *   bun run scripts/seed-stardust-racers.ts
 *
 * Required env:
 *   NEON_DATABASE_URL — NeonDB connection string
 *
 * Tenant: 00000000-0000-0000-0000-000000000099 (synthetic demo tenant
 * created by ``seed-synthetic-users.ts``). Run that script first if the
 * tenant doesn't already exist.
 */

import { Pool } from "pg";

export const SYNTH_TENANT_ID = "00000000-0000-0000-0000-000000000099";

export type StardustAsset = {
  id: string;
  equipment_number: string;
  description: string;
  manufacturer: string;
  model_number: string;
  serial_number: string;
  equipment_type: string;
  location: string;
  department: string;
  criticality: string;
  last_reported_fault: string;
  plc_tag: string;
  manufacturer_part_number: string;
  scada_path: string;
  uns_topic_path: string;
};

export const STARDUST_ASSETS: StardustAsset[] = [
  {
    id: "00000000-0000-0000-0000-0000000005a1",
    equipment_number: "SR-SUMP-001",
    description: "Stardust Racers - Sump Pump Duplex Panel",
    manufacturer: "Xylem",
    model_number: "Flygt FGC 411",
    serial_number: "SR-SUMP-001-2024",
    equipment_type: "Pump",
    location: "Stardust Racers - Pit B, Sub-pump room",
    department: "Ride Maintenance",
    criticality: "high",
    last_reported_fault: "Lead pump nuisance trip on overload - investigate motor current and seal water",
    plc_tag: "SUMP_001",
    manufacturer_part_number: "CR-15-3-A-F-A-E-HQQE",
    scada_path: "Site/StardustRacers/PitB/SumpPanel/SUMP_001",
    uns_topic_path: "factorylm/stardust-racers/pit-b/sump-panel/sump-001",
  },
  {
    id: "00000000-0000-0000-0000-0000000005b1",
    equipment_number: "SR-LAUNCH-1",
    description: "Stardust Racers - Launch 1 Block Zone",
    manufacturer: "Universal Creative",
    model_number: "LSM-BLOCK-ZONE",
    serial_number: "SR-LAUNCH-1-2024",
    equipment_type: "Ride Block Zone",
    location: "Stardust Racers - Launch 1",
    department: "Ride Maintenance",
    criticality: "critical",
    last_reported_fault: "Monitor proximity occupancy, LSM ready, magnetic brake ready, and latched faults",
    plc_tag: "stardust.launch_1",
    manufacturer_part_number: "SR-BLOCK-ZONE",
    scada_path: "Site/StardustRacers/Launch1",
    uns_topic_path: "factorylm/stardust-racers/launch-1",
  },
  {
    id: "00000000-0000-0000-0000-0000000005b2",
    equipment_number: "SR-LAUNCH-2",
    description: "Stardust Racers - Launch 2 Block Zone",
    manufacturer: "Universal Creative",
    model_number: "LSM-BLOCK-ZONE",
    serial_number: "SR-LAUNCH-2-2024",
    equipment_type: "Ride Block Zone",
    location: "Stardust Racers - Launch 2",
    department: "Ride Maintenance",
    criticality: "critical",
    last_reported_fault: "Monitor proximity occupancy, LSM ready, magnetic brake ready, and latched faults",
    plc_tag: "stardust.launch_2",
    manufacturer_part_number: "SR-BLOCK-ZONE",
    scada_path: "Site/StardustRacers/Launch2",
    uns_topic_path: "factorylm/stardust-racers/launch-2",
  },
  {
    id: "00000000-0000-0000-0000-0000000005b3",
    equipment_number: "SR-STATION-LOAD",
    description: "Stardust Racers - Station Load Block Zone",
    manufacturer: "Universal Creative",
    model_number: "STATION-BLOCK-ZONE",
    serial_number: "SR-STATION-LOAD-2024",
    equipment_type: "Ride Block Zone",
    location: "Stardust Racers - Load Station",
    department: "Ride Maintenance",
    criticality: "critical",
    last_reported_fault: "Monitor station occupancy, dispatch ready, magnetic brake ready, and latched faults",
    plc_tag: "stardust.station_load",
    manufacturer_part_number: "SR-STATION-ZONE",
    scada_path: "Site/StardustRacers/StationLoad",
    uns_topic_path: "factorylm/stardust-racers/station-load",
  },
  {
    id: "00000000-0000-0000-0000-0000000005b4",
    equipment_number: "SR-STATION-UNLOAD",
    description: "Stardust Racers - Station Unload Block Zone",
    manufacturer: "Universal Creative",
    model_number: "STATION-BLOCK-ZONE",
    serial_number: "SR-STATION-UNLOAD-2024",
    equipment_type: "Ride Block Zone",
    location: "Stardust Racers - Unload Station",
    department: "Ride Maintenance",
    criticality: "critical",
    last_reported_fault: "Monitor station occupancy, unload ready, magnetic brake ready, and latched faults",
    plc_tag: "stardust.station_unload",
    manufacturer_part_number: "SR-STATION-ZONE",
    scada_path: "Site/StardustRacers/StationUnload",
    uns_topic_path: "factorylm/stardust-racers/station-unload",
  },
];

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("NEON_DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    // The synthetic tenant must already exist (seed-synthetic-users.ts).
    const t = await client.query("SELECT 1 FROM hub_tenants WHERE id = $1", [SYNTH_TENANT_ID]);
    if (t.rowCount === 0) {
      console.error(
        `Synthetic demo tenant ${SYNTH_TENANT_ID} not found.\n` +
          "Run seed-synthetic-users.ts first.",
      );
      process.exit(1);
    }

    for (const asset of STARDUST_ASSETS) {
      await client.query(
        `INSERT INTO cmms_equipment
           (id, tenant_id, equipment_number, description, manufacturer, model_number,
            serial_number, equipment_type, location, department, criticality,
            last_reported_fault, qr_generated_at,
            plc_tag, manufacturer_part_number, scada_path, uns_topic_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::criticalitylevel,$12,NOW(),
                 $13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           equipment_number          = EXCLUDED.equipment_number,
           description               = EXCLUDED.description,
           manufacturer              = EXCLUDED.manufacturer,
           model_number              = EXCLUDED.model_number,
           serial_number             = EXCLUDED.serial_number,
           equipment_type            = EXCLUDED.equipment_type,
           location                  = EXCLUDED.location,
           department                = EXCLUDED.department,
           criticality               = EXCLUDED.criticality,
           last_reported_fault       = EXCLUDED.last_reported_fault,
           qr_generated_at           = COALESCE(cmms_equipment.qr_generated_at, EXCLUDED.qr_generated_at),
           plc_tag                   = EXCLUDED.plc_tag,
           manufacturer_part_number  = EXCLUDED.manufacturer_part_number,
           scada_path                = EXCLUDED.scada_path,
           uns_topic_path            = EXCLUDED.uns_topic_path`,
        [
          asset.id, SYNTH_TENANT_ID, asset.equipment_number, asset.description,
          asset.manufacturer, asset.model_number, asset.serial_number,
          asset.equipment_type, asset.location, asset.department,
          asset.criticality, asset.last_reported_fault,
          asset.plc_tag, asset.manufacturer_part_number,
          asset.scada_path, asset.uns_topic_path,
        ],
      );
    }

    const verify = await client.query(
      `SELECT equipment_number, manufacturer, model_number, qr_generated_at
         FROM cmms_equipment
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])
        ORDER BY equipment_number`,
      [SYNTH_TENANT_ID, STARDUST_ASSETS.map((asset) => asset.id)],
    );

    console.log("[seed] Stardust Racers assets ready:");
    for (const row of verify.rows) {
      console.log(`  ${row.equipment_number}: ${row.manufacturer} ${row.model_number}`);
    }
    console.log("");
    console.log("Demo URLs (need an enrolled session in the synth tenant):");
    console.log("  Mobile:   /m/<equipment_number>");
    console.log("  Telegram: https://t.me/<bot>?start=asset_<equipment_number>");
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("seed-stardust-racers.ts")) {
  main().catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  });
}
