"""Maximo connector tests — covers the 7 required behaviors:
import, normalize, payload preservation, UNS paths, proposals (not facts),
dry_run, and export."""

from __future__ import annotations

import asyncio

import pytest

from uns_bridge import uns
from cmms.maximo_mock import MaximoMockConnector


@pytest.fixture()
def graph():
    c = MaximoMockConnector()
    return c, c.normalize(asyncio.run(c.import_records()))


def test_discover_reports_schema_and_export():
    c = MaximoMockConnector()
    cap = asyncio.run(c.discover())
    assert cap.system_kind == "maximo"
    assert cap.supports_export is True
    assert "asset" in cap.object_types
    assert "ASSETNUM" in cap.schema["asset"]  # real Maximo field name surfaced


def test_import_returns_valid_raw_records():
    c = MaximoMockConnector()
    raw = asyncio.run(c.import_records())
    assert raw, "expected records"
    assert all(r.object_type and r.external_object_id and r.payload for r in raw)
    assert {r.object_type for r in raw} >= {
        "asset",
        "location",
        "workorder",
        "pm",
        "meter",
        "doclink",
        "failurecode",
    }


def test_import_site_filter():
    c = MaximoMockConnector()
    raw = asyncio.run(c.import_records({"site": "NASHUA", "object_types": ["asset"]}))
    assert raw and all(r.payload["SITEID"] == "NASHUA" for r in raw)


def test_normalize_asset_and_component_types(graph):
    _, g = graph
    assert g.get("asset:CONV-001").entity_type == "asset"
    # children (PARENT set) normalize to components
    assert g.get("component:MOTOR-001").entity_type == "component"
    assert g.get("component:VFD-001").entity_type == "component"


def test_uns_paths_are_valid_and_nested(graph):
    _, g = graph
    conv = g.get("asset:CONV-001")
    motor = g.get("component:MOTOR-001")
    assert conv.uns_path == uns.assigned_equipment_path(
        "acme", "bedford", "area_1", "CONV-001", line="line_1", work_cell="cell_1"
    )
    assert motor.uns_path.startswith(conv.uns_path + ".component.")
    for e in g.entities.values():
        if e.uns_path:
            assert uns.is_valid_path(e.uns_path), e.uns_path


def test_all_source_fields_preserved(graph):
    _, g = graph
    conv = g.get("asset:CONV-001")
    # the original Maximo record — including custom fields — survives verbatim
    assert conv.source_payload["ASSETNUM"] == "CONV-001"
    assert conv.source_payload["SERIALNUM"] == "CNV-2021-4471"
    assert "MIRA_UNS_PATH" in conv.source_payload  # custom field not dropped
    assert "MIRA_CONFIDENCE" in conv.source_payload
    # a matching SourceObject preserves the raw record too
    so = [s for s in g.source_objects if s.external_object_id == "CONV-001"][0]
    assert so.raw_payload == conv.source_payload
    assert so.mapping_status == "mapped"


def test_failure_code_tree_normalized(graph):
    _, g = graph
    assert g.get("fault_code:CONVEYOR")
    assert g.get("failure_mode:NORUN")
    assert g.get("root_cause:VFDFAULT")
    assert g.get("remedy:RSTVFD")
    rels = {(r.source_key, r.relationship_type, r.target_key) for r in g.relationships}
    assert ("root_cause:VFDFAULT", "CAUSES", "failure_mode:NORUN") in rels
    assert ("failure_mode:NORUN", "RESOLVED_BY", "remedy:RSTVFD") in rels


def test_workorder_edges_and_parts(graph):
    _, g = graph
    rels = {(r.source_key, r.relationship_type, r.target_key) for r in g.relationships}
    assert ("asset:CONV-001", "HAS_WORK_ORDER", "work_order:WO-10231") in rels
    # WO against a component (MOTOR-001) resolves to the component, not a phantom asset
    assert ("component:MOTOR-001", "HAS_WORK_ORDER", "work_order:WO-10302") in rels
    assert any(r.relationship_type == "USES_PART" for r in g.relationships)


def test_pm_and_meter_and_doclink_edges(graph):
    _, g = graph
    types = {r.relationship_type for r in g.relationships}
    assert {"HAS_PM_TASK", "HAS_SIGNAL", "HAS_DOCUMENT"} <= types
    # a wiring doclink becomes a wiring_diagram entity
    assert any(e.entity_type == "wiring_diagram" for e in g.entities.values())


def test_ambiguous_mappings_are_proposals_not_facts(graph):
    _, g = graph
    # the 4-vs-3 ISA-95 depth mismatch is a uns_confirmation proposal
    assert any(p.suggestion_type == "uns_confirmation" for p in g.proposals)
    # nothing the connector produced is auto-verified
    assert all(e.approval_state == "proposed" for e in g.entities.values())
    assert all(r.approval_state == "proposed" for r in g.relationships)


def test_safety_failure_path_flagged(graph):
    _, g = graph
    safety = [p for p in g.proposals if p.risk_level == "safety_critical"]
    assert safety, "E-stop failure path should be flagged safety_critical"


def test_validate_clean(graph):
    c, g = graph
    rep = c.validate(g)
    assert rep.ok, [e.message for e in rep.errors]
    assert not rep.warnings, [w.message for w in rep.warnings]


def test_export_dry_run_builds_but_does_not_write():
    c = MaximoMockConnector()
    res = asyncio.run(
        c.export_enriched(
            {
                "wonum": "WO-10231",
                "uns_path": "enterprise.acme",
                "diagnosis": "x",
                "confidence": "high",
            }
        )
    )
    assert res.supported and res.written is False
    payload = res.payloads[0]
    assert payload["WONUM"] == "WO-10231"
    assert payload["MIRA_UNS_PATH"] == "enterprise.acme"  # custom field round-trips


def test_config_schema_marks_secret():
    c = MaximoMockConnector()
    schema = c.get_config_schema()
    assert schema["api_key"]["secret"] is True
