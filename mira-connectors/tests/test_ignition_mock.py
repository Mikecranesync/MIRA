"""IgnitionMockConnector — tag-tree import → normalize → derive, read-only export."""

from __future__ import annotations

from mira_connectors.canonical import CanonicalTag, RecordType
from mira_connectors.mocks import IgnitionMockConnector


async def test_discover_tag_tree(ignition: IgnitionMockConnector):
    caps = await ignition.discover()
    assert caps.kind.value == "scada"
    assert caps.supports_export is False  # read-only by construction
    assert caps.schema["tagProvider"] == "default"
    assert caps.schema["device"] == "Mira_PLC"
    assert any("Conveyor" in line for line in caps.schema["tag_tree"])


async def test_import_flattens_atomic_tags(ignition: IgnitionMockConnector):
    raw = await ignition.import_records(RecordType.TAG)
    # 4 motor + 4 gs10 + 1 pe + 2 conveyor-level = 11 atomic tags
    assert len(raw) == 11
    paths = {r.source_record_id for r in raw}
    assert "[default]Lake_Wales/Bench/Conveyor/Motor/Speed" in paths
    assert "[default]Lake_Wales/Bench/Conveyor/GS10/DCBusVoltage" in paths


async def test_import_non_tag_types_empty(ignition: IgnitionMockConnector):
    # Locations/assets are derived from the tag tree, not imported directly.
    assert await ignition.import_records(RecordType.ASSET) == []


async def test_normalize_tag_fields(ignition: IgnitionMockConnector):
    raw = await ignition.import_records(RecordType.TAG)
    recs = {r.tag_id: r for r in ignition.normalize(raw) if isinstance(r, CanonicalTag)}
    speed = recs["Lake_Wales.Bench.Conveyor.Motor.Speed"]
    assert speed.data_type == "float"  # Float8 → float
    assert speed.engineering_unit == "Hz"
    assert speed.address == "ns=1;s=[Mira_PLC]HR400101"
    assert speed.history_enabled is True
    assert speed.scada_path == "[default]Lake_Wales/Bench/Conveyor/Motor/Speed"
    assert speed.proposed_uns_path == "enterprise.lake_wales.bench.conveyor.motor.speed"

    occupied = recs["Lake_Wales.Bench.Conveyor.PE_B16_2.Occupied"]
    assert occupied.data_type == "bool"  # Boolean → bool

    faultcode = recs["Lake_Wales.Bench.Conveyor.GS10.FaultCode"]
    assert faultcode.data_type == "int"  # Int4 → int


async def test_derive_has_signal_and_located_in(ignition: IgnitionMockConnector):
    recs = ignition.normalize(await ignition.import_records(RecordType.TAG))
    rels = ignition.derive_relationships(recs)
    by_type: dict[str, list] = {}
    for r in rels:
        by_type.setdefault(r.relationship_type, []).append(r)

    # GS10 folder is an asset folder → HAS_SIGNAL from the GS10 asset to each of its tags.
    has_signal = by_type["HAS_SIGNAL"]
    gs10_path = "enterprise.lake_wales.bench.conveyor.gs10"
    gs10_signals = [r for r in has_signal if r.source_ref == gs10_path]
    assert len(gs10_signals) == 4  # OutputFrequency, DCBusVoltage, FaultCode, Faulted
    assert all(r.target_ref_kind == "tag_id" for r in gs10_signals)

    # LOCATED_IN chain is deduped (folder hierarchy appears once).
    located = by_type["LOCATED_IN"]
    pairs = [(r.source_ref, r.target_ref) for r in located]
    assert len(pairs) == len(set(pairs))  # no dupes
    assert (
        "enterprise.lake_wales.bench.conveyor",
        "enterprise.lake_wales.bench",
    ) in pairs

    for r in rels:
        assert r.validate() == []


async def test_export_refused_read_only(rw_config):
    conn = IgnitionMockConnector(rw_config)  # even with READ_WRITE requested
    recs = conn.normalize(await conn.import_records(RecordType.TAG))
    result = await conn.export_records(recs)
    assert result.exported == 0
    assert result.refused == len(recs)


async def test_full_sync(ignition: IgnitionMockConnector):
    recs, result = await ignition.sync(RecordType.TAG)
    assert result.ok
    assert result.imported == 11
    assert result.normalized == 11
    assert len(recs) == 11
