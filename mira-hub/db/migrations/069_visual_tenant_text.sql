-- Migration 069: visual_* tenant_id UUID -> TEXT (the 048 lesson, again).
--
-- ROOT CAUSE (found live on staging, 2026-07-29): the VisualSession spine's first
-- real consumer is the Telegram print workspace (#2798), and the bot tenant space
-- is TEXT slugs ('staging', 'default', chat_tenant slugs) — not UUIDs. Migration
-- 063 declared tenant_id UUID on all six visual tables, so the very first
-- create_session on staging died with:
--   psycopg2.errors.InvalidTextRepresentation: invalid input syntax for type
--   uuid: "staging"
-- and the store's fail-open swallowed it: no session, no workspace, follow-up
-- questions fell through to the disabled print backend. Same failure class as
-- migrations 046/047 (fixed by 048): a table KEYED FROM THE BOT SURFACE must take
-- the tenant type that surface actually produces. TEXT accepts uuid-strings too,
-- so Hub-side UUID tenants are unaffected; when tenancy finishes its UUID-only
-- migration, these columns migrate together with cmms_equipment.
-- See .claude/rules/mira-hub-migrations.md §1 (worked example) and §4 (ordering).
--
-- Ordering per rule §4: drop policy -> (safest) drop tenant indexes -> ALTER TYPE
-- -> recreate indexes -> recreate policy in TEXT form (NO ::UUID cast — a cast
-- would throw on slug tenants, breaking writes via WITH CHECK).

BEGIN;

-- visual_session ------------------------------------------------------------
DROP POLICY IF EXISTS visual_session_tenant ON visual_session;
DROP INDEX IF EXISTS visual_session_tenant_time_idx;
DROP INDEX IF EXISTS visual_session_asset_idx;
ALTER TABLE visual_session ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE INDEX IF NOT EXISTS visual_session_tenant_time_idx
    ON visual_session (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS visual_session_asset_idx
    ON visual_session (tenant_id, asset_id);
CREATE POLICY visual_session_tenant ON visual_session
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- evidence_item --------------------------------------------------------------
DROP POLICY IF EXISTS evidence_item_tenant ON evidence_item;
DROP INDEX IF EXISTS evidence_item_tenant_idx;
ALTER TABLE evidence_item ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE INDEX IF NOT EXISTS evidence_item_tenant_idx
    ON evidence_item (tenant_id, created_at DESC);
CREATE POLICY evidence_item_tenant ON evidence_item
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- region_of_interest ----------------------------------------------------------
DROP POLICY IF EXISTS region_of_interest_tenant ON region_of_interest;
ALTER TABLE region_of_interest ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE POLICY region_of_interest_tenant ON region_of_interest
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- observation -----------------------------------------------------------------
DROP POLICY IF EXISTS observation_tenant ON observation;
ALTER TABLE observation ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE POLICY observation_tenant ON observation
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- visual_question -------------------------------------------------------------
DROP POLICY IF EXISTS visual_question_tenant ON visual_question;
ALTER TABLE visual_question ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE POLICY visual_question_tenant ON visual_question
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

-- answer_claim ----------------------------------------------------------------
DROP POLICY IF EXISTS answer_claim_tenant ON answer_claim;
ALTER TABLE answer_claim ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
CREATE POLICY answer_claim_tenant ON answer_claim
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
                OR tenant_id = current_setting('app.current_tenant_id', true));

COMMIT;
