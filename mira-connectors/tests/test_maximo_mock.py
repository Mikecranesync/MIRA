"""MaximoMockConnector — full import → normalize → derive → export lifecycle."""

from __future__ import annotations

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalFailureCode,
    CanonicalWorkOrder,
    RecordType,
)
from mira_connectors.mocks import MaximoMockConnector


async def test_discover(maximo: MaximoMockConnector):
    caps = await maximo.discover()
    assert caps.kind.value == "cmms"
    assert caps.provider == "maximo"
    assert RecordType.ASSET in caps.record_types
    assert caps.supports_export is True
    assert "asset_fields" in caps.schema


async def test_health_check(maximo: MaximoMockConnector):
    h = await maximo.health_check()
    assert h["ok"] is True
    assert h["mock"] is True


async def test_import_assets(maximo: MaximoMockConnector):
    raw = await maximo.import_records(RecordType.ASSET)
    assert len(raw) == 4
    assert {r.source_record_id for r in raw} == {"CONV16", "VFD-16-1", "MTR-16-1", "PE-B16-2"}
    assert raw[0].fields["ASSETNUM"]  # native field preserved


async def test_normalize_asset_uns_and_nameplate(maximo: MaximoMockConnector):
    raw = await maximo.import_records(RecordType.ASSET)
    recs = {r.source_record_id: r for r in maximo.normalize(raw)}
    vfd = recs["VFD-16-1"]
    assert isinstance(vfd, CanonicalAsset)
    assert vfd.manufacturer == "AUTOMATIONDIRECT"
    assert vfd.model == "GS11-10P2"  # from CUSTOM.MODELNUM
    assert vfd.serial == "GS10-1P-220-9931"
    assert vfd.criticality == "high"
    # UNS candidate path walks the location hierarchy root→leaf then the asset.
    assert vfd.proposed_uns_path == "enterprise.bedford_packaging_plant.packaging_area.packaging_line_16.line_16_infeed_conveyor.vfd_16_1"


async def test_normalize_workorder_status_map(maximo: MaximoMockConnector):
    raw = await maximo.import_records(RecordType.WORK_ORDER)
    recs = {r.source_record_id: r for r in maximo.normalize(raw)}
    assert isinstance(recs["1048817"], CanonicalWorkOrder)
    assert recs["1048817"].status == "COMPLETE"  # COMP → COMPLETE
    assert recs["1048903"].status == "IN_PROGRESS"  # INPRG → IN_PROGRESS
    assert recs["1048817"].work_type == "corrective"  # CM → corrective
    assert recs["1048817"].failure_code == "VFD"


async def test_import_failure_codes(maximo: MaximoMockConnector):
    raw = await maximo.import_records(RecordType.FAILURE_CODE)
    recs = maximo.normalize(raw)
    assert all(isinstance(r, CanonicalFailureCode) for r in recs)
    assert any(r.code == "COMMFAULT" for r in recs)


async def test_derive_relationships(maximo: MaximoMockConnector):
    # Gather assets + docs + work orders, then derive cross-record edges.
    all_recs = []
    for rt in (RecordType.ASSET, RecordType.DOCUMENT, RecordType.WORK_ORDER):
        all_recs.extend(maximo.normalize(await maximo.import_records(rt)))
    rels = maximo.derive_relationships(all_recs)
    by_type: dict[str, list] = {}
    for r in rels:
        by_type.setdefault(r.relationship_type, []).append(r)

    # VFD-16-1 is a child of CONV16 → HAS_COMPONENT(parent=CONV16, child=VFD-16-1)
    has_comp = by_type["HAS_COMPONENT"]
    assert any(r.source_ref == "CONV16" and r.target_ref == "VFD-16-1" for r in has_comp)
    # asset → location
    assert any(r.source_ref == "VFD-16-1" and r.target_ref == "CONV16" for r in by_type["LOCATED_IN"])
    # asset → doclink : HAS_DOCUMENT(source=asset, target=document)
    assert any(r.source_ref == "VFD-16-1" for r in by_type["HAS_DOCUMENT"])
    # failure code → asset (evidence is a work order)
    occurs = by_type["OCCURS_ON"]
    assert any(r.source_ref == "VFD" and r.target_ref == "VFD-16-1" for r in occurs)
    # every derived relationship carries at least one evidence row
    assert all(r.evidence for r in rels)
    # and they all validate
    for r in rels:
        assert r.validate() == [], f"{r.relationship_type} failed: {r.validate()}"


async def test_export_only_work_orders_writable(rw_config):
    conn = MaximoMockConnector(rw_config)
    assets = conn.normalize(await conn.import_records(RecordType.ASSET))
    wos = conn.normalize(await conn.import_records(RecordType.WORK_ORDER))
    result = await conn.export_records([*assets, *wos])
    assert result.exported == len(wos)
    assert result.refused == len(assets)


async def test_full_sync_lifecycle(maximo: MaximoMockConnector):
    recs, result = await maximo.sync(RecordType.ASSET)
    assert result.ok
    assert result.validation_errors == 0
    # 4 assets, each with a UNS candidate → no warnings either
    assert result.validation_warnings == 0
    assert len(recs) == 4
