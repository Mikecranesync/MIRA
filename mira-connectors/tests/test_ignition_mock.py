"""Ignition SCADA connector tests — tag normalization + cross-reference."""

from __future__ import annotations

import asyncio

import pytest

from cmms.maximo_mock import MaximoMockConnector
from scada.ignition_mock import IgnitionMockConnector


@pytest.fixture()
def scada():
    c = IgnitionMockConnector()
    return c, c.normalize(asyncio.run(c.import_records()))


def test_discover_no_export():
    cap = asyncio.run(IgnitionMockConnector().discover())
    assert cap.system_kind == "ignition"
    assert cap.supports_export is False  # no write-back to a tag provider


def test_import_returns_valid_tags():
    raw = asyncio.run(IgnitionMockConnector().import_records())
    assert raw and all(
        r.object_type == "tag" and r.external_object_id.startswith("[default]") for r in raw
    )


def test_tags_have_no_uns_until_linked(scada):
    _, g = scada
    tags = g.by_type("tag")
    assert tags
    assert all(t.uns_path is None for t in tags), (
        "SCADA tags carry no UNS path until linked to an asset"
    )


def test_tag_payload_preserved_with_samples(scada):
    _, g = scada
    t = g.by_type("tag")[0]
    assert "path" in t.source_payload and "samples" in t.source_payload
    assert t.properties["tag_kind"] == "scada"


def test_folder_structure_detected(scada):
    _, g = scada
    # provisional equipment + device-folder components from the tag tree
    assert any(e.entity_type == "asset" and "Conv_Simple" in e.name for e in g.entities.values())
    assert any(e.entity_type == "component" for e in g.entities.values())
    assert any(r.relationship_type == "HAS_SIGNAL" for r in g.relationships)


def test_cross_reference_exact_and_fuzzy_matches(scada):
    ig, sg = scada
    mx = MaximoMockConnector()
    mxg = mx.normalize(asyncio.run(mx.import_records()))
    props = ig.propose_asset_links(sg, mxg)
    assert props
    # all cross-ref proposals are kg_edge, pending, never auto-verified
    assert all(p.suggestion_type == "kg_edge" and p.status == "pending" for p in props)
    by_target = {p.extracted_data["cmms_target_key"]: p for p in props}
    # exact tag↔ASSETNUM match (PE_101 ↔ PE-101) scores high
    assert by_target["component:PE-101"].confidence >= 0.9
    # fuzzy folder match scores lower
    assert by_target["component:MOTOR-001"].confidence < 0.9
    # every proposed link names the relationship and the target UNS path
    for p in props:
        assert p.extracted_data["relationship_type"] == "HAS_SIGNAL"
        assert p.extracted_data["cmms_uns_path"]


def test_safety_tag_link_flagged(scada):
    ig, sg = scada
    mx = MaximoMockConnector()
    mxg = mx.normalize(asyncio.run(mx.import_records()))
    props = ig.propose_asset_links(sg, mxg)
    conv = [p for p in props if p.extracted_data["cmms_target_key"] == "asset:CONV-001"]
    assert conv and conv[0].risk_level == "safety_critical"  # EStop tag present


def test_validate_clean(scada):
    c, g = scada
    rep = c.validate(g)
    assert rep.ok and not rep.warnings


def test_export_unsupported():
    res = asyncio.run(IgnitionMockConnector().export_enriched({}))
    assert res.supported is False and res.written is False
