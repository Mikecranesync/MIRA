"""Base connector machinery: read-only default, dry-run, sync logging, validation."""

from __future__ import annotations

from mira_connectors.base import ConnectorConfig, ConnectorMode
from mira_connectors.canonical import CanonicalAsset, RecordType
from mira_connectors.mocks import IgnitionMockConnector, MaximoMockConnector


async def test_read_only_export_refused(maximo: MaximoMockConnector):
    raw = await maximo.import_records(RecordType.WORK_ORDER)
    recs = maximo.normalize(raw)
    result = await maximo.export_records(recs)
    assert result.exported == 0
    assert result.refused == len(recs)


async def test_dry_run_plans_no_writes(tenant_id: str):
    cfg = ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_WRITE, dry_run=True)
    conn = MaximoMockConnector(cfg)
    raw = await conn.import_records(RecordType.WORK_ORDER)
    recs = conn.normalize(raw)
    result = await conn.export_records(recs)
    assert result.planned == len(recs)
    assert result.exported == 0


async def test_read_write_export_runs(rw_config: ConnectorConfig):
    conn = MaximoMockConnector(rw_config)
    raw = await conn.import_records(RecordType.WORK_ORDER)
    recs = conn.normalize(raw)
    result = await conn.export_records(recs)
    # All fixture rows are work orders → all writable.
    assert result.exported == len(recs)
    assert result.refused == 0


async def test_scada_export_refused_even_in_read_write(rw_config: ConnectorConfig):
    conn = IgnitionMockConnector(rw_config)
    raw = await conn.import_records(RecordType.TAG)
    recs = conn.normalize(raw)
    result = await conn.export_records(recs)
    assert result.exported == 0
    assert result.refused == len(recs)
    assert any("read-only by construction" in e for e in result.errors)


async def test_config_writable_property(tenant_id: str):
    assert ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_ONLY).writable is False
    assert ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_WRITE).writable is True
    assert (
        ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_WRITE, dry_run=True).writable
        is False
    )


async def test_sync_produces_structured_result(maximo: MaximoMockConnector):
    recs, result = await maximo.sync(RecordType.ASSET)
    assert result.connector == "maximo"
    assert result.mock is True
    assert result.imported == 4
    assert result.normalized == 4
    assert result.imported == len(recs)
    assert result.ok
    assert result.duration_ms >= 0
    d = result.as_dict()
    assert d["record_type"] == "asset"
    assert "errors" in d


def test_validate_flags_warning_for_missing_uns(maximo: MaximoMockConnector):
    # An asset with no proposed_uns_path → warning, not error.
    asset = CanonicalAsset(source_system="maximo", source_record_id="orphan", name="Orphan")
    result = maximo.validate_mappings([asset])
    assert result.ok  # warning only
    assert any("proposed_uns_path" in w.message for w in result.warnings)


def test_validate_flags_error_for_bad_record(maximo: MaximoMockConnector):
    bad = CanonicalAsset(source_system="maximo", source_record_id="", name="X", confidence=2.0)
    result = maximo.validate_mappings([bad])
    assert not result.ok
    assert len(result.errors) >= 1


async def test_unconfigured_connector_sync_errors(tenant_id: str, monkeypatch):
    conn = MaximoMockConnector(ConnectorConfig(tenant_id=tenant_id))
    monkeypatch.setattr(type(conn), "configured", property(lambda self: False))
    _recs, result = await conn.sync(RecordType.ASSET)
    assert not result.ok
    assert any("not configured" in e for e in result.errors)
