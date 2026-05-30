-- Seed Atlas preventive_maintenance for the May 21 Expo demo (#1037 gate).
-- Idempotent: only inserts when no rows match by title.

INSERT INTO preventive_maintenance (
    id, created_at, updated_at, description, due_date, estimated_duration,
    priority, required_signature, title, name, company_id, asset_id,
    estimated_start_date, is_demo
)
SELECT nextval('hibernate_sequence'), now(), now(), src.description, src.due_date, src.estimated_duration,
       src.priority, false, src.title, src.title, 1, src.asset_id,
       src.due_date, true
FROM (VALUES
    (1::bigint, 'Air Compressor full inspection — clean filter, check belts, verify PSI', now() + interval '2 days', 2.0, 2::smallint, 'Air Compressor PM — Monthly'),
    (1::bigint, 'PowerFlex 525 VFD periodic check — torque connections, log fault history', now() + interval '5 days', 1.5, 1::smallint, 'PowerFlex 525 VFD — Quarterly'),
    (2::bigint, 'Yaskawa GA500 cooling fan inspection', now() + interval '7 days', 1.0, 2::smallint, 'GA500 Cooling Fan — Quarterly'),
    (3::bigint, 'SINAMICS G120 capacitor reform — power up if idle >12 months', now() + interval '12 days', 3.0, 1::smallint, 'G120 Capacitor Reform — Annual'),
    (5::bigint, 'Conveyor motor lubrication + tension check', now() + interval '3 days', 0.5, 3::smallint, 'Conveyor #3 — Weekly')
) AS src(asset_id, description, due_date, estimated_duration, priority, title)
WHERE NOT EXISTS (
    SELECT 1 FROM preventive_maintenance pm WHERE pm.title = src.title
);

SELECT count(*) AS demo_pm_total FROM preventive_maintenance;
