import pool from "@/lib/db";
import { encrypt, decrypt } from "@/lib/token-crypto";

export const DEFAULT_TENANT_ID = process.env.HUB_TENANT_ID ?? "mike";

export type Provider =
  | "telegram"
  | "slack"
  | "teams"
  | "openwebui"
  | "google"
  | "microsoft"
  | "dropbox"
  | "confluence";

export interface BindingMeta {
  displayName?: string;
  email?: string;
  workspace?: string;
  workspaceId?: string;
  botUsername?: string;
  botUserId?: string;
  siteName?: string;
  siteUrl?: string;
  cloudId?: string;
  accountId?: string;
  [k: string]: unknown;
}

export interface Binding {
  provider: Provider;
  externalId: string | null;
  scopes: string[];
  meta: BindingMeta;
  status: "connected" | "revoked";
  connectedAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_channel_bindings (
        id                 SERIAL PRIMARY KEY,
        tenant_id          TEXT NOT NULL DEFAULT 'mike',
        provider           TEXT NOT NULL,
        external_id        TEXT,
        access_token_enc   TEXT,
        refresh_token_enc  TEXT,
        token_expires_at   TIMESTAMPTZ,
        scopes             TEXT[] NOT NULL DEFAULT '{}',
        meta               JSONB NOT NULL DEFAULT '{}'::jsonb,
        status             TEXT NOT NULL DEFAULT 'connected',
        connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, provider)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hub_channel_bindings_tenant
        ON hub_channel_bindings (tenant_id, status)
    `);
  })();
  return schemaReady;
}

export interface UpsertInput {
  tenantId?: string;
  provider: Provider;
  externalId?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | string | null;
  scopes?: string[];
  meta?: BindingMeta;
}

export async function upsertBinding(input: UpsertInput): Promise<void> {
  await ensureSchema();
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const scopes = input.scopes ?? [];
  const meta = input.meta ?? {};
  const accessEnc = encrypt(input.accessToken ?? null);
  const refreshEnc = encrypt(input.refreshToken ?? null);
  const expires =
    input.tokenExpiresAt instanceof Date
      ? input.tokenExpiresAt.toISOString()
      : input.tokenExpiresAt ?? null;

  await pool.query(
    `
    INSERT INTO hub_channel_bindings
      (tenant_id, provider, external_id, access_token_enc, refresh_token_enc,
       token_expires_at, scopes, meta, status, connected_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'connected', NOW(), NOW())
    ON CONFLICT (tenant_id, provider) DO UPDATE SET
      external_id       = COALESCE(EXCLUDED.external_id, hub_channel_bindings.external_id),
      access_token_enc  = COALESCE(EXCLUDED.access_token_enc, hub_channel_bindings.access_token_enc),
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, hub_channel_bindings.refresh_token_enc),
      token_expires_at  = COALESCE(EXCLUDED.token_expires_at, hub_channel_bindings.token_expires_at),
      scopes            = EXCLUDED.scopes,
      meta              = hub_channel_bindings.meta || EXCLUDED.meta,
      status            = 'connected',
      updated_at        = NOW()
  `,
    [
      tenantId,
      input.provider,
      input.externalId ?? null,
      accessEnc,
      refreshEnc,
      expires,
      scopes,
      JSON.stringify(meta),
    ],
  );
}

export async function listBindings(tenantId: string = DEFAULT_TENANT_ID): Promise<Binding[]> {
  await ensureSchema();
  const { rows } = await pool.query(
    `
    SELECT provider, external_id, scopes, meta, status, connected_at, updated_at
      FROM hub_channel_bindings
     WHERE tenant_id = $1 AND status = 'connected'
     ORDER BY connected_at
  `,
    [tenantId],
  );
  return rows.map((r) => ({
    provider: r.provider as Provider,
    externalId: r.external_id,
    scopes: r.scopes ?? [],
    meta: r.meta ?? {},
    status: r.status,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
  }));
}

export async function getAccessToken(
  provider: Provider,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<string | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `
    SELECT access_token_enc FROM hub_channel_bindings
     WHERE tenant_id = $1 AND provider = $2 AND status = 'connected'
     LIMIT 1
  `,
    [tenantId, provider],
  );
  if (!rows[0]?.access_token_enc) return null;
  return decrypt(rows[0].access_token_enc);
}

export async function revokeBinding(
  provider: Provider,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await pool.query(
    `
    UPDATE hub_channel_bindings
       SET status = 'revoked',
           access_token_enc = NULL,
           refresh_token_enc = NULL,
           updated_at = NOW()
     WHERE tenant_id = $1 AND provider = $2
  `,
    [tenantId, provider],
  );
  return (rowCount ?? 0) > 0;
}
