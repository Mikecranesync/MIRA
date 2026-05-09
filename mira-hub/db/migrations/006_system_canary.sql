-- Migration 006: data canary for heartbeat monitor
-- Spec: docs/specs/enforcement-layer-spec.md §4.6
--
-- Platform-health table. No tenant_id, no RLS — this exists so a 15-min cron
-- can prove the entire write→read→delete loop works against NeonDB. Customer
-- data does not flow through it.

CREATE TABLE IF NOT EXISTS system_canary (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value       TEXT        NOT NULL
);

-- The monitor sweeps rows older than 24h every tick, but in case the monitor
-- is paused for a while we keep an explicit index so the sweep stays cheap.
CREATE INDEX IF NOT EXISTS idx_system_canary_created_at
    ON system_canary (created_at);

-- Rollback:
-- DROP INDEX IF EXISTS idx_system_canary_created_at;
-- DROP TABLE IF EXISTS system_canary;
