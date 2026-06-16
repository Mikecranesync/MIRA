-- =============================================================================
-- Synthetic PM-schedule seed for the demo / Playwright tenant  (issue #1950)
-- =============================================================================
-- Purpose : Give the /schedule page real rows to render so detail actions
--           (open sheet → Mark Complete, trigger change, day-detail panel,
--           CSV/ICS export) can be exercised by Playwright / manual QA.
--
-- Self-contained: inserts hardcoded synthetic PMs. Unlike the previous version
-- of this file, it does NOT copy from the `mike` tenant — that dependency is
-- why the demo tenant rendered zero PMs (the source rows live only on prod and
-- only under a different tenant). Safe to run against dev / staging / a fresh DB.
--
-- Tenant  : psql variable :tenant_id (stored in pm_schedules.tenant_id, which is
--           TEXT — a UUID string is fine).
--           Default (no -v passed): 00000000-0000-0000-0000-0000000000d1
--             (DEMO_TENANT_ID in src/lib/demo-auth.ts — the tenant the Hub e2e
--              specs and demo-auth session use).
--           Override: psql -v tenant_id="<your-id>" -f tools/seed_demo_tenant_pms.sql
--
-- Idempotent: a row is inserted only when no PM already exists on the tenant for
--             the same (manufacturer, model_number, task) triple. Re-running is
--             a no-op.
--
-- Run (dev) :
--   psql "$NEON_DATABASE_URL_DEV" -f tools/seed_demo_tenant_pms.sql
-- Run (other tenant):
--   psql "$NEON_DATABASE_URL_DEV" -v tenant_id=<uuid> -f tools/seed_demo_tenant_pms.sql
--
-- Table defined in: mira-bots/shared/pm_extractor.py (CREATE TABLE pm_schedules)
--                   + mira-hub/db/migrations/005 (trigger_type, meter_*) + 021 (updated_at)
-- =============================================================================

-- Guard: only set the in-file default when the caller did NOT pass -v tenant_id=…
-- (a bare \set would clobber the -v argument).
\if :{?tenant_id}
\else
\set tenant_id '00000000-0000-0000-0000-0000000000d1'
\endif

INSERT INTO pm_schedules (
    id, tenant_id, manufacturer, model_number, equipment_id,
    task, interval_value, interval_unit, interval_type,
    parts_needed, tools_needed, estimated_duration_minutes,
    safety_requirements, criticality, source_citation, confidence,
    next_due_at, last_completed_at, auto_extracted,
    trigger_type, meter_type, meter_threshold, meter_current,
    created_at, updated_at
)
SELECT
    gen_random_uuid(),
    :'tenant_id',
    v.manufacturer, v.model_number, NULL,
    v.task, v.interval_value, v.interval_unit, 'fixed',
    v.parts_needed::jsonb, v.tools_needed::jsonb, v.duration_min,
    v.safety::jsonb, v.criticality, v.citation, v.confidence,
    now() + make_interval(days => v.due_days),
    CASE WHEN v.completed_days_ago IS NULL THEN NULL
         ELSE now() - make_interval(days => v.completed_days_ago) END,
    true,
    v.trigger_type, v.meter_type, v.meter_threshold::numeric, v.meter_current::numeric,
    now(), now()
FROM (
    VALUES
    -- (manufacturer, model_number, task,
    --  interval_value, interval_unit, parts_needed, tools_needed, duration_min,
    --  safety, criticality, citation, confidence,
    --  due_days, completed_days_ago, trigger_type, meter_type, meter_threshold, meter_current)

    -- 1) OVERDUE, calendar — exercises the overdue badge + Mark Complete roll-forward.
    ('AutomationDirect', 'GS10-2P2', 'Inspect and re-torque RS-485 bus termination resistors',
     3, 'months', '["120Ω 0.25W resistor (x2)"]', '["multimeter","small flathead screwdriver"]', 30,
     '["De-energize control panel before accessing terminal block","Verify LOTO"]', 'high',
     'GS10 User Manual §9.1 — termination required at both bus ends', 0.92,
     -6, NULL, 'calendar', NULL, NULL, 0),

    -- 2) SCHEDULED (near future), calendar — plain upcoming PM.
    ('Allen-Bradley', 'PowerFlex 525', 'Clean heatsink fins and verify cooling-fan operation',
     6, 'months', '["compressed air"]', '["soft brush","vacuum"]', 45,
     '["LOTO before opening drive enclosure"]', 'medium',
     'PowerFlex 525 User Manual ch.5 — periodic cleaning', 0.88,
     5, NULL, 'calendar', NULL, NULL, 0),

    -- 3) SCHEDULED, critical — sorts to top of the list view.
    ('Yaskawa', 'GA500', 'Measure DC-bus capacitor ripple and log readings',
     12, 'months', '["DC-bus capacitor kit (if out of spec)"]', '["oscilloscope","insulated probes"]', 90,
     '["Wait 5 min after power-off for DC-bus discharge","Verify 0 VDC before contact"]', 'critical',
     'GA500 Maintenance Guide §8.3 — capacitor life check', 0.85,
     12, NULL, 'calendar', NULL, NULL, 0),

    -- 4) METER trigger — exercises the meter progress bar (420/500 run hours).
    ('AutomationDirect', 'GS10-1P0', 'Lubricate driven-shaft bearings on run-hours interval',
     500, 'hours', '["NLGI-2 grease cartridge"]', '["grease gun"]', 20,
     '["Confirm machine stopped before lubricating"]', 'medium',
     'Conveyor OEM manual — bearing lubrication every 500 run hours', 0.80,
     30, NULL, 'meter', 'run_hours', 500, 420),

    -- 5) CALENDAR_OR_METER — whichever-first; cycles meter at 650/1000.
    ('SEW-Eurodrive', 'MOVIMOT', 'Inspect gearbox oil level and seal condition',
     1000, 'cycles', '["gearbox oil (1L)","shaft seal kit"]', '["oil drain pan","torque wrench"]', 60,
     '["LOTO","Allow gearbox to cool before draining"]', 'high',
     'MOVIMOT operating instructions §6.2', 0.83,
     9, NULL, 'calendar_or_meter', 'cycles', 1000, 650),

    -- 6) RECENTLY COMPLETED (2 days ago) — renders as completed, validates the
    --    "completed within 7 days" status path used by the GET route.
    ('Siemens', 'SINAMICS G120', 'Verify firmware revision and back up drive parameter set',
     12, 'months', '[]', '["laptop with STARTER/Startdrive"]', 40,
     '["No energized-equipment exposure — parameter read only"]', 'low',
     'SINAMICS G120 commissioning manual §3.1', 0.90,
     363, 2, 'calendar', NULL, NULL, 0)
) AS v(
    manufacturer, model_number, task,
    interval_value, interval_unit, parts_needed, tools_needed, duration_min,
    safety, criticality, citation, confidence,
    due_days, completed_days_ago, trigger_type, meter_type, meter_threshold, meter_current
)
WHERE NOT EXISTS (
    SELECT 1 FROM pm_schedules dst
     WHERE dst.tenant_id    = :'tenant_id'
       AND dst.manufacturer = v.manufacturer
       AND dst.model_number = v.model_number
       AND dst.task         = v.task
);

-- Verify
SELECT
    count(*)                                            AS demo_pm_total,
    count(*) FILTER (WHERE trigger_type <> 'calendar')  AS meter_pms,
    min(next_due_at)                                    AS earliest_due,
    max(next_due_at)                                    AS latest_due
FROM pm_schedules
WHERE tenant_id = :'tenant_id';
