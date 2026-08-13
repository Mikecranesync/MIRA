-- 074 — work_orders.client_key: durable client-generated idempotency key.
--
-- WHY (native-mobile PRD / ADR-0034 Phase 3→4 gate): POST /api/work-orders
-- server-generates id + WO number, so a retried create — a mobile client
-- resubmitting after a network timeout, or a future offline queue replaying —
-- silently duplicates the work order. The smallest durable contract is a
-- nullable client-supplied UUID, unique per tenant: the first insert wins, a
-- replay returns the existing row (HTTP 200 {work_order, replayed:true} vs
-- 201). Key lifetime = the work order's lifetime (no separate ledger/TTL).
-- Tenant scoping is structural: the unique index includes tenant_id, so one
-- tenant's key can never collide with or probe another's.
--
-- Idempotent + single transaction per .claude/rules/mira-hub-migrations.md.
-- work_orders is an existing granted table (no new GRANT needed); tenant_id
-- here is the TEXT family (matches the table's existing column).

BEGIN;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS client_key TEXT;

-- Partial unique: only rows that carry a key participate; NULLs (all existing
-- rows + every non-mobile create) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_tenant_client_key
  ON work_orders (tenant_id, client_key)
  WHERE client_key IS NOT NULL;

COMMIT;
