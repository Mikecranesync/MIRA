/**
 * MIRA Connect — activation code management for factory-to-cloud pairing.
 *
 * Flow: Open WebUI chat generates a code → user enters it in Ignition →
 * Ignition POSTs to /api/connect/activate → gets tenant_id + relay_url back.
 */

import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

const RELAY_URL = () =>
  process.env.MIRA_RELAY_URL || "https://connect.factorylm.com/ingest";

export interface ActivationCode {
  code: string;
  tenant_id: string;
  relay_url: string;
  expires_at: string;
  activated: boolean;
  agent_id: string | null;
  gateway_hostname: string | null;
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return `MIRA-${segments.join("-")}`;
}

export async function createActivationCode(tenantId: string): Promise<string> {
  const db = sql();
  const code = generateCode();
  await db`
    INSERT INTO plg_activation_codes (code, tenant_id, relay_url, expires_at)
    VALUES (${code}, ${tenantId}, ${RELAY_URL()}, NOW() + INTERVAL '1 hour')`;
  return code;
}

export async function validateAndActivate(
  code: string,
  agentId: string,
  gatewayHostname: string,
): Promise<{ tenant_id: string; relay_url: string } | null> {
  const db = sql();
  const rows = await db`
    SELECT code, tenant_id, relay_url, expires_at, activated
    FROM plg_activation_codes
    WHERE code = ${code}
      AND activated = false
      AND expires_at > NOW()
    LIMIT 1`;

  if (!rows[0]) return null;

  const row = rows[0] as ActivationCode;

  await db`
    UPDATE plg_activation_codes
    SET activated = true, agent_id = ${agentId}, gateway_hostname = ${gatewayHostname}
    WHERE code = ${code}`;

  return { tenant_id: row.tenant_id, relay_url: row.relay_url };
}

export async function getConnectionStatus(
  tenantId: string,
): Promise<{ connected: boolean; agent_id: string | null; gateway_hostname: string | null }> {
  const db = sql();
  const rows = await db`
    SELECT agent_id, gateway_hostname
    FROM plg_activation_codes
    WHERE tenant_id = ${tenantId} AND activated = true
    ORDER BY expires_at DESC
    LIMIT 1`;

  if (!rows[0]) return { connected: false, agent_id: null, gateway_hostname: null };
  return {
    connected: true,
    agent_id: rows[0].agent_id as string,
    gateway_hostname: rows[0].gateway_hostname as string,
  };
}

export async function ensureConnectSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS plg_activation_codes (
      code              TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      relay_url         TEXT NOT NULL,
      expires_at        TIMESTAMPTZ NOT NULL,
      activated         BOOLEAN NOT NULL DEFAULT false,
      agent_id          TEXT,
      gateway_hostname  TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_activation_codes_tenant
    ON plg_activation_codes (tenant_id)`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_activation_codes_expires
    ON plg_activation_codes (expires_at) WHERE activated = false`;
}
