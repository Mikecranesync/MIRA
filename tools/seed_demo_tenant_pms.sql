-- Seed 8 PM schedules onto the demo tenant for the May 21 Expo demo.
-- Copies a representative slice of auto-extracted PMs from the `mike` tenant
-- (which holds 26 PMs against Yaskawa / AB / GS-family drives but is not the
-- tenant scope of the demo Hub UI).
--
-- Idempotent: only inserts rows that don't already exist on the demo tenant
-- for the same (manufacturer, model_number, task) triple.
--
-- Run via:
--   ssh root@165.245.138.91 \
--     "doppler run -p factorylm -c prd -- \
--      psql $NEON_DATABASE_URL -f /tmp/seed_demo_tenant_pms.sql"
--
-- Closes #1033 PM Schedule "≥5 PMs visible on demo tenant" gate
-- and unblocks the FALLBACK_PMS removal from mira-hub schedule page.

INSERT INTO pm_schedules (
    id, tenant_id, manufacturer, model_number, equipment_id, task,
    interval_value, interval_unit, interval_type, parts_needed,
    tools_needed, estimated_duration_minutes, safety_requirements,
    criticality, source_citation, confidence, next_due_at,
    auto_extracted, created_at, trigger_type, meter_current, updated_at
)
SELECT
    gen_random_uuid(),                              -- new id for demo tenant
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::text,   -- demo tenant
    src.manufacturer,
    src.model_number,
    NULL,                                            -- no equipment FK
    src.task,
    src.interval_value,
    src.interval_unit,
    src.interval_type,
    src.parts_needed,
    src.tools_needed,
    src.estimated_duration_minutes,
    src.safety_requirements,
    src.criticality,
    src.source_citation,
    src.confidence,
    src.next_due_at,
    src.auto_extracted,
    now(),
    src.trigger_type,
    0,
    now()
FROM (
    -- Pick 8 representative PMs: mix of intervals, criticalities, manufacturers.
    -- Prefer near-future next_due_at so they're visible on the schedule today.
    SELECT DISTINCT ON (manufacturer, model_number, task)
        manufacturer, model_number, task,
        interval_value, interval_unit, interval_type,
        parts_needed, tools_needed, estimated_duration_minutes,
        safety_requirements, criticality, source_citation,
        confidence,
        -- Bias all next_due_at into the next 14 days for demo visibility
        (now() + (
            (random() * 14)::int || ' days'
        )::interval)::timestamptz AS next_due_at,
        auto_extracted, trigger_type
    FROM pm_schedules
    WHERE tenant_id = 'mike'
      AND task IS NOT NULL
      AND manufacturer IS NOT NULL
    ORDER BY manufacturer, model_number, task, created_at DESC
    LIMIT 8
) src
WHERE NOT EXISTS (
    SELECT 1 FROM pm_schedules dst
     WHERE dst.tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
       AND dst.manufacturer = src.manufacturer
       AND dst.model_number = src.model_number
       AND dst.task = src.task
);

-- Verify
SELECT
    count(*) AS demo_pm_total,
    min(next_due_at) AS earliest_due,
    max(next_due_at) AS latest_due
FROM pm_schedules
WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';
