-- Issue: #3485
--
-- Durable execution evidence for the run historian. This is deliberately a
-- living per-task row, not equipment data: a committed `running` record proves
-- the worker started, and a separately committed terminal status proves the
-- observed outcome. A crash therefore remains visible as `running`.

BEGIN;

-- PostgreSQL forbids subqueries directly inside CHECK expressions. Keep the
-- JSON-array walk in one immutable, schema-local helper so malformed/raw
-- evidence is rejected by the table itself. The fixed search path prevents
-- function-body name resolution from being influenced by a caller.
CREATE OR REPLACE FUNCTION historian_heartbeat_hash_array_is_valid(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_typeof(value) = 'array'
       AND NOT EXISTS (
            SELECT 1
             FROM jsonb_array_elements(value) AS element(item)
             WHERE jsonb_typeof(item) <> 'string'
                OR (item #>> '{}') !~ '^[0-9a-f]{64}$'
       );
$function$;

CREATE TABLE IF NOT EXISTS historian_task_heartbeat (
    tenant_id               UUID NOT NULL,
    deployment_environment  TEXT NOT NULL
        CHECK (deployment_environment IN ('development', 'staging', 'production')),
    task_name               TEXT NOT NULL CHECK (length(task_name) BETWEEN 1 AND 128),
    started_at              TIMESTAMPTZ NOT NULL,
    finished_at             TIMESTAMPTZ,
    status                  TEXT NOT NULL
        CHECK (status IN ('running', 'ok', 'error', 'disabled', 'no_triggers', 'missing_config')),
    CHECK ((status = 'running') = (finished_at IS NULL)),
    software_version        TEXT NOT NULL
        CHECK (software_version ~ '^[0-9a-f]{40}$' AND software_version <> 'unknown'),
    run_count               BIGINT NOT NULL DEFAULT 1 CHECK (run_count >= 1),
    detail                  JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (
            jsonb_typeof(detail) = 'object'
            AND pg_column_size(detail) <= 4096
            AND detail ? 'config_sha256'
            AND detail ? 'counts'
            AND detail ? 'fault_trigger_tag_hashes'
            AND detail ? 'machine_memory_path_hashes'
            AND detail ? 'run_diff_enabled'
            AND detail ? 'run_trigger_path_hashes'
            AND jsonb_typeof(detail -> 'config_sha256') = 'string'
            AND (detail ->> 'config_sha256') ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(detail -> 'counts') = 'object'
            AND ((detail -> 'counts') - ARRAY[
                'fault_trigger_tags', 'machine_memory_paths', 'run_trigger_paths'
            ]) = '{}'::jsonb
            AND (detail -> 'counts') ?& ARRAY[
                'fault_trigger_tags', 'machine_memory_paths', 'run_trigger_paths'
            ]
            AND jsonb_typeof((detail -> 'counts') -> 'fault_trigger_tags') = 'number'
            AND jsonb_typeof((detail -> 'counts') -> 'machine_memory_paths') = 'number'
            AND jsonb_typeof((detail -> 'counts') -> 'run_trigger_paths') = 'number'
            AND ((detail -> 'counts') ->> 'fault_trigger_tags') ~ '^(0|[1-9][0-9]*)$'
            AND ((detail -> 'counts') ->> 'machine_memory_paths') ~ '^(0|[1-9][0-9]*)$'
            AND ((detail -> 'counts') ->> 'run_trigger_paths') ~ '^(0|[1-9][0-9]*)$'
            AND historian_heartbeat_hash_array_is_valid(
                detail -> 'fault_trigger_tag_hashes'
            )
            AND historian_heartbeat_hash_array_is_valid(
                detail -> 'machine_memory_path_hashes'
            )
            AND jsonb_typeof(detail -> 'run_diff_enabled') = 'boolean'
            AND historian_heartbeat_hash_array_is_valid(
                detail -> 'run_trigger_path_hashes'
            )
            AND (
                NOT (detail ? 'error_code')
                OR (
                    jsonb_typeof(detail -> 'error_code') = 'string'
                    AND (detail ->> 'error_code') = 'HISTORIAN_PIPELINE_ERROR'
                )
            )
            AND (detail - ARRAY[
                'config_sha256', 'counts', 'error_code', 'fault_trigger_tag_hashes',
                'machine_memory_path_hashes', 'run_diff_enabled',
                'run_trigger_path_hashes'
            ]) = '{}'::jsonb
        ),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, deployment_environment, task_name)
);

ALTER TABLE historian_task_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS historian_task_heartbeat_tenant ON historian_task_heartbeat;
CREATE POLICY historian_task_heartbeat_tenant
    ON historian_task_heartbeat
    FOR ALL
    TO factorylm_app
    USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON historian_task_heartbeat TO factorylm_app;
        REVOKE DELETE ON historian_task_heartbeat FROM factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON historian_task_heartbeat FROM PUBLIC;

COMMIT;

-- Rollback:
-- BEGIN;
-- DROP POLICY IF EXISTS historian_task_heartbeat_tenant ON historian_task_heartbeat;
-- DROP TABLE IF EXISTS historian_task_heartbeat;
-- DROP FUNCTION IF EXISTS historian_heartbeat_hash_array_is_valid(JSONB);
-- COMMIT;
