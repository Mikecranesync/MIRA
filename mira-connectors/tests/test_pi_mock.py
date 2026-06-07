"""PIMockConnector — historian import → normalize → derive; read-only by construction."""

from __future__ import annotations

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalMeter,
    CanonicalTag,
    RecordType,
)
from mira_connectors.mocks import PIMockConnector


async def test_discover(pi: PIMockConnector):
    caps = await pi.discover()
    assert caps.kind.value == "historian"
    assert caps.provider == "pi"
    assert caps.supports_export is False  # read-only by construction
    assert caps.schema["event_frame_count"] == 2  # event frames surfaced in discovery


async def test_import_points_preserve_native_name(pi: PIMockConnector):
    raw = await pi.import_records(RecordType.TAG)
    assert len(raw) == 4
    assert all(r.source_record_id.startswith("\\\\PISRV01") for r in raw)
    assert raw[0].fields["PointType"]  # native PI field preserved


async def test_af_hierarchy_to_assets_with_uns(pi: PIMockConnector):
    recs = {r.source_record_id: r for r in pi.normalize(await pi.import_records(RecordType.ASSET))}
    conv = recs["Bedford\\Packaging\\Conveyor"]
    assert isinstance(conv, CanonicalAsset)
    assert conv.proposed_uns_path == "enterprise.bedford.packaging.conveyor"
    motor = recs["Bedford\\Packaging\\Conveyor\\Motor"]
    assert motor.parent_source_id == "Bedford\\Packaging\\Conveyor"


async def test_points_become_historian_tags(pi: PIMockConnector):
    recs = pi.normalize(await pi.import_records(RecordType.TAG))
    assert all(isinstance(r, CanonicalTag) for r in recs)
    cur = [r for r in recs if r.address.endswith("Conv.Motor.Current")][0]
    assert cur.history_enabled is True
    assert cur.attributes["sample_count"] == 3  # archived values summarized
    assert cur.attributes["last_value"] == 3.4
    assert "PointType" in cur.raw  # raw point preserved


async def test_archived_values_roll_up_to_meters(pi: PIMockConnector):
    recs = pi.normalize(await pi.import_records(RecordType.METER))
    assert recs and all(isinstance(r, CanonicalMeter) for r in recs)
    # only points that have archived values produce a meter (3 of 4 points)
    assert len(recs) == 3
    assert any(r.last_reading is not None for r in recs)


async def test_event_frames_preserved_and_safety_flagged(pi: PIMockConnector):
    recs = {r.source_record_id: r for r in pi.normalize(await pi.import_records(RecordType.ASSET))}
    vfd = recs["Bedford\\Packaging\\Conveyor\\VFD"]
    assert "event_frames" in vfd.attributes  # VFD downtime event frame preserved
    conv = recs["Bedford\\Packaging\\Conveyor"]
    assert conv.criticality == "safety_critical"  # E-stop safety event frame → flagged


async def test_derive_relationships(pi: PIMockConnector):
    recs = []
    for rt in (RecordType.ASSET, RecordType.TAG):
        recs += pi.normalize(await pi.import_records(rt))
    rels = pi.derive_relationships(recs)
    types = {r.relationship_type for r in rels}
    assert {"HAS_COMPONENT", "HAS_SIGNAL"} <= types
    assert all(not r.validate() for r in rels)


async def test_export_refused_by_construction(pi: PIMockConnector, rw_config):
    recs = pi.normalize(await pi.import_records(RecordType.TAG))
    # even constructed READ_WRITE, a historian refuses to write to the plant
    pi_rw = PIMockConnector(rw_config)
    res = await pi_rw.export_records(recs)
    assert res.exported == 0 and res.refused == len(recs)


async def test_validate_clean(pi: PIMockConnector):
    recs = []
    for rt in (await pi.discover()).record_types:
        recs += pi.normalize(await pi.import_records(rt))
    result = pi.validate_mappings(recs)
    assert result.ok and not result.errors
