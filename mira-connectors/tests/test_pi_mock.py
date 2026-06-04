"""AVEVA PI historian connector tests."""

from __future__ import annotations

import asyncio

import pytest

from uns_bridge import uns
from historian.pi_mock import PIMockConnector


@pytest.fixture()
def graph():
    c = PIMockConnector()
    return c, c.normalize(asyncio.run(c.import_records()))


def test_discover():
    cap = asyncio.run(PIMockConnector().discover())
    assert cap.system_kind == "historian"
    assert cap.supports_export is False
    assert "pi_point" in cap.object_types


def test_import_records_valid():
    raw = asyncio.run(PIMockConnector().import_records())
    assert raw and {r.object_type for r in raw} >= {"af_element", "pi_point", "event_frame"}


def test_af_hierarchy_to_canonical(graph):
    _, g = graph
    site = [e for e in g.by_type("site")]
    assert site
    asset = g.get("asset:af:Bedford\\Packaging\\Conveyor")
    assert asset and uns.is_valid_path(asset.uns_path)
    motor = g.get("component:af:Bedford\\Packaging\\Conveyor\\Motor")
    assert motor.uns_path.startswith(asset.uns_path + ".component.")


def test_pi_points_become_historian_tags(graph):
    _, g = graph
    tags = g.by_type("tag")
    assert tags and all(t.properties["tag_kind"] == "historian" for t in tags)
    # archived values ride along as samples, preserved in the payload
    cur = [t for t in tags if t.name.endswith("Conv.Motor.Current")][0]
    assert cur.properties["sample_count"] == 3
    assert "_archived_values" in cur.source_payload


def test_event_frames_become_fault_events(graph):
    _, g = graph
    fe = g.by_type("fault_event")
    assert fe
    assert any(r.relationship_type == "OCCURS_ON" for r in g.relationships)


def test_safety_event_frame_flagged(graph):
    _, g = graph
    assert any(p.risk_level == "safety_critical" for p in g.proposals)


def test_all_proposed_and_validate(graph):
    c, g = graph
    assert all(e.approval_state == "proposed" for e in g.entities.values())
    rep = c.validate(g)
    assert rep.ok and not rep.warnings


def test_export_unsupported():
    res = asyncio.run(PIMockConnector().export_enriched({}))
    assert res.supported is False
