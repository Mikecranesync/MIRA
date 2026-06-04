"""MaintainXMockConnector — REST-shape import → normalize → derive → export."""

from __future__ import annotations

from mira_connectors.canonical import CanonicalAsset, CanonicalWorkOrder, RecordType
from mira_connectors.mocks import MaintainXMockConnector


async def test_discover(maintainx: MaintainXMockConnector):
    caps = await maintainx.discover()
    assert caps.kind.value == "cmms"
    assert caps.provider == "maintainx"
    assert caps.supports_export is True
    assert "asset_endpoint" in caps.schema


async def test_import_assets_rest_shape(maintainx: MaintainXMockConnector):
    raw = await maintainx.import_records(RecordType.ASSET)
    assert len(raw) == 3
    # MaintainX numeric ids preserved as the source record id + native field kept
    assert {r.source_record_id for r in raw} == {"8001", "8002", "8003"}
    assert raw[0].fields["id"] == 8001


async def test_normalize_hierarchy_and_uns(maintainx: MaintainXMockConnector):
    recs = {}
    for rt in (RecordType.LOCATION, RecordType.ASSET):
        for r in maintainx.normalize(await maintainx.import_records(rt)):
            recs[r.source_record_id] = r
    conv, motor = recs["8001"], recs["8002"]
    assert isinstance(conv, CanonicalAsset)
    assert conv.manufacturer == "Dorner"
    assert conv.proposed_uns_path == "enterprise.bedford_plant.packaging.line_1.conv_001"
    assert motor.parent_source_id == "8001"
    assert motor.proposed_uns_path.endswith(".motor_001")
    assert motor.raw["serialNumber"] == "WEG-9931"  # raw preserved


async def test_normalize_workorder_category_to_worktype(maintainx: MaintainXMockConnector):
    recs = {
        r.source_record_id: r
        for r in maintainx.normalize(await maintainx.import_records(RecordType.WORK_ORDER))
    }
    assert isinstance(recs["91001"], CanonicalWorkOrder)
    assert recs["91001"].status == "COMPLETE"  # DONE → COMPLETE
    assert recs["91001"].work_type == "corrective"  # REACTIVE → corrective
    assert recs["91002"].work_type == "preventive"  # PREVENTIVE → preventive


async def test_derive_relationships(maintainx: MaintainXMockConnector):
    recs = []
    for rt in (RecordType.ASSET, RecordType.PART):
        recs += maintainx.normalize(await maintainx.import_records(rt))
    rels = maintainx.derive_relationships(recs)
    types = {r.relationship_type for r in rels}
    assert {"HAS_COMPONENT", "LOCATED_IN", "HAS_PART"} <= types
    assert all(not r.validate() for r in rels)


async def test_validate_clean(maintainx: MaintainXMockConnector):
    recs = []
    for rt in (await maintainx.discover()).record_types:
        recs += maintainx.normalize(await maintainx.import_records(rt))
    result = maintainx.validate_mappings(recs)
    assert result.ok and not result.errors


async def test_export_gated(maintainx: MaintainXMockConnector, rw_config):
    recs = maintainx.normalize(await maintainx.import_records(RecordType.WORK_ORDER))
    assert (await maintainx.export_records(recs)).refused == len(recs)
    mx_rw = MaintainXMockConnector(rw_config)
    assert (await mx_rw.export_records(recs)).exported == len(recs)
