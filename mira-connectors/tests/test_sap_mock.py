"""SAPMockConnector — full import → normalize → derive → export lifecycle."""

from __future__ import annotations

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalPart,
    CanonicalWorkOrder,
    RecordType,
)
from mira_connectors.mocks import SAPMockConnector


async def test_discover(sap: SAPMockConnector):
    caps = await sap.discover()
    assert caps.kind.value == "cmms"
    assert caps.provider == "sap"
    assert RecordType.ASSET in caps.record_types
    assert caps.supports_export is True
    assert "EQUNR" in caps.schema["equipment_fields"]  # real SAP field name surfaced


async def test_health_check(sap: SAPMockConnector):
    h = await sap.health_check()
    assert h["ok"] is True and h["mock"] is True


async def test_import_equipment_preserves_native_fields(sap: SAPMockConnector):
    raw = await sap.import_records(RecordType.ASSET)
    assert len(raw) == 3
    assert {r.source_record_id for r in raw} == {"10000455", "10000456", "10000457"}
    assert raw[0].fields["EQUNR"] and "HERST" in raw[0].fields  # native fields preserved


async def test_normalize_equipment_hierarchy_and_uns(sap: SAPMockConnector):
    raw = await sap.import_records(RecordType.ASSET)
    recs = {r.source_record_id: r for r in sap.normalize(raw)}
    conv, motor = recs["10000455"], recs["10000456"]
    assert isinstance(conv, CanonicalAsset)
    assert conv.manufacturer == "Dorner"
    assert conv.proposed_uns_path == (
        "enterprise.bedford_plant.packaging_area.bottling_line_1.infeed_conveyor_cell.10000455"
    )
    assert motor.parent_source_id == "10000455"
    assert motor.proposed_uns_path.endswith(".10000456")
    assert "HERST" in motor.raw  # raw vendor record fully preserved


async def test_normalize_order_status_and_worktype(sap: SAPMockConnector):
    raw = await sap.import_records(RecordType.WORK_ORDER)
    recs = {r.source_record_id: r for r in sap.normalize(raw)}
    assert isinstance(recs["4000123"], CanonicalWorkOrder)
    assert recs["4000123"].status == "COMPLETE"  # TECO → COMPLETE
    assert recs["4000123"].work_type == "corrective"  # PM02 → corrective
    assert recs["4000130"].work_type == "preventive"  # PM01 → preventive


async def test_normalize_bom_parts(sap: SAPMockConnector):
    raw = await sap.import_records(RecordType.PART)
    recs = sap.normalize(raw)
    assert all(isinstance(r, CanonicalPart) for r in recs)
    assert {r.item_number for r in recs} == {"FUSE-10A-CC", "BRG-6204-2RS"}


async def test_derive_relationships_use_018_vocab(sap: SAPMockConnector):
    recs = []
    for rt in (RecordType.LOCATION, RecordType.ASSET, RecordType.PART):
        recs += sap.normalize(await sap.import_records(rt))
    rels = sap.derive_relationships(recs)
    types = {r.relationship_type for r in rels}
    assert {"HAS_COMPONENT", "LOCATED_IN", "HAS_PART"} <= types
    # every derived edge validates against the controlled vocabulary + has evidence
    assert all(not r.validate() for r in rels)


async def test_validate_clean(sap: SAPMockConnector):
    recs = []
    for rt in (await sap.discover()).record_types:
        recs += sap.normalize(await sap.import_records(rt))
    result = sap.validate_mappings(recs)
    assert result.ok and not result.errors


async def test_export_gated_read_only_then_writable(sap: SAPMockConnector, rw_config):
    recs = sap.normalize(await sap.import_records(RecordType.WORK_ORDER))
    ro = await sap.export_records(recs)
    assert ro.refused == len(recs) and ro.exported == 0  # read-only default
    sap_rw = SAPMockConnector(rw_config)
    rw = await sap_rw.export_records(recs)
    assert rw.exported == len(recs)  # work orders writable to the CMMS API


async def test_dry_run_export_is_planned_noop(tenant_id):
    from mira_connectors.base import ConnectorConfig, ConnectorMode

    dry = SAPMockConnector(
        ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_WRITE, dry_run=True)
    )
    recs = dry.normalize(await dry.import_records(RecordType.WORK_ORDER))
    res = await dry.export_records(recs)
    assert res.planned == len(recs) and res.exported == 0
