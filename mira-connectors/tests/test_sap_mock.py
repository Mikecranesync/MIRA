"""SAP PM connector tests."""

from __future__ import annotations

import asyncio

import pytest

from uns_bridge import uns
from cmms.sap_mock import SAPMockConnector


@pytest.fixture()
def graph():
    c = SAPMockConnector()
    return c, c.normalize(asyncio.run(c.import_records()))


def test_discover_real_field_names():
    cap = asyncio.run(SAPMockConnector().discover())
    assert cap.system_kind == "sap"
    assert "EQUNR" in cap.schema["equipment"]
    assert "TPLNR" in cap.schema["functional_location"]


def test_import_records_valid():
    raw = asyncio.run(SAPMockConnector().import_records())
    assert raw and {r.object_type for r in raw} >= {
        "functional_location",
        "equipment",
        "maintenance_order",
        "task_list",
        "bom",
    }


def test_equipment_hierarchy_and_uns(graph):
    _, g = graph
    conv = g.get("asset:10000455")
    motor = g.get("component:10000456")
    assert conv and motor
    assert uns.is_valid_path(conv.uns_path)
    assert motor.uns_path.startswith(conv.uns_path + ".component.")


def test_payload_preserved(graph):
    _, g = graph
    conv = g.get("asset:10000455")
    assert conv.source_payload["EQUNR"] == "10000455"
    assert conv.source_payload["HERST"] == "Dorner"


def test_edges(graph):
    _, g = graph
    types = {r.relationship_type for r in g.relationships}
    assert {"LOCATED_IN", "HAS_COMPONENT", "HAS_WORK_ORDER", "HAS_PM_TASK", "HAS_PART"} <= types


def test_plant_level_is_proposal(graph):
    _, g = graph
    assert any(p.suggestion_type == "uns_confirmation" for p in g.proposals)
    assert all(e.approval_state == "proposed" for e in g.entities.values())


def test_validate_clean(graph):
    c, g = graph
    rep = c.validate(g)
    assert rep.ok and not rep.warnings


def test_export_dry_run():
    res = asyncio.run(
        SAPMockConnector().export_enriched({"aufnr": "4000123", "uns_path": "enterprise.acme"})
    )
    assert res.supported and res.written is False
    assert res.payloads[0]["ZZ_MIRA_UNS_PATH"] == "enterprise.acme"
