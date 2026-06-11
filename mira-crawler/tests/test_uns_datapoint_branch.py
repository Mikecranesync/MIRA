"""Tests for the live-state `datapoint_path` builder and its separation from
the maintenance/history branch.

Walker live-state vs MIRA maintenance KG: a tag's CURRENT value lives under
``...equipment.{eq}.datapoint.{tag}`` (live, current-state only); durable
maintenance history (fault_history, work_orders, pm_schedules) lives under a
SEPARATE ``...equipment.{eq}.maintenance.*`` branch. These tests prove the two
branches are disjoint, so live telemetry can never be addressed as maintenance
history (and vice-versa).
"""

from __future__ import annotations

from ingest import uns

EQ = uns.assigned_equipment_path(
    company="lakewales",
    site="plant1",
    area="packaging",
    line="line2",
    equipment_id="conveyor_a",
)


def test_datapoint_path_is_under_datapoint_branch():
    p = uns.datapoint_path(EQ, "motor_current")
    assert p == f"{EQ}.datapoint.motor_current"
    assert uns.is_valid_path(p)


def test_datapoint_slugs_the_tag_name():
    p = uns.datapoint_path(EQ, "Motor Current (A)")
    assert p == f"{EQ}.datapoint.motor_current_a"


def test_datapoint_and_maintenance_branches_are_disjoint():
    live = uns.datapoint_path(EQ, "motor_current")
    history = uns.equipment_subnode_path(EQ, "maintenance", "fault_history", "evt_42")
    docs = uns.equipment_subnode_path(EQ, "documentation", "manuals", "user_v3")

    # Live state sits under .datapoint.; durable history under .maintenance.;
    # evidence under .documentation. — three separate children of equipment.
    assert live.startswith(f"{EQ}.datapoint.")
    assert history.startswith(f"{EQ}.maintenance.")
    assert docs.startswith(f"{EQ}.documentation.")
    # No path is an ancestor/descendant of another branch.
    assert ".maintenance." not in live
    assert ".datapoint." not in history
    assert ".datapoint." not in docs


def test_datapoint_label_is_reserved():
    # `datapoint` is a structural type-marker, not usable as an instance slug.
    assert "datapoint" in uns.RESERVED_LABELS
