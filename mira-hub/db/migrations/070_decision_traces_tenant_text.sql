-- Migration 070: decision_traces{,_feedback}.tenant_id UUID -> TEXT.
--
-- ROOT CAUSE (issue #3003, confirmed live on staging 2026-07-29): decision
-- traces are written from the BOT surfaces (telegram/slack/ignition — see the
-- `platform` column on the table itself), and the bot tenant space is TEXT
-- slugs ('staging', 'default', chat_tenant slugs) — not UUIDs. Migrations 032
-- and 055 declared tenant_id UUID, so every staging trace insert dies with:
--   psycopg2.errors.InvalidTextRepresentation: invalid input syntax for type
--   uuid: "staging"
-- and the write is append-only + fire-and-forget, so it fails silently: the
-- audit row is simply never written. Staging has been recording zero traces.
--
-- This is the SAME failure class as migrations 046/047 (fixed by 048) and
-- 063 (fixed by 069, 2026-07-29): a table KEYED FROM THE BOT SURFACE must take
-- the tenant type that surface actually produces. TEXT accepts uuid-strings
-- too, so Hub-side UUID tenants are unaffected; when tenancy finishes its
-- UUID-only migration these columns migrate together with cmms_equipment.
-- See .claude/rules/mira-hub-migrations.md §1 (worked example) and §4 (ordering).
--
-- WHY IT MATTERS BEYOND THE AUDIT ROW: ADR-0033 / the Unification Program PRD
-- (goal G6) make decision_traces a *consumer* of the context contract — the
-- audit row and the prompt context become one shape. It has to accept writes
-- from the surfaces that generate them before it can consume anything.
--
-- Ordering per rule §4: drop policy -> drop tenant indexes -> ALTER TYPE ->
-- recreate indexes -> recreate policy in TEXT form (NO ::UUID cast — a cast
-- throws on slug tenants, and because the policy has WITH CHECK it breaks
-- writes, not just reads).
--
-- NOT touched: decision_traces_uns_path_gist (GiST on uns_path, a different
-- column — its opclass is unaffected by this change) and
-- decision_traces_session_idx / idx_dtf_trace (both on UUID FK columns).

BEGIN;

-- decision_traces -------------------------------------------------------------
DROP POLICY IF EXISTS decision_traces_tenant ON decision_traces;
DROP INDEX IF EXISTS decision_traces_tenant_time_idx;
DROP INDEX IF EXISTS decision_traces_uncited_idx;

ALTER TABLE decision_traces ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

CREATE INDEX IF NOT EXISTS decision_traces_tenant_time_idx
    ON decision_traces (tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS decision_traces_uncited_idx
    ON decision_traces (tenant_id, ts DESC)
    WHERE citations_present = false;

CREATE POLICY decision_traces_tenant
    ON decision_traces
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- decision_trace_feedback -----------------------------------------------------
DROP POLICY IF EXISTS dtf_tenant ON decision_trace_feedback;
DROP INDEX IF EXISTS idx_dtf_tenant;

ALTER TABLE decision_trace_feedback ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

CREATE INDEX IF NOT EXISTS idx_dtf_tenant ON decision_trace_feedback (tenant_id);

CREATE POLICY dtf_tenant
    ON decision_trace_feedback
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

COMMIT;
