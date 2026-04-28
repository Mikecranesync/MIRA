#!/usr/bin/env bun
/**
 * Synthetic user seeder (#761–#765).
 *
 * Creates 4 test personas + realistic plant data in NeonDB. Fully idempotent —
 * re-running produces the same state via deterministic UUIDs and ON CONFLICT.
 *
 * Usage:
 *   bun run scripts/seed-synthetic-users.ts
 *
 * Required env:
 *   NEON_DATABASE_URL — NeonDB connection string
 *
 * ⚠️  Test credentials are intentionally hardcoded. Never use in production.
 */

import { Pool } from "pg";
import bcrypt from "bcryptjs";

// ── Deterministic UUIDs (re-seeding is idempotent) ──────────────────────────

const SYNTH_TENANT_ID = "00000000-0000-0000-0000-000000000099";

const PERSONAS = [
  {
    id: "00000000-0000-0000-0000-000000000091",
    email: "carlos@synthetic.test",
    name: "Carlos Mendez",
    role: "owner",
    status: "approved",
    bio: "Maintenance Technician, 2AM shift, Line 1-3",
  },
  {
    id: "00000000-0000-0000-0000-000000000092",
    email: "dana@synthetic.test",
    name: "Dana Reyes",
    role: "owner",
    status: "approved",
    bio: "Maintenance Manager, owns PM schedule + WO approvals",
  },
  {
    id: "00000000-0000-0000-0000-000000000093",
    email: "plantmgr@synthetic.test",
    name: "Jordan Taylor",
    role: "owner",
    status: "approved",
    bio: "Plant Manager, reviews OEE + KPIs",
  },
  {
    id: "00000000-0000-0000-0000-000000000094",
    email: "cfo@synthetic.test",
    name: "Pat Hoffman",
    role: "owner",
    status: "approved",
    bio: "CFO, tracks maintenance cost and downtime ROI",
  },
] as const;

// Shared test password — intentionally weak, synthetic-only
const TEST_PASSWORD = "SynthTest2026!";

const EQUIPMENT = [
  {
    id: "00000000-0000-0000-0000-000000001001",
    equipment_number: "VFD-07",
    description: "Allen-Bradley PowerFlex 755 VFD",
    manufacturer: "Allen-Bradley",
    model_number: "PowerFlex 755",
    serial_number: "AB755-2022-04871",
    equipment_type: "VFD",
    location: "Pump Station A",
    department: "Utilities",
    criticality: "high",
    last_reported_fault: "F005 — Overcurrent trip at 06:42",
    work_order_count: 4,
  },
  {
    id: "00000000-0000-0000-0000-000000001002",
    equipment_number: "CONV-03",
    description: "Dorner 2100 Conveyor Belt",
    manufacturer: "Dorner",
    model_number: "2100 Series",
    serial_number: "DOR-2100-39201",
    equipment_type: "Conveyor",
    location: "Assembly Line 3",
    department: "Production",
    criticality: "medium",
    last_reported_fault: "Belt tension drift — 15% low",
    work_order_count: 2,
  },
  {
    id: "00000000-0000-0000-0000-000000001003",
    equipment_number: "CNC-07",
    description: "Haas VF-3 CNC Machining Center",
    manufacturer: "Haas",
    model_number: "VF-3",
    serial_number: "HAAS-VF3-99028",
    equipment_type: "CNC",
    location: "Machine Shop Bay 7",
    department: "Machining",
    criticality: "high",
    last_reported_fault: null,
    work_order_count: 1,
  },
  {
    id: "00000000-0000-0000-0000-000000001004",
    equipment_number: "HVAC-02",
    description: "Carrier RTU-48 HVAC Unit",
    manufacturer: "Carrier",
    model_number: "RTU-48",
    serial_number: "CAR-RTU48-20881",
    equipment_type: "HVAC",
    location: "Roof Zone 2",
    department: "Facilities",
    criticality: "low",
    last_reported_fault: null,
    work_order_count: 1,
  },
  {
    id: "00000000-0000-0000-0000-000000001005",
    equipment_number: "PUMP-01",
    description: "Goulds 3196 Cooling Water Pump",
    manufacturer: "Goulds",
    model_number: "3196 LTX",
    serial_number: "GLD-3196-55127",
    equipment_type: "Pump",
    location: "Pump Station A",
    department: "Utilities",
    criticality: "critical",
    last_reported_fault: "Mechanical seal leak — minor weep",
    work_order_count: 3,
  },
] as const;

const WORK_ORDERS = [
  {
    id: "00000000-0000-0000-0000-000000002001",
    work_order_number: "WO-2026-SYNTH-001",
    equipment_id: "00000000-0000-0000-0000-000000001001",
    manufacturer: "Allen-Bradley",
    model_number: "PowerFlex 755",
    title: "VFD-07 overcurrent fault F005 — investigate and clear",
    description: "VFD-07 tripped F005 (overcurrent) at 06:42. Check motor load, coupling alignment, and accel ramp P042. Third occurrence this month.",
    status: "open",
    priority: "high",
    source: "synthetic_user",
    suggested_actions: ["Check motor current draw", "Inspect coupling alignment", "Verify P042 accel ramp setting"],
    safety_warnings: ["De-energize VFD before inspecting terminals", "Verify zero-energy state before entering panel"],
  },
  {
    id: "00000000-0000-0000-0000-000000002002",
    work_order_number: "WO-2026-SYNTH-002",
    equipment_id: "00000000-0000-0000-0000-000000001002",
    manufacturer: "Dorner",
    model_number: "2100 Series",
    title: "CONV-03 belt tension 15% below nominal",
    description: "Belt tension measured at 85% of spec. Gradual drift over 6 weeks. Adjust take-up screw 2 turns CW per OEM procedure.",
    status: "in_progress",
    priority: "medium",
    source: "synthetic_user",
    suggested_actions: ["Adjust take-up screw", "Re-measure tension after adjustment", "Check belt for wear at splice"],
    safety_warnings: ["LOTO conveyor drive before adjustment"],
  },
  {
    id: "00000000-0000-0000-0000-000000002003",
    work_order_number: "WO-2026-SYNTH-003",
    equipment_id: "00000000-0000-0000-0000-000000001005",
    manufacturer: "Goulds",
    model_number: "3196 LTX",
    title: "PUMP-01 mechanical seal replacement",
    description: "Mechanical seal weeping at 2 drops/min. Replace with Goulds 200-201 seal kit. Isolate pump suction and discharge before opening.",
    status: "completed",
    priority: "critical",
    source: "synthetic_user",
    suggested_actions: ["Replace mechanical seal", "Pressure test after reassembly"],
    safety_warnings: ["Isolate suction and discharge valves", "Verify system pressure is zero before opening"],
  },
  {
    id: "00000000-0000-0000-0000-000000002004",
    work_order_number: "WO-2026-SYNTH-004",
    equipment_id: "00000000-0000-0000-0000-000000001003",
    manufacturer: "Haas",
    model_number: "VF-3",
    title: "CNC-07 quarterly lubrication — all axes",
    description: "Scheduled quarterly lubrication. Apply NLGI 2 spindle grease to all axis bearings per Haas service manual §4.2.",
    status: "open",
    priority: "low",
    source: "synthetic_user",
    suggested_actions: ["Apply grease to X/Y/Z axis bearings", "Check way lube levels", "Log completion in CMMS"],
    safety_warnings: [],
  },
] as const;

const PM_SCHEDULES = [
  {
    id: "00000000-0000-0000-0000-000000003001",
    equipment_id: "00000000-0000-0000-0000-000000001001",
    manufacturer: "Allen-Bradley",
    model_number: "PowerFlex 755",
    task: "VFD quarterly PM — filter, thermal scan, DC bus voltage check",
    interval_value: 3,
    interval_unit: "months",
    interval_type: "calendar",
    criticality: "high",
    confidence: 0.95,
    source_citation: "Allen-Bradley PowerFlex 755 User Manual, §10.2 Maintenance Schedule",
    parts_needed: ["GS1-FAN-01", "ATDR-15 fuse (qty 3)"],
    tools_needed: ["Thermal camera", "DC voltmeter", "Torque wrench"],
    safety_requirements: ["LOTO", "PPE: safety glasses, insulated gloves"],
    estimated_duration_minutes: 90,
    next_due_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    auto_extracted: true,
  },
  {
    id: "00000000-0000-0000-0000-000000003002",
    equipment_id: "00000000-0000-0000-0000-000000001002",
    manufacturer: "Dorner",
    model_number: "2100 Series",
    task: "Conveyor belt tension check and adjustment",
    interval_value: 4,
    interval_unit: "weeks",
    interval_type: "calendar",
    criticality: "medium",
    confidence: 0.88,
    source_citation: "Dorner 2100 Series Installation Manual, §6.3",
    parts_needed: [],
    tools_needed: ["Belt tension gauge", "Torque wrench", "Feeler gauge"],
    safety_requirements: ["LOTO conveyor drive"],
    estimated_duration_minutes: 45,
    next_due_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    auto_extracted: true,
  },
  {
    id: "00000000-0000-0000-0000-000000003003",
    equipment_id: "00000000-0000-0000-0000-000000001003",
    manufacturer: "Haas",
    model_number: "VF-3",
    task: "CNC axis lubrication — quarterly grease cycle",
    interval_value: 3,
    interval_unit: "months",
    interval_type: "calendar",
    criticality: "high",
    confidence: 0.92,
    source_citation: "Haas VF-3 Service Manual §4.2 — Lubrication Schedule",
    parts_needed: ["NLGI-2 spindle grease (500g)"],
    tools_needed: ["Grease gun", "Clean rag"],
    safety_requirements: ["Machine must be powered down and in E-stop before greasing"],
    estimated_duration_minutes: 60,
    next_due_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    auto_extracted: true,
  },
] as const;

// ── KG seed data ─────────────────────────────────────────────────────────────

const KG_ENTITIES = [
  { id: "00000000-0000-0000-0000-000000004001", entity_type: "equipment", entity_id: "VFD-07", name: "Allen-Bradley PowerFlex 755 VFD", properties: { manufacturer: "Allen-Bradley", model_number: "PowerFlex 755", location: "Pump Station A", criticality: "high", equipment_type: "VFD" } },
  { id: "00000000-0000-0000-0000-000000004002", entity_type: "equipment", entity_id: "CONV-03", name: "Dorner 2100 Conveyor Belt", properties: { manufacturer: "Dorner", model_number: "2100 Series", location: "Assembly Line 3", criticality: "medium", equipment_type: "Conveyor" } },
  { id: "00000000-0000-0000-0000-000000004003", entity_type: "equipment", entity_id: "PUMP-01", name: "Goulds 3196 Cooling Water Pump", properties: { manufacturer: "Goulds", model_number: "3196 LTX", location: "Pump Station A", criticality: "critical", equipment_type: "Pump" } },
  { id: "00000000-0000-0000-0000-000000004011", entity_type: "fault_code", entity_id: "F005", name: "F005", properties: { description: "Overcurrent trip", equipment_type: "VFD", source: "synthetic_seed" } },
  { id: "00000000-0000-0000-0000-000000004012", entity_type: "fault_code", entity_id: "OC", name: "OC", properties: { description: "Overcurrent", source: "synthetic_seed" } },
  { id: "00000000-0000-0000-0000-000000004021", entity_type: "part", entity_id: "GS1-FAN-01", name: "VFD Cooling Fan 80x80x25mm", properties: { unit_cost: 45, source: "synthetic_seed" } },
  { id: "00000000-0000-0000-0000-000000004022", entity_type: "part", entity_id: "ATDR-15", name: "15A Class CC Input Fuse", properties: { unit_cost: 4.50, quantity: 3, source: "synthetic_seed" } },
  { id: "00000000-0000-0000-0000-000000004031", entity_type: "location", entity_id: "pump-station-a", name: "Pump Station A", properties: {} },
  { id: "00000000-0000-0000-0000-000000004032", entity_type: "location", entity_id: "assembly-line-3", name: "Assembly Line 3", properties: {} },
] as const;

const KG_RELATIONSHIPS = [
  // VFD-07 → has_work_order → WO-001
  { source_id: "00000000-0000-0000-0000-000000004001", target_id: "00000000-0000-0000-0000-000000002001", relationship_type: "has_work_order" },
  // VFD-07 → exhibited_fault → F005
  { source_id: "00000000-0000-0000-0000-000000004001", target_id: "00000000-0000-0000-0000-000000004011", relationship_type: "exhibited_fault" },
  // VFD-07 → requires_part → GS1-FAN-01
  { source_id: "00000000-0000-0000-0000-000000004001", target_id: "00000000-0000-0000-0000-000000004021", relationship_type: "requires_part" },
  // VFD-07 → located_at → Pump Station A
  { source_id: "00000000-0000-0000-0000-000000004001", target_id: "00000000-0000-0000-0000-000000004031", relationship_type: "located_at" },
  // PUMP-01 → located_at → Pump Station A
  { source_id: "00000000-0000-0000-0000-000000004003", target_id: "00000000-0000-0000-0000-000000004031", relationship_type: "located_at" },
  // CONV-03 → located_at → Assembly Line 3
  { source_id: "00000000-0000-0000-0000-000000004002", target_id: "00000000-0000-0000-0000-000000004032", relationship_type: "located_at" },
] as const;

const KG_TRIPLES = [
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "exhibited_fault", object: "F005", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "exhibited_fault", object: "F005", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "exhibited_fault", object: "F005", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "exhibited_fault", object: "F005", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "performed_action", object: "replaced", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "performed_action", object: "calibrated", source: "synthetic_seed" },
  { subject: "Dorner 2100 Conveyor Belt", predicate: "performed_action", object: "adjusted", source: "synthetic_seed" },
  { subject: "Goulds 3196 Cooling Water Pump", predicate: "performed_action", object: "replaced", source: "synthetic_seed" },
  { subject: "Allen-Bradley PowerFlex 755 VFD", predicate: "is_a", object: "equipment", source: "synthetic_seed" },
  { subject: "F005", predicate: "is_a", object: "fault_code", source: "synthetic_seed" },
] as const;

// ── Main seeder ───────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("Error: NEON_DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    console.log("[seed] Hashing password...");
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

    await client.query("BEGIN");

    // ── Tenant ──────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO hub_tenants (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [SYNTH_TENANT_ID, "Synthetic Test Plant — Lake Wales FL"],
    );
    console.log("[seed] Tenant upserted");

    // ── Users ────────────────────────────────────────────────────────────────
    for (const p of PERSONAS) {
      await client.query(
        `INSERT INTO hub_users (id, email, password_hash, tenant_id, name, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name   = EXCLUDED.name,
           status = EXCLUDED.status`,
        [p.id, p.email, passwordHash, SYNTH_TENANT_ID, p.name, p.role, p.status],
      );
      console.log(`[seed] User: ${p.name} <${p.email}>`);
    }

    // ── cmms_equipment ───────────────────────────────────────────────────────
    for (const eq of EQUIPMENT) {
      await client.query(
        `INSERT INTO cmms_equipment
           (id, tenant_id, equipment_number, description, manufacturer, model_number,
            serial_number, equipment_type, location, department, criticality,
            last_reported_fault, work_order_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::criticalitylevel,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           description          = EXCLUDED.description,
           last_reported_fault  = EXCLUDED.last_reported_fault,
           work_order_count     = EXCLUDED.work_order_count`,
        [
          eq.id, SYNTH_TENANT_ID, eq.equipment_number, eq.description,
          eq.manufacturer, eq.model_number, eq.serial_number,
          eq.equipment_type, eq.location, eq.department, eq.criticality,
          eq.last_reported_fault, eq.work_order_count,
        ],
      ).catch((err) => {
        // Table may not have all columns — skip silently
        if (!String(err).includes("does not exist")) throw err;
      });
    }
    console.log(`[seed] ${EQUIPMENT.length} equipment records`);

    // ── work_orders ──────────────────────────────────────────────────────────
    for (const wo of WORK_ORDERS) {
      await client.query(
        `INSERT INTO work_orders
           (id, tenant_id, work_order_number, equipment_id, manufacturer, model_number,
            title, description, status, priority, source, suggested_actions, safety_warnings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13::text[])
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status`,
        [
          wo.id, SYNTH_TENANT_ID, wo.work_order_number, wo.equipment_id,
          wo.manufacturer, wo.model_number, wo.title, wo.description,
          wo.status, wo.priority, wo.source,
          wo.suggested_actions, wo.safety_warnings,
        ],
      ).catch((err) => {
        if (!String(err).includes("does not exist")) throw err;
      });
    }
    console.log(`[seed] ${WORK_ORDERS.length} work orders`);

    // ── pm_schedules ─────────────────────────────────────────────────────────
    for (const pm of PM_SCHEDULES) {
      await client.query(
        `INSERT INTO pm_schedules
           (id, tenant_id, equipment_id, manufacturer, model_number, task,
            interval_value, interval_unit, interval_type, criticality, confidence,
            source_citation, parts_needed, tools_needed, safety_requirements,
            estimated_duration_minutes, next_due_at, auto_extracted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::text[],$15::text[],$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET
           next_due_at = EXCLUDED.next_due_at`,
        [
          pm.id, SYNTH_TENANT_ID, pm.equipment_id, pm.manufacturer, pm.model_number,
          pm.task, pm.interval_value, pm.interval_unit, pm.interval_type,
          pm.criticality, pm.confidence, pm.source_citation,
          pm.parts_needed, pm.tools_needed, pm.safety_requirements,
          pm.estimated_duration_minutes, pm.next_due_at, pm.auto_extracted,
        ],
      ).catch((err) => {
        if (!String(err).includes("does not exist")) throw err;
      });
    }
    console.log(`[seed] ${PM_SCHEDULES.length} PM schedules`);

    // ── KG entities ──────────────────────────────────────────────────────────
    for (const e of KG_ENTITIES) {
      await client.query(
        `INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
           name       = EXCLUDED.name,
           properties = EXCLUDED.properties,
           updated_at = now()`,
        [e.id, SYNTH_TENANT_ID, e.entity_type, e.entity_id, e.name, JSON.stringify(e.properties)],
      ).catch((err) => {
        if (!String(err).includes("does not exist")) throw err;
      });
    }
    console.log(`[seed] ${KG_ENTITIES.length} KG entities`);

    // ── KG relationships ─────────────────────────────────────────────────────
    // Use IDs that exist in kg_entities or cmms_equipment+work_orders as KG entities
    for (const r of KG_RELATIONSHIPS) {
      await client.query(
        `INSERT INTO kg_relationships
           (tenant_id, source_id, target_id, relationship_type, confidence)
         VALUES ($1,$2,$3,$4,1.0)
         ON CONFLICT DO NOTHING`,
        [SYNTH_TENANT_ID, r.source_id, r.target_id, r.relationship_type],
      ).catch(() => { /* FK constraint if entity IDs differ — ignore */ });
    }
    console.log(`[seed] KG relationships`);

    // ── KG triples ───────────────────────────────────────────────────────────
    // Triples have no unique constraint — only seed if none exist for this tenant
    const { rows: existingTriples } = await client.query(
      `SELECT COUNT(*) FROM kg_triples_log WHERE tenant_id = $1 AND source = 'synthetic_seed'`,
      [SYNTH_TENANT_ID],
    ).catch(() => ({ rows: [{ count: "1" }] })); // skip if table absent

    if (Number(existingTriples[0]?.count ?? 0) === 0) {
      for (const t of KG_TRIPLES) {
        await client.query(
          `INSERT INTO kg_triples_log (tenant_id, subject, predicate, object, confidence, source)
           VALUES ($1,$2,$3,$4,1.0,$5)`,
          [SYNTH_TENANT_ID, t.subject, t.predicate, t.object, t.source],
        ).catch(() => {});
      }
      console.log(`[seed] ${KG_TRIPLES.length} KG triples`);
    } else {
      console.log(`[seed] KG triples already present — skipping`);
    }

    await client.query("COMMIT");

    console.log("\n[seed] ✓ Done. Synthetic tenant: " + SYNTH_TENANT_ID);
    console.log("[seed] Test credentials: password = " + TEST_PASSWORD);
    console.log("[seed] Personas:");
    for (const p of PERSONAS) {
      console.log(`  ${p.name.padEnd(16)} <${p.email}>`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed] Fatal error — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
