#!/usr/bin/env bun
/**
 * Operator-run QA factory provisioner.
 *
 * This creates or refreshes a small approved QA tenant with four persona logins
 * and enough conveyor/VFD data for the synthetic-day Playwright suite.
 *
 * Safety rules:
 * - Dry-run by default: all writes are rolled back unless QA_FACTORY_APPLY=1.
 * - Production apply requires QA_FACTORY_CONFIRM=PROVISION_QA_FACTORY_PROD.
 * - Passwords come from env only, must be strong, and are never printed.
 * - Production refuses @synthetic.test emails and the weak local seed password.
 *
 * Example dry-run:
 *   doppler run --project factorylm --config prd -- \
 *     bun run scripts/provision-qa-factory.ts
 *
 * Example apply:
 *   QA_FACTORY_APPLY=1 QA_FACTORY_CONFIRM=PROVISION_QA_FACTORY_PROD \
 *   SYNTHETIC_CARLOS_EMAIL=qa+carlos@factorylm.com SYNTHETIC_CARLOS_PASSWORD='...' \
 *   SYNTHETIC_DANA_EMAIL=qa+dana@factorylm.com SYNTHETIC_DANA_PASSWORD='...' \
 *   SYNTHETIC_PLANTMGR_EMAIL=qa+plantmgr@factorylm.com SYNTHETIC_PLANTMGR_PASSWORD='...' \
 *   SYNTHETIC_CFO_EMAIL=qa+cfo@factorylm.com SYNTHETIC_CFO_PASSWORD='...' \
 *   doppler run --project factorylm --config prd -- \
 *     bun run scripts/provision-qa-factory.ts
 */

import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";

type PersonaKey = "CARLOS" | "DANA" | "PLANTMGR" | "CFO";

interface Persona {
  key: PersonaKey;
  id: string;
  emailEnv: string;
  passwordEnv: string;
  email: string;
  password: string;
  name: string;
  roleLabel: string;
}

const LOCAL_WEAK_PASSWORD = "SynthTest2026!";
const CONFIRM_TOKEN = "PROVISION_QA_FACTORY_PROD";
const TARGET = (process.env.QA_FACTORY_TARGET ?? process.env.DOPPLER_CONFIG ?? "dev").toLowerCase();
const IS_PROD = ["prd", "prod", "production"].includes(TARGET);
const APPLY = process.env.QA_FACTORY_APPLY === "1";
const TENANT_ID = process.env.QA_FACTORY_TENANT_ID ?? "00000000-0000-0000-0000-000000000199";
const TENANT_NAME = process.env.QA_FACTORY_TENANT_NAME ?? "FactoryLM QA Conveyor Plant";

const EQUIPMENT = [
  {
    id: "00000000-0000-0000-0000-000000002001",
    number: "CONV-QA-01",
    description: "QA Conveyor - Zone 2 belt",
    manufacturer: "Dorner",
    model: "2100 Series",
    serial: "QA-CONV-2100-001",
    type: "Conveyor",
    location: "QA Line 1 / Zone 2",
    department: "Packaging",
    criticality: "medium",
    fault: "Stopped with both photoeyes blocked; VFD output 0 Hz / 0.2 A",
    woCount: 2,
  },
  {
    id: "00000000-0000-0000-0000-000000002002",
    number: "VFD-QA-01",
    description: "QA Conveyor GS20 VFD",
    manufacturer: "AutomationDirect",
    model: "GS20",
    serial: "QA-GS20-001",
    type: "VFD",
    location: "QA Line 1 / MCC",
    department: "Packaging",
    criticality: "high",
    fault: "No active fault; output frequency is 0 Hz",
    woCount: 1,
  },
] as const;

const WORK_ORDERS = [
  {
    id: "00000000-0000-0000-0000-000000003001",
    number: "QA-WO-1001",
    equipmentId: EQUIPMENT[0].id,
    manufacturer: "Dorner",
    model: "2100 Series",
    title: "Investigate conveyor stopped in Zone 2",
    description: "Both photoeyes are blocked and the belt is stopped. Check for a physical jam before resetting.",
    status: "open",
    priority: "high",
    source: "qa_factory_provisioner",
    actions: ["Apply LOTO before reaching into the conveyor", "Inspect belt and side guides for obstruction"],
    safety: ["De-energize before clearing jams", "Verify zero energy before hands-in-machine work"],
  },
  {
    id: "00000000-0000-0000-0000-000000003002",
    number: "QA-WO-1002",
    equipmentId: EQUIPMENT[1].id,
    manufacturer: "AutomationDirect",
    model: "GS20",
    title: "Verify VFD status for conveyor stop",
    description: "Confirm output Hz, output amps, and active fault code before replacing sensors.",
    status: "in_progress",
    priority: "medium",
    source: "qa_factory_provisioner",
    actions: ["Read VFD output frequency", "Read output current", "Confirm fault code register"],
    safety: ["Qualified electrical work only"],
  },
] as const;

const PM_SCHEDULES = [
  {
    id: "00000000-0000-0000-0000-000000004001",
    equipmentId: EQUIPMENT[0].id,
    manufacturer: "Dorner",
    model: "2100 Series",
    task: "Inspect conveyor belt tracking and tension",
    intervalValue: 1,
    intervalUnit: "week",
    intervalType: "calendar",
    criticality: "medium",
    confidence: 0.9,
    sourceCitation: "QA conveyor demo checklist",
    parts: ["belt splice kit"],
    tools: ["tension gauge", "flashlight"],
    safety: ["LOTO before guard removal"],
    durationMinutes: 30,
  },
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function persona(key: PersonaKey, id: string, name: string, roleLabel: string): Persona {
  const emailEnv = `SYNTHETIC_${key}_EMAIL`;
  const passwordEnv = `SYNTHETIC_${key}_PASSWORD`;
  return {
    key,
    id,
    emailEnv,
    passwordEnv,
    email: required(emailEnv).toLowerCase(),
    password: required(passwordEnv),
    name,
    roleLabel,
  };
}

function validatePersonas(personas: Persona[]): void {
  const emails = new Set<string>();
  for (const p of personas) {
    if (emails.has(p.email)) throw new Error(`Duplicate persona email: ${p.email}`);
    emails.add(p.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
      throw new Error(`${p.emailEnv} is not a valid email`);
    }
    if (p.password.length < 16) {
      throw new Error(`${p.passwordEnv} must be at least 16 characters`);
    }
    if (p.password === LOCAL_WEAK_PASSWORD || /SynthTest/i.test(p.password)) {
      throw new Error(`${p.passwordEnv} may not use the local synthetic seed password`);
    }
    if (IS_PROD && p.email.endsWith("@synthetic.test")) {
      throw new Error(`${p.emailEnv} may not use @synthetic.test in production`);
    }
  }
  if (IS_PROD && APPLY && process.env.QA_FACTORY_CONFIRM !== CONFIRM_TOKEN) {
    throw new Error(`Production apply requires QA_FACTORY_CONFIRM=${CONFIRM_TOKEN}`);
  }
}

let savepointCounter = 0;

async function optionalQuery(
  client: PoolClient,
  label: string,
  sql: string,
  values: unknown[],
): Promise<void> {
  const savepoint = `qa_factory_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql, values);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (["42P01", "42703", "42804", "22P02"].includes(code ?? "")) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      console.warn(`[qa-factory] skipped ${label}: ${code}`);
      return;
    }
    throw err;
  }
}

async function assertEmailsAvailable(client: PoolClient, personas: Persona[]): Promise<void> {
  for (const p of personas) {
    const { rows } = await client.query(
      `SELECT id, email, tenant_id FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1`,
      [p.email],
    );
    const existing = rows[0];
    if (existing && String(existing.id) !== p.id) {
      throw new Error(
        `Refusing to take over existing user ${p.email} (${existing.id}) in tenant ${existing.tenant_id}`,
      );
    }
  }
}

async function main() {
  const url = required("NEON_DATABASE_URL");
  const personas = [
    persona("CARLOS", "00000000-0000-0000-0000-000000000191", "Carlos Mendez", "Technician"),
    persona("DANA", "00000000-0000-0000-0000-000000000192", "Dana Reyes", "Maintenance Manager"),
    persona("PLANTMGR", "00000000-0000-0000-0000-000000000193", "Jordan Taylor", "Plant Manager"),
    persona("CFO", "00000000-0000-0000-0000-000000000194", "Pat Hoffman", "CFO"),
  ];
  validatePersonas(personas);

  console.log(`[qa-factory] target=${TARGET} prod=${IS_PROD} apply=${APPLY}`);
  console.log(`[qa-factory] tenant=${TENANT_ID} ${TENANT_NAME}`);
  console.log(`[qa-factory] personas=${personas.map((p) => p.email).join(", ")}`);
  if (!APPLY) console.log("[qa-factory] DRY RUN: transaction will be rolled back");

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertEmailsAvailable(client, personas);

    await client.query(
      `INSERT INTO hub_tenants (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [TENANT_ID, TENANT_NAME],
    );
    await client.query(
      `INSERT INTO tenants (id, name, contact_email)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, contact_email = EXCLUDED.contact_email`,
      [TENANT_ID, TENANT_NAME, personas[0].email],
    );

    for (const p of personas) {
      const hash = await bcrypt.hash(p.password, 12);
      await client.query(
        `INSERT INTO hub_users (id, email, password_hash, tenant_id, name, role, status, trial_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'owner', 'approved', NULL)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           tenant_id = EXCLUDED.tenant_id,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           trial_expires_at = EXCLUDED.trial_expires_at,
           updated_at = NOW()`,
        [p.id, p.email, hash, TENANT_ID, `${p.name} (${p.roleLabel})`],
      );
    }
    await client.query(`UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`, [personas[0].id, TENANT_ID]);

    for (const eq of EQUIPMENT) {
      await optionalQuery(
        client,
        `equipment ${eq.number}`,
        `INSERT INTO cmms_equipment
           (id, tenant_id, equipment_number, description, manufacturer, model_number,
            serial_number, equipment_type, location, department, criticality,
            last_reported_fault, work_order_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::criticalitylevel,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           description = EXCLUDED.description,
           last_reported_fault = EXCLUDED.last_reported_fault,
           work_order_count = EXCLUDED.work_order_count`,
        [
          eq.id,
          TENANT_ID,
          eq.number,
          eq.description,
          eq.manufacturer,
          eq.model,
          eq.serial,
          eq.type,
          eq.location,
          eq.department,
          eq.criticality,
          eq.fault,
          eq.woCount,
        ],
      );
    }

    for (const wo of WORK_ORDERS) {
      await optionalQuery(
        client,
        `work order ${wo.number}`,
        `INSERT INTO work_orders
           (id, tenant_id, work_order_number, equipment_id, manufacturer, model_number,
            title, description, status, priority, source, suggested_actions, safety_warnings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13::text[])
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           description = EXCLUDED.description,
           suggested_actions = EXCLUDED.suggested_actions,
           safety_warnings = EXCLUDED.safety_warnings`,
        [
          wo.id,
          TENANT_ID,
          wo.number,
          wo.equipmentId,
          wo.manufacturer,
          wo.model,
          wo.title,
          wo.description,
          wo.status,
          wo.priority,
          wo.source,
          wo.actions,
          wo.safety,
        ],
      );
    }

    for (const pm of PM_SCHEDULES) {
      await optionalQuery(
        client,
        `PM ${pm.task}`,
        `INSERT INTO pm_schedules
           (id, tenant_id, equipment_id, manufacturer, model_number, task,
            interval_value, interval_unit, interval_type, criticality, confidence,
            source_citation, parts_needed, tools_needed, safety_requirements,
            estimated_duration_minutes, next_due_at, auto_extracted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::text[],$15::text[],$16,NOW() + INTERVAL '7 days',$17)
         ON CONFLICT (id) DO UPDATE SET
           next_due_at = EXCLUDED.next_due_at,
           source_citation = EXCLUDED.source_citation`,
        [
          pm.id,
          TENANT_ID,
          pm.equipmentId,
          pm.manufacturer,
          pm.model,
          pm.task,
          pm.intervalValue,
          pm.intervalUnit,
          pm.intervalType,
          pm.criticality,
          pm.confidence,
          pm.sourceCitation,
          pm.parts,
          pm.tools,
          pm.safety,
          pm.durationMinutes,
          true,
        ],
      );
    }

    if (APPLY) {
      await client.query("COMMIT");
      console.log("[qa-factory] applied");
    } else {
      await client.query("ROLLBACK");
      console.log("[qa-factory] dry-run complete; rolled back");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[qa-factory] failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
