BEGIN;

-- ─── approved_tags — CV-101 direct Modbus fallback: photo-eye DI 5 ───────────
--
-- One allowlist row so `mira-relay/tag_ingest.ingest_batch` accepts the bench
-- read-only Modbus poller (plc/live-plc-bridge/cv101_relay_poller.py) while the
-- bench Ignition gateway is unlicensed (trial expired → every tag Bad/null →
-- relay rejects null_value).
--
-- IDENTITY — distinct from the Ignition row in approved_tags_conveyor.sql:
--   source_system   = 'plc_bridge'            (direct PLC read, not Ignition)
--   source_tag_path = 'micro820/_IO_EM_DI_05' (the Micro820 variable itself,
--                      Modbus coil 000023 in plc/MbSrvConf_v4.xml slave-map v2)
-- The Ignition row ('ignition', '[default]MIRA_IOCheck/Inputs/DI_05') is left
-- untouched; both describe the same physical input through different paths.
--
-- KEY MATCH — normalized_tag_path is ingest_contract.normalize_tag_path(
-- 'micro820/_IO_EM_DI_05') = 'micro820_io_em_di_05' (asserted by
-- plc/live-plc-bridge/tests/test_cv101_relay_poller.py).
--
-- UNS — the same conveyor_1 subtree the CV-101 Ignition rows use.
-- TENANT — `__TENANT_ID__`, substituted by apply-approved-tags.yml.
-- ROLLBACK — UPDATE approved_tags SET enabled = false WHERE source_system =
--   'plc_bridge' AND source_tag_path = 'micro820/_IO_EM_DI_05' (fail-closed again).
-- Idempotent — ON CONFLICT … DO UPDATE.

INSERT INTO approved_tags
  (tenant_id, source_system, source_tag_path, normalized_tag_path, uns_path, enabled, notes)
VALUES
  ('__TENANT_ID__'::uuid, 'plc_bridge', 'micro820/_IO_EM_DI_05', 'micro820_io_em_di_05',
   'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree, true,
   'CV-101 read-only Modbus fallback (coil 000023 = _IO_EM_DI_05) while bench Ignition is unlicensed')
ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE
  SET normalized_tag_path = EXCLUDED.normalized_tag_path,
      uns_path = EXCLUDED.uns_path,
      enabled = true,
      notes = EXCLUDED.notes,
      updated_at = now();

COMMIT;
