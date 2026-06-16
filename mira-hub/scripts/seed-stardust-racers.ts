#!/usr/bin/env bun
/**
 * Stardust Racers demo seed — single asset for the expo demo.
 *
 * Creates / upserts ``SR-SUMP-001`` (Xylem/Flygt duplex sump pump panel)
 * under the synthetic demo tenant. Idempotent: re-running updates the
 * existing row in place rather than creating duplicates.
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

const SYNTH_TENANT_ID = "00000000-0000-0000-0000-000000000099";
const SR_SUMP_ID = "00000000-0000-0000-0000-0000000005a1";

const SR_SUMP = {
  id: SR_SUMP_ID,
  equipment_number: "SR-SUMP-001",
  description: "Stardust Racers — Sump Pump Duplex Panel",
  manufacturer: "Xylem",
  model_number: "Flygt FGC 411",
  serial_number: "SR-SUMP-001-2024",
  equipment_type: "Pump",
  location: "Stardust Racers — Pit B, Sub-pump room",
  department: "Ride Maintenance",
  criticality: "high",
  last_reported_fault: "Lead pump nuisance trip on overload — investigate motor current and seal water",
  // External IDs (CRA-258) — demonstrates i3X cross-system interop.
  plc_tag: "SUMP_001",
  manufacturer_part_number: "CR-15-3-A-F-A-E-HQQE",
  scada_path: "Site/StardustRacers/PitB/SumpPanel/SUMP_001",
  uns_topic_path: "factorylm/stardust-racers/pit-b/sump-panel/sump-001",
};

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
        SR_SUMP.id, SYNTH_TENANT_ID, SR_SUMP.equipment_number, SR_SUMP.description,
        SR_SUMP.manufacturer, SR_SUMP.model_number, SR_SUMP.serial_number,
        SR_SUMP.equipment_type, SR_SUMP.location, SR_SUMP.department,
        SR_SUMP.criticality, SR_SUMP.last_reported_fault,
        SR_SUMP.plc_tag, SR_SUMP.manufacturer_part_number,
        SR_SUMP.scada_path, SR_SUMP.uns_topic_path,
      ],
    );

    const verify = await client.query(
      `SELECT equipment_number, manufacturer, model_number, qr_generated_at
         FROM cmms_equipment
        WHERE id = $1`,
      [SR_SUMP.id],
    );
    const row = verify.rows[0];
    console.log("[seed] Stardust Racers asset ready:");
    console.log(`  tag:        ${row.equipment_number}`);
    console.log(`  make/model: ${row.manufacturer} ${row.model_number}`);
    console.log(`  qr bound:   ${row.qr_generated_at}`);
    console.log("");
    console.log("Demo URLs (need an enrolled session in the synth tenant):");
    console.log(`  Mobile:   /m/${row.equipment_number}`);
    console.log(`  Telegram: https://t.me/<bot>?start=asset_${row.equipment_number}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
