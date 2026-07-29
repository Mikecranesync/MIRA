BEGIN;

-- ─── tag_entities scaling — DURApulse GS10 DC-bus activation seed ────────────
--
-- Activates the Ignition-wire analog assessment card (Drive Commander
-- follow-up #2, PR #2487) on real bench hardware. That capability is deployed
-- but INERT: `mira-pipeline/ignition_chat.py` renders the DC-bus card only when
-- the matched `tag_entities` row carries an explicit per-tag scaling contract
-- in `tag_entities.scaling`, and NOTHING populates that column yet
-- (`createTagEntity` writes 8 cols, not scaling/units). This seed writes the
-- one row that lights up a live CV-101 turn:
--
--     DC bus: 320 V
--     Source value: 3200
--     Scaling: raw register ×0.1 (approved tag mapping)
--     Normal band: 300–340 V
--     Assessment: normal
--
-- CONTRACT (must match the reader verbatim — shared/wire_scaling.from_jsonb):
--   scaling = {"mode":"raw_register","scale":0.1}   -- ÷10 raw register → V
--   units   = 'V'
-- The 300–340 V band is NOT stored here — it comes from the drive pack
-- (`durapulse_gs10/pack.json` envelope.dc_bus), read at assessment time by
-- `shared.live_snapshot`. `expected_envelope` is intentionally left NULL.
--
-- JOIN KEY: `ignition_chat._enrich_tag_snapshot` joins on
--   tenant_id + source_address (= the Ignition browse path) + approval_state='verified'.
-- So `source_address` MUST equal the exact wire path the collector sends
-- ('[default]MIRA_IOCheck/VFD/vfd_dc_bus', leaf `vfd_dc_bus`) and the row must
-- be `verified`. This is the bench tenant's OWN known-good drive (÷10 scaling is
-- bench_verified in the pack provenance), so promoting it to `verified` here is a
-- deliberate, evidenced seed — not an auto-verify of customer/LLM data.
--
-- SCALE PROVENANCE: divisor 10.0 for vfd_dc_bus is pinned in
--   ignition/tags/mira_config_conveyor.json (roles.vfd/vfd101/dc_bus_v) and
--   ignition/tags/tags.json ("VFD DC bus voltage raw (÷10 = V)"), matching the
--   pack register scaling 0.1.
--
-- TENANT: `__TENANT_ID__` placeholder is replaced at apply time by
--   apply-tag-scaling.yml from the workflow's tenant_id input (UUID). Bench
--   tenant is e88bd0e8-8a84-4e30-9803-c0dc6efb07fe.
--
-- IDEMPOTENT + SHAPE-SAFE: UPDATE-by-source_address first (the semantic join
-- key). Only if no such row exists do we INSERT a fresh one — this preserves an
-- existing row's uns_path / data_type / source_kind (written by createTagEntity)
-- instead of risking a duplicate source_address under the (tenant_id, uns_path)
-- UNIQUE constraint. Re-running is a no-op beyond touching updated_at.

WITH updated AS (
    UPDATE tag_entities
       SET scaling        = '{"mode":"raw_register","scale":0.1}'::jsonb,
           units          = 'V',
           approval_state = 'verified',
           updated_at     = now()
     WHERE tenant_id = '__TENANT_ID__'::uuid
       AND source_address = '[default]MIRA_IOCheck/VFD/vfd_dc_bus'
    RETURNING id
)
INSERT INTO tag_entities
    (tenant_id, uns_path, symbolic_name, data_type, source_kind, source_address,
     units, scaling, approval_state, proposed_by, evidence_summary)
SELECT
    '__TENANT_ID__'::uuid,
    'enterprise.garage.demo_cell.cv_101.vfd_dc_bus'::ltree,
    'vfd_dc_bus',
    'UINT16',                       -- raw Modbus holding register (WORD)
    'plc_address',                  -- matches createTagEntity's convention
    '[default]MIRA_IOCheck/VFD/vfd_dc_bus',
    'V',
    '{"mode":"raw_register","scale":0.1}'::jsonb,
    'verified',
    'seed:gs10_pack_dc_bus_scaling',
    '{"note":"DC-bus ÷10=V scaling seeded from durapulse_gs10 pack; bench_verified provenance","source":"tools/seeds/tag_scaling_gs10.sql"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM updated)
ON CONFLICT (tenant_id, uns_path) DO UPDATE
    SET scaling        = EXCLUDED.scaling,
        units          = EXCLUDED.units,
        source_address = EXCLUDED.source_address,
        approval_state = 'verified',
        updated_at     = now();

COMMIT;

-- ─── Rollback (revert the activation; leaves the row, clears the contract) ───
-- BEGIN;
-- UPDATE tag_entities
--    SET scaling = NULL, updated_at = now()
--  WHERE tenant_id = '__TENANT_ID__'::uuid
--    AND source_address = '[default]MIRA_IOCheck/VFD/vfd_dc_bus';
-- COMMIT;
