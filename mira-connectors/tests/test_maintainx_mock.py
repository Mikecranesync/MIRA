"""MaintainX connector tests."""

from __future__ import annotations

import asyncio

import pytest

from uns_bridge import uns
from cmms.maintainx_mock import MaintainXMockConnector


@pytest.fixture()
def graph():
    c = MaintainXMockConnector()
    return c, c.normalize(asyncio.run(c.import_records()))


def test_discover_rest_shape():
    cap = asyncio.run(MaintainXMockConnector().discover())
    assert cap.system_kind == "maintainx"
    assert "asset" in cap.object_types and "work_order" in cap.object_types


def test_import_records_valid():
    raw = asyncio.run(MaintainXMockConnector().import_records())
    assert raw and {r.object_type for r in raw} >= {"location", "asset", "work_order", "part"}


def test_hierarchy_and_uns(graph):
    _, g = graph
    conv = g.get("asset:CONV-001")
    motor = g.get("component:MOTOR-001")
    assert conv and motor
    assert uns.is_valid_path(conv.uns_path)
    assert motor.uns_path.startswith(conv.uns_path + ".component.")


def test_payload_preserved_incl_numeric_id(graph):
    _, g = graph
    conv = g.get("asset:CONV-001")
    assert conv.source_payload["id"] == 8001
    assert conv.source_payload["manufacturer"] == "Dorner"


def test_edges(graph):
    _, g = graph
    types = {r.relationship_type for r in g.relationships}
    assert {"LOCATED_IN", "HAS_COMPONENT", "HAS_WORK_ORDER", "HAS_PART"} <= types


def test_preventive_category_flagged(graph):
    _, g = graph
    pms = [e for e in g.by_type("work_order") if e.properties.get("is_preventive")]
    assert pms, "PREVENTIVE-category work order should be flagged"


def test_all_proposed_and_validate(graph):
    c, g = graph
    assert all(e.approval_state == "proposed" for e in g.entities.values())
    rep = c.validate(g)
    assert rep.ok and not rep.warnings


def test_export_dry_run():
    res = asyncio.run(
        MaintainXMockConnector().export_enriched(
            {"work_order_id": "91001", "uns_path": "enterprise.acme"}
        )
    )
    assert res.supported and res.written is False
    assert res.payloads[0]["customFields"]["mira_uns_path"] == "enterprise.acme"
