-- mira-core/mira-ingest/db/migrations/010_tenant_id_on_work_orders_telegram.sql
--
-- Adds tenant_id (DEFAULT 'mike') to two more tables the hub reads:
--   * work_orders        — populated by mira-bots (Telegram/Slack)
--   * telegram_messages  — populated by the Telegram bot adapter
--
-- The hub uses these in /api/events, /api/conversations, /api/channels,
-- and /api/usage. Without tenant_id on the table, queries can't be
-- scoped per-customer.
--
-- Same pattern as migration 009: idempotent ADD COLUMN IF NOT EXISTS,
-- nullable=false with DEFAULT='mike' so existing rows backfill to
-- Mike's tenant and external writers (mira-bots) keep working without
-- schema knowledge until they're updated separately.

BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'mike';

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_created
  ON work_orders (tenant_id, created_at DESC);

ALTER TABLE telegram_messages
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'mike';

CREATE INDEX IF NOT EXISTS idx_telegram_messages_tenant_ts
  ON telegram_messages (tenant_id, timestamp DESC);

COMMIT;

-- Verification:
--   \d work_orders
--   \d telegram_messages
--   SELECT DISTINCT tenant_id FROM work_orders;        -- expect 'mike'
--   SELECT DISTINCT tenant_id FROM telegram_messages;  -- expect 'mike'
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_work_orders_tenant_created;
--   DROP INDEX IF EXISTS idx_telegram_messages_tenant_ts;
--   ALTER TABLE work_orders DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE telegram_messages DROP COLUMN IF EXISTS tenant_id;
